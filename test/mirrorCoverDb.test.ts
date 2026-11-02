import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const executable = ts.transpileModule(readFileSync(new URL('../src/lib/mirrorDb.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  let rows = new Map<string, { id: string; alias_of: string | null; bytes: number; size?: number }>([
    ['cover', { id: 'cover', alias_of: null, bytes: 600 }],
  ]);
  let hasSize = false, calls = 0, transactions = 0;
  const state = { failBatch: 0 };
  const statements: string[] = [];
  const db = {
    execAsync: async (sql: string) => {
      statements.push(sql);
      if (sql.startsWith('ALTER TABLE covers')) {
        hasSize = true;
        for (const row of rows.values()) row.size = 0;
      }
    },
    getAllAsync: async (sql: string) => {
      if (sql === 'PRAGMA table_info(entries)') return ['changed', 'starred', 'song_ids'].map((name) => ({ name }));
      if (sql === 'PRAGMA table_info(covers)') return ['id', 'alias_of', 'bytes', ...(hasSize ? ['size'] : [])].map((name) => ({ name }));
      assert.equal(sql, 'SELECT id, alias_of, bytes, size FROM covers');
      return [...rows.values()];
    },
    runAsync: async (sql: string, params: (string | number | null)[]) => {
      assert.ok(sql.startsWith('INSERT OR REPLACE INTO covers (id, alias_of, bytes, size)'));
      if (++calls === state.failBatch) throw new Error('database storage failure');
      for (let i = 0; i < params.length; i += 4) {
        const [id, alias_of, bytes, size] = params.slice(i, i + 4);
        rows.set(id as string, { id: id as string, alias_of: alias_of as string | null, bytes: bytes as number, size: size as number });
      }
    },
    withTransactionAsync: async (write: () => Promise<void>) => {
      transactions++;
      const before = new Map([...rows].map(([id, row]) => [id, { ...row }]));
      try { await write(); } catch (error) { rows = before; throw error; }
    },
  };
  const dependencies: Record<string, unknown> = {
    'expo-file-system/legacy': { makeDirectoryAsync: async () => {}, getInfoAsync: async () => ({ exists: false }) },
    'expo-sqlite': { openDatabaseAsync: async () => db },
    './navidromeRemap': {}, './perfLog': { timed: (_name: string, work: () => unknown) => work() },
  };
  const exported: Record<string, any> = {};
  runInNewContext(executable, { exports: exported,
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return { state, statements, rows: () => rows, transactions: () => transactions,
    read: () => exported.allCovers('file:///test/', 'one') as Promise<any[]>,
    write: (values: unknown[]) => exported.putCovers('file:///test/', 'one', values) as Promise<void>,
  };
}

test('adds only the cover resolution column and preserves old rows as unknown-resolution legacy files', async () => {
  const h = harness(); const rows = await h.read();
  assert.equal(h.statements.filter((sql) => sql.startsWith('ALTER TABLE')).length, 1);
  assert.equal(h.statements.at(-1), 'ALTER TABLE covers ADD COLUMN size INTEGER NOT NULL DEFAULT 0');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ id: 'cover', aliasOf: null, bytes: 600, size: 0 }]);
  await h.read();
  assert.equal(h.statements.filter((sql) => sql.startsWith('ALTER TABLE')).length, 1);
});

test('a multi-batch cover upgrade rolls back its canonical row when a later alias batch fails', async () => {
  const h = harness(); await h.read(); h.state.failBatch = 2;
  const rows = [{ id: 'cover', aliasOf: null, bytes: 2200, size: 1200 },
    ...Array.from({ length: 201 }, (_, i) => ({ id: `alias-${i}`, aliasOf: 'cover', bytes: 0 }))];
  await assert.rejects(h.write(rows), /database storage failure/);
  assert.equal(h.transactions(), 1);
  assert.equal(h.rows().size, 1);
  assert.deepEqual(h.rows().get('cover'), { id: 'cover', alias_of: null, bytes: 600, size: 0 });
  h.state.failBatch = 0; await h.write(rows);
  assert.equal(h.rows().get('cover')?.size, 1200);
  assert.equal(h.rows().size, 202);
});
