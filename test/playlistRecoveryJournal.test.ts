import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { completeRecoveryInsertion, recoveryInsertionIntent, validateRecoveryInsertion } from '../src/lib/playlistRecoveryInsert';
import type { RecoveryPlaylist } from '../src/lib/personalBackupModels';
import type { Song } from '../src/api/subsonic';

const a: Song = { id: 'a', title: 'A' }, b: Song = { id: 'b', title: 'B' }, recovered: Song = { id: 'new', title: 'Recovered' };
const manifest = (): RecoveryPlaylist => ({ key: 'list', playlistId: 'list', name: 'List', updatedAt: 1, entries: [
  { key: 'a1', songId: 'a', track: { title: 'A' } }, { key: 'lost', track: { title: 'Recovered' }, marks: { favorite: true, rating: 4 } },
  { key: 'a2', songId: 'a', track: { title: 'A' } }, { key: 'b', songId: 'b', track: { title: 'B' } },
] });
function insertionHarness() {
  const value = manifest(), intent = recoveryInsertionIntent(value, [a, a, b], new Map([['lost', recovered]]))!;
  let songs = [a, a, b], inserts = 0, finished = false, saved: RecoveryPlaylist | undefined, marks = 0;
  const access = { check() {}, readSongs: async () => songs,
    insert: async (rows: { before: number; song: Song }[], expected: string[]) => {
      assert.deepEqual(songs.map((song) => song.id), expected); assert.deepEqual(rows.map((row) => [row.before, row.song.id]), [[1, 'new']]);
      inserts++; songs = [a, recovered, a, b]; return songs;
    }, persistManifest: async (next: RecoveryPlaylist) => { saved = next; }, restoreMarks: async () => { marks++; }, finish: async () => { finished = true; } };
  return { intent, access, snapshot: () => ({ songs, inserts, finished, saved, marks }), replace: (next: Song[]) => { songs = next; } };
}
test('actual recovery insertion retries a failed local manifest save without inserting the recovered occurrence twice', async () => {
  const h = insertionHarness(), persist = h.access.persistManifest; let fault = true;
  h.access.persistManifest = async (value) => { if (fault) { fault = false; throw new Error('Disk unavailable'); } await persist(value); };
  await assert.rejects(completeRecoveryInsertion(h.intent, h.access), /Disk/);
  assert.equal(h.snapshot().inserts, 1); assert.equal(h.snapshot().finished, false);
  const result = await completeRecoveryInsertion(h.intent, h.access);
  assert.equal(h.snapshot().inserts, 1); assert.deepEqual(result.songs.map((song) => song.id), ['a', 'new', 'a', 'b']);
  assert.equal(result.manifest.entries.find((entry) => entry.key === 'lost')!.songId, 'new');
  assert.equal(h.snapshot().marks, 1); assert.equal(h.snapshot().finished, true);
});
test('an interrupted marks restore is resumable after the manifest saved; a changed playlist refuses all reinsertion', async () => {
  const h = insertionHarness(), restore = h.access.restoreMarks; let fault = true;
  h.access.restoreMarks = async () => { if (fault) { fault = false; throw new Error('Network failed'); } await restore(); };
  await assert.rejects(completeRecoveryInsertion(h.intent, h.access), /Network/);
  assert.equal(h.snapshot().saved?.entries[1].songId, 'new'); assert.equal(h.snapshot().finished, false);
  await completeRecoveryInsertion(h.intent, h.access); assert.equal(h.snapshot().inserts, 1); assert.equal(h.snapshot().marks, 1);
  const other = insertionHarness(); other.replace([b, a]);
  await assert.rejects(completeRecoveryInsertion(other.intent, other.access), /sequence changed/);
  assert.equal(other.snapshot().inserts, 0); assert.equal(other.snapshot().saved, undefined); assert.equal(other.snapshot().finished, false);
});
test('invalid recovery journals cannot hide extra insertions or assign a live occurrence as missing', () => {
  const h = insertionHarness(); assert.equal(validateRecoveryInsertion(h.intent, 'list').assignments[0].key, 'lost');
  assert.throws(() => validateRecoveryInsertion({ ...h.intent, after: ['new', ...h.intent.after] }, 'list'));
  assert.throws(() => validateRecoveryInsertion({ ...h.intent, assignments: [{ key: 'a1', before: 1, songId: 'new' }] }, 'list'));
});

function sqliteHarness() {
  const db = new DatabaseSync(':memory:'); let epoch = 0, profile = 'A', source = 'server', gate: (() => Promise<void>) | undefined;
  const personalOwner = () => { const token = epoch, owner = profile, space = source;
    return { profile: owner, source: space, library: 'test', current: () => epoch === token && profile === owner && source === space,
      check: () => { if (epoch !== token || profile !== owner || source !== space) throw new Error('Owner changed'); } };
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/store/playlistRecoveryJournal.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require(name: string) {
      if (name === './playlistRecovery') return { personalOwner };
      assert.equal(name, 'expo-sqlite'); return { openDatabaseAsync: async () => ({ execAsync: async (sql: string) => db.exec(sql),
        getFirstAsync: async (sql: string, ...args: any[]) => db.prepare(sql).get(...args),
        runAsync: async (sql: string, ...args: any[]) => db.prepare(sql).run(...args),
        withExclusiveTransactionAsync: async (work: any) => { db.exec('BEGIN IMMEDIATE'); try {
          await work({ runAsync: async (sql: string, ...args: any[]) => { if (gate && sql.startsWith('INSERT')) { const wait = gate; gate = undefined; await wait(); } return db.prepare(sql).run(...args); } }); db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; } },
      }) };
    } });
  return { api: exports, owner: personalOwner, change: (nextProfile: string, nextSource = 'server') => { epoch++; profile = nextProfile; source = nextSource; },
    gate: (next: () => Promise<void>) => { gate = next; }, close: () => db.close() };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
test('actual SQLite journal persists isolated intents, rejects private payloads, and rolls back an A to B to A write', async () => {
  const h = sqliteHarness(); try {
    const owner = h.owner(), intent = insertionHarness().intent;
    await h.api.saveRecoveryJournal('insert:list', intent, owner);
    assert.equal((await h.api.readRecoveryJournal('insert:list', owner)).manifest.name, 'List');
    h.change('B'); assert.equal(await h.api.readRecoveryJournal('insert:list', h.owner()), undefined);
    h.change('A', 'device'); assert.equal(await h.api.readRecoveryJournal('insert:list', h.owner()), undefined);
    h.change('A');
    for (const bad of [{ auth: { password: 'private' } }, { song: { localUri: 'file:///private' } }, { headers: {} }, { at: Infinity }, { data: new Date() }, { text: 'x'.repeat(2_000_001) }]) {
      assert.throws(() => h.api.saveRecoveryJournal('restore:test', bad, h.owner()));
    }
    let release!: () => void, entered = false; const waiting = new Promise<void>((resolve) => { release = resolve; });
    h.gate(async () => { entered = true; await waiting; });
    const pending = h.api.saveRecoveryJournal('insert:late', intent, h.owner()), rejected = assert.rejects(pending, /changed/);
    while (!entered) await turn(); h.change('B'); h.change('A'); release(); await rejected;
    assert.equal(await h.api.readRecoveryJournal('insert:late', h.owner()), undefined);
    await h.api.clearRecoveryJournalsProfile('A'); assert.equal(await h.api.readRecoveryJournal('insert:list', h.owner()), undefined);
  } finally { h.close(); }
});
