import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';

const base = fileURLToPath(new URL('../.local-cache/issue321-170/', import.meta.url));
const defer = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
async function harness() {
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'checkpoint-'));
  const firstA = { id: 'A' }, auth = createStore(() => ({ auth: firstA, offline: false, autoOffline: false, offlineSource: null }));
  let heldWrite: ReturnType<typeof defer> | undefined, failMove = false, iosMove = false, reads = 0, clock = 10_000;
  const log: { kind: string; uri: string }[] = [];
  const file = (uri: string) => fileURLToPath(uri);
  const localFS = {
    documentDirectory: pathToFileURL(directory).href + '/', EncodingType: { UTF8: 'utf8' },
    async getInfoAsync(uri: string) { log.push({ kind: 'stat', uri });
      try { const value = await fs.stat(file(uri)); return { exists: true, isDirectory: value.isDirectory(), size: value.size }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }; throw error; } },
    async readAsStringAsync(uri: string) { reads++; log.push({ kind: 'read', uri }); return fs.readFile(file(uri), 'utf8'); },
    async makeDirectoryAsync(uri: string) { log.push({ kind: 'mkdir', uri }); await fs.mkdir(file(uri), { recursive: true }); },
    async writeAsStringAsync(uri: string, text: string) { log.push({ kind: 'write', uri });
      const wait = heldWrite; heldWrite = undefined; if (wait) await wait.promise;
      await fs.writeFile(file(uri), text, 'utf8'); },
    async moveAsync({ from, to }: { from: string; to: string }) { log.push({ kind: 'move', uri: to });
      if (iosMove) await fs.rm(file(to), { force: true });
      if (failMove) { failMove = false; throw new Error('rename failed'); }
      await fs.rename(file(from), file(to)); },
    async deleteAsync(uri: string) { log.push({ kind: 'delete', uri }); await fs.rm(file(uri), { force: true, recursive: true }); },
  };
  const imports: Record<string, any> = {
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_algorithm: string, text: string) => createHash('sha256').update(text).digest('hex') },
    'expo-file-system/legacy': localFS,
    '@/store/auth': { useAuthStore: auth, profileScopeId: () => auth.getState().auth.id },
  };
  function load(source: string) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../${source}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, Date: class extends Date { static now() { return clock; } }, require(name: string) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected checkpoint import ${name}`); return imports[name];
    } });
    return exports;
  }
  function restart() { imports['./lyricOwner'] = load('src/lib/lyricOwner.ts'); return load('src/lib/playbackCheckpoint.ts'); }
  const api = restart();
  const snapshot = (patch: Record<string, unknown> = {}) => ({ queue: [{ id: 'one' }, { id: 'two' }, { id: 'two' }],
    index: 1, savedAt: 1000, checkpointId: 'queue-generation-A', ...patch });
  const identity = (patch: Record<string, unknown> = {}) => api.playbackCheckpointIdentity(snapshot(patch));
  const current = () => true;
  async function jsonFiles(): Promise<string[]> {
    const walk = async (folder: string): Promise<string[]> => {
      const entries = await fs.readdir(folder, { withFileTypes: true });
      return (await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]))).flat();
    };
    return (await walk(directory)).filter((name) => name.endsWith('.json'));
  }
  return { api, auth, firstA, snapshot, identity, current, log, jsonFiles, restart,
    holdWrite() { const pending = defer(); heldWrite = pending; return pending; },
    failMove(ios = false) { failMove = true; iosMove = ios; },
    reads: () => reads, clock(value: number) { clock = value; },
    async dispose() { await fs.rm(directory, { recursive: true, force: true }); },
  };
}
async function waitForWrite(h: Awaited<ReturnType<typeof harness>>, count = 1) {
  for (let turn = 0; turn < 100; turn++) {
    if (h.log.filter((row) => row.kind === 'write').length >= count) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('checkpoint did not reach native write');
}

test('a tiny real-file checkpoint survives process-state recreation and carries no queue, URL or account credentials', async () => {
  const h = await harness();
  try {
    const saved = h.snapshot({ queue: [{ id: 'https://private.example/audio?token=secret' }], index: 0 });
    const identity = h.api.playbackCheckpointIdentity(saved);
    assert.equal(await h.api.writePlaybackCheckpoint('A', 'queue.server', identity, 73, { current: h.current }), true);
    const files = await h.jsonFiles(); assert.equal(files.length, 1);
    const raw = await fs.readFile(files[0], 'utf8');
    assert.ok(Buffer.byteLength(raw) < 1024); assert.doesNotMatch(raw, /private\.example|token|secret|https|queue\":|username|password/);
    const restarted = h.restart(), persistedQueue = JSON.parse(JSON.stringify(saved));
    const restored = await restarted.readPlaybackCheckpoint('A', 'queue.server', restarted.playbackCheckpointIdentity(persistedQueue));
    assert.equal(restored.positionSec, 73); assert.equal(restored.savedAt, 10_000);
  } finally { await h.dispose(); }
});

test('exact generation, ordered queue IDs and selected occurrence must match; legacy and cleared queues never read the sidecar', async () => {
  const h = await harness();
  try {
    const id = h.identity(); await h.api.writePlaybackCheckpoint('A', 'queue', id, 40, { current: h.current });
    for (const changed of [h.identity({ checkpointId: 'new-generation' }), h.identity({ queue: [{ id: 'two' }, { id: 'one' }, { id: 'two' }] }),
      h.identity({ index: 2 }), h.identity({ savedAt: 1001 })])
      assert.equal(await h.api.readPlaybackCheckpoint('A', 'queue', changed), undefined);
    const reads = h.reads();
    assert.equal(h.identity({ checkpointId: undefined }), undefined);
    assert.equal(h.identity({ queue: [], index: 0 }), undefined);
    assert.equal(await h.api.readPlaybackCheckpoint('A', 'queue', undefined), undefined);
    assert.equal(h.reads(), reads, 'legacy full queue positions need no checkpoint IO');
    assert.equal((await h.api.readPlaybackCheckpoint('A', 'queue', id)).positionSec, 40);
  } finally { await h.dispose(); }
});

test('writes serialize with reads and same-time backward seeking is ordered by persisted serial', async () => {
  const h = await harness();
  try {
    const id = h.identity(), wait = h.holdWrite();
    const first = h.api.writePlaybackCheckpoint('A', 'queue', id, 90, { current: h.current }); await waitForWrite(h);
    const second = h.api.writePlaybackCheckpoint('A', 'queue', id, 20, { current: h.current });
    let readFinished = false;
    const reading = h.api.readPlaybackCheckpoint('A', 'queue', id).then((value: any) => { readFinished = true; return value; });
    await new Promise<void>((resolve) => setTimeout(resolve, 5)); assert.equal(readFinished, false);
    wait.resolve(); assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal((await reading).positionSec, 20);
    assert.equal((await h.jsonFiles()).length, 2, 'only two complete slots are retained');
    assert.equal((await h.api.readPlaybackCheckpoint('A', 'queue', id)).savedAt, 10_000);
  } finally { await h.dispose(); }
});

test('a failed replacement, including iOS destination removal, preserves the previous complete position', async () => {
  const h = await harness();
  try {
    const id = h.identity();
    await h.api.writePlaybackCheckpoint('A', 'queue', id, 10, { current: h.current });
    await h.api.writePlaybackCheckpoint('A', 'queue', id, 20, { current: h.current });
    h.failMove(true);
    await assert.rejects(h.api.writePlaybackCheckpoint('A', 'queue', id, 30, { current: h.current }), /rename failed/);
    assert.equal((await h.api.readPlaybackCheckpoint('A', 'queue', id)).positionSec, 20);
    assert.equal(h.log.filter((row) => row.kind === 'delete' && row.uri.endsWith('.tmp')).length, 3, 'each owned staging path is cleaned');
  } finally { await h.dispose(); }
});

test('account A-B-A revokes both running and queued old writes before they can replace new A progress', async () => {
  const h = await harness();
  try {
    const id = h.identity(); await h.api.writePlaybackCheckpoint('A', 'queue', id, 5, { current: h.current });
    const wait = h.holdWrite(), first = h.api.writePlaybackCheckpoint('A', 'queue', id, 90, { current: h.current });
    await waitForWrite(h, 2);
    const second = h.api.writePlaybackCheckpoint('A', 'queue', id, 95, { current: h.current });
    h.auth.setState({ auth: { id: 'B' } });
    assert.equal(await h.api.writePlaybackCheckpoint('A', 'queue', id, 100, { current: h.current }), false);
    h.auth.setState({ auth: h.firstA });
    const fresh = h.api.writePlaybackCheckpoint('A', 'queue', id, 35, { current: h.current });
    wait.resolve(); assert.deepEqual(await Promise.all([first, second, fresh]), [false, false, true]);
    assert.equal((await h.api.readPlaybackCheckpoint('A', 'queue', id)).positionSec, 35);
  } finally { await h.dispose(); }
});

test('a changed queue fence and synchronous clear revoke pending writes without resurrecting cleared progress', async () => {
  const h = await harness();
  try {
    const id = h.identity(); let sameQueue = true;
    await h.api.writePlaybackCheckpoint('A', 'queue', id, 10, { current: h.current });
    const wait = h.holdWrite(), stale = h.api.writePlaybackCheckpoint('A', 'queue', id, 88, { current: () => sameQueue });
    await waitForWrite(h, 2); sameQueue = false;
    const clearing = h.api.clearPlaybackCheckpoint('A', 'queue');
    wait.resolve(); assert.equal(await stale, false); await clearing;
    assert.equal((await h.jsonFiles()).length, 0);
    assert.equal(await h.api.readPlaybackCheckpoint('A', 'queue', id), undefined);
    const replacement = h.identity({ checkpointId: 'new-queue' });
    assert.equal(await h.api.writePlaybackCheckpoint('A', 'queue', replacement, 2, { current: h.current }), true);
    assert.equal(await h.api.readPlaybackCheckpoint('A', 'queue', id), undefined);
  } finally { await h.dispose(); }
});

test('profile deletion revokes pending writes and removes all its queue keys without touching another profile', async () => {
  const h = await harness();
  try {
    const id = h.identity(); await h.api.writePlaybackCheckpoint('A', 'online', id, 8, { current: h.current });
    await h.api.writePlaybackCheckpoint('A', 'offline', id, 9, { current: h.current });
    h.auth.setState({ auth: { id: 'B' } });
    await h.api.writePlaybackCheckpoint('B', 'online', id, 30, { current: h.current });
    h.auth.setState({ auth: h.firstA });
    const wait = h.holdWrite(), old = h.api.writePlaybackCheckpoint('A', 'online', id, 99, { current: h.current });
    await waitForWrite(h, 4); const deleting = h.api.clearPlaybackCheckpoint('A');
    wait.resolve(); assert.equal(await old, false); await deleting;
    assert.equal((await h.jsonFiles()).length, 1);
    h.auth.setState({ auth: { id: 'B' } });
    assert.equal((await h.api.readPlaybackCheckpoint('B', 'online', id)).positionSec, 30);
  } finally { await h.dispose(); }
});

test('corrupt, oversized and invalid checkpoint records fall back without reading a large body', async () => {
  const h = await harness();
  try {
    const id = h.identity(); await h.api.writePlaybackCheckpoint('A', 'queue', id, 20, { current: h.current });
    const [file] = await h.jsonFiles(), record = JSON.parse(await fs.readFile(file, 'utf8'));
    for (const patch of [{ positionSec: -1 }, { positionSec: '20' }, { serial: 1.5 }, { savedAt: 0 }, { index: 600 }, { version: 2 }]) {
      await fs.writeFile(file, JSON.stringify({ ...record, ...patch }));
      assert.equal(await h.api.readPlaybackCheckpoint('A', 'queue', id), undefined);
    }
    await fs.writeFile(file, '{broken'); assert.equal(await h.api.readPlaybackCheckpoint('A', 'queue', id), undefined);
    await fs.writeFile(file, 'x'.repeat(20_000)); const reads = h.reads();
    assert.equal(await h.api.readPlaybackCheckpoint('A', 'queue', id), undefined); assert.equal(h.reads(), reads);
    assert.equal(await h.api.writePlaybackCheckpoint('A', 'queue', id, NaN, { current: h.current }), false);
    assert.equal(await h.api.writePlaybackCheckpoint('A', 'queue', id, Infinity, { current: h.current }), false);
  } finally { await h.dispose(); }
});

test('newest mismatching generation is not bypassed by an older matching slot, and ordered signatures are unambiguous', async () => {
  const h = await harness();
  try {
    const old = h.identity(), newer = h.identity({ checkpointId: 'replacement' });
    await h.api.writePlaybackCheckpoint('A', 'queue', old, 77, { current: h.current });
    await h.api.writePlaybackCheckpoint('A', 'queue', newer, 3, { current: h.current });
    assert.equal(await h.api.readPlaybackCheckpoint('A', 'queue', old), undefined);
    assert.equal((await h.api.readPlaybackCheckpoint('A', 'queue', newer)).positionSec, 3);
    const left = h.identity({ queue: [{ id: 'ab' }, { id: 'c' }], index: 0 });
    const right = h.identity({ queue: [{ id: 'a' }, { id: 'bc' }], index: 0 });
    assert.notEqual(left.signature, right.signature);
    assert.notEqual(h.api.newPlaybackQueueGeneration(), h.api.newPlaybackQueueGeneration(), 'same-millisecond full saves have different persisted tokens');
  } finally { await h.dispose(); }
});
