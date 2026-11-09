import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { create } from 'zustand';
import * as models from '../src/lib/personalBackupModels';
function execute(source: string, imports: Record<string, unknown>, values: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, setTimeout, clearTimeout, console, ...values, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } }); return exports;
}
function harness() {
  const raw = new DatabaseSync(':memory:'); let profile = 'A', epoch = 0, held: (() => void) | undefined, hold = false;
  const owner = () => { const original = profile, token = epoch; return { profile: original, source: 'server', library: original, current: () => profile === original && token === epoch,
    check() { if (profile !== original || epoch !== token) throw new Error('Owner changed'); } }; };
  const statement = (sql: string, parameters: unknown[]) => { const args = parameters.length === 1 && Array.isArray(parameters[0]) ? parameters[0] : parameters; return { sql: raw.prepare(sql), args }; };
  const database = { execAsync: async (sql: string) => { raw.exec(sql); },
    runAsync: async (sql: string, ...parameters: unknown[]) => { const query = statement(sql, parameters); const result = query.sql.run(...query.args as any[]);
      if (hold && sql.startsWith('INSERT')) { hold = false; await new Promise<void>((resolve) => { held = resolve; }); } return result; },
    getAllAsync: async (sql: string, ...parameters: unknown[]) => { const query = statement(sql, parameters); return query.sql.all(...query.args as any[]); },
    withExclusiveTransactionAsync: async (work: (tx: unknown) => Promise<void>) => { raw.exec('BEGIN'); try { await work(database); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; } },
  };
  const mod = execute(readFileSync(new URL('../src/store/pendingSongMarks.ts', import.meta.url), 'utf8'), {
    'expo-sqlite': { openDatabaseAsync: async () => database }, zustand: { create }, '@/lib/personalBackupModels': models, './playlistRecovery': { personalOwner: owner },
  });
  return { mod, owner, close: () => raw.close(), switch(name: string) { profile = name; epoch++; }, holdNext() { hold = true; }, async waitHeld() { for (let i = 0; !held && i < 100; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0)); assert.ok(held, 'the production SQL write started'); }, release() { assert.ok(held); held(); held = undefined; } };
}
const record = (title: string, marks = { favorite: true as boolean | undefined, rating: undefined as number | undefined }) => ({ track: { id: title, title, artist: 'Artist', album: 'Album', duration: 200 }, marks });
test('real SQL keeps unmatched private marks per account/source, merges duplicates, strips URLs and clears only its account', async () => {
  const h = harness();
  try {
    await h.mod.savePendingSongMarks([record('A'), record('A', { favorite: undefined, rating: 4 }), { track: { title: 'No URL', id: 'https://secret.test/token', url: 'https://secret.test/audio', path: 'private' }, marks: { favorite: true } }]);
    const rows = await h.mod.exportPendingSongMarks(); assert.equal(rows.length, 2); const a = rows.find((row: any) => row.track.title === 'A'); assert.equal(a.marks.favorite, true); assert.equal(a.marks.rating, 4);
    assert.equal(JSON.stringify(rows).includes('secret.test'), false); assert.equal(JSON.stringify(rows).includes('private'), false);
    h.switch('B'); assert.equal((await h.mod.exportPendingSongMarks()).length, 0); await h.mod.savePendingSongMarks([record('B')]);
    await h.mod.clearPendingSongMarksProfile('A'); assert.equal((await h.mod.exportPendingSongMarks()).length, 1);
    h.switch('A'); assert.equal((await h.mod.exportPendingSongMarks()).length, 0);
    assert.throws(() => h.mod.validatePendingSongMarks(new Array(50001)), /limit/);
  } finally { h.close(); }
});
test('an actual in-flight SQL mutation rolls back after A → B → A or deletion, and cannot recreate cleared rows', async () => {
  for (const kind of ['aba', 'delete']) {
    const h = harness();
    try {
      await h.mod.savePendingSongMarks([record('kept')]); h.holdNext(); const pending = h.mod.savePendingSongMarks([record('late')]);
      await h.waitHeld();
      let clear: Promise<unknown> | undefined;
      if (kind === 'aba') { h.switch('B'); h.switch('A'); } else clear = h.mod.clearPendingSongMarksProfile('A');
      await h.release(); await assert.rejects(pending, /changed/); await clear;
      const rows = await h.mod.exportPendingSongMarks(); assert.deepEqual(Array.from(rows, (row: any) => row.track.title), kind === 'aba' ? ['kept'] : []);
    } finally { h.close(); }
  }
});
function applySource() {
  const ast = ts.createSourceFile('pending.tsx', readFileSync(new URL('../src/app/settings/pending-marks.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'apply') found = node; ts.forEachChild(node, visit); } visit(ast); assert.ok(found);
  return `${found.getText(ast)}\nexports.apply=apply;`;
}
test('the actual Apply callback keeps existing ratings, deletes only completed records and retries a partial restore without duplicate marks', async () => {
  const h = harness(); let fail = true; const starred = new Set<string>(), ratings = new Map<string, number>([['preserve', 3]]), actions: string[] = [];
  try {
    await h.mod.savePendingSongMarks([record('first'), record('retry', { favorite: true, rating: 5 }), record('preserve', { favorite: undefined, rating: 4 })]);
    const executeApply = async () => {
      const rows = await h.mod.exportPendingSongMarks(); const matches = Object.fromEntries(rows.map((row: any) => [row.key, { selected: { ...row.track } }]));
      const values = { owner: h.owner(), matched: rows, matches, wholeLibraryReadError: () => undefined, setError: () => {},
        getSong: async (id: string) => ({ id, title: id, starred: starred.has(id) ? 'yes' : undefined, userRating: ratings.get(id) }),
        star: async (id: string) => { assert.equal(starred.has(id), false); starred.add(id); actions.push(`star:${id}`); },
        setRating: async (id: string, value: number) => { if (id === 'retry' && fail) throw new Error('Network'); ratings.set(id, value); actions.push(`rating:${id}`); },
        deletePendingSongMark: h.mod.deletePendingSongMark, setRows: () => {}, setStatus: () => {}, t: (value: string) => value,
        queryClient: { invalidateQueries: async () => {} }, reload: async () => {},
      };
      const production = execute(applySource(), {}, values); return production.apply(h.owner().check);
    };
    await assert.rejects(executeApply(), /Network/); assert.deepEqual(actions, ['star:first', 'star:retry']);
    const remaining = await h.mod.exportPendingSongMarks(); assert.equal(remaining.length, 1); assert.equal(remaining[0].track.title, 'retry', 'the independent existing-rating row completes without overwriting its rating');
    fail = false; await executeApply(); assert.equal(ratings.get('retry'), 5); assert.equal(ratings.get('preserve'), 3);
    assert.deepEqual(actions, ['star:first', 'star:retry', 'rating:retry']); assert.equal((await h.mod.exportPendingSongMarks()).length, 0);
  } finally { h.close(); }
});
