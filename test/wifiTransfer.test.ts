import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise<void>((done) => setImmediate(done));
function harness() {
  const module: Record<string, any> = {}, calls: string[] = []; let release: (() => void) | undefined, hold = false, generation = 0;
  const state = () => JSON.stringify({ running: true, url: `http://192.168.1.2:1234/session${generation}`, maxFileBytes: 512 * 1024 * 1024, files: [], transfers: [], uploads: [] });
  const native = { startTransfer: async () => { calls.push('start'); if (hold) { hold = false; await new Promise<void>((done) => { release = done; }); } generation++; return state(); },
    stopTransfer: async () => { calls.push('stop'); }, transferStatus: async () => state(), setTransferEntries: async (value: string) => { calls.push(`files:${JSON.parse(value).length}`); }, copyTransferAddress: () => true };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/wifiTransfer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: module, URL, require: (id: string) => { assert.equal(id, 'expo-modules-core'); return { requireOptionalNativeModule: () => native }; } });
  return { api: module, calls, hold: () => { hold = true; }, release: () => release?.() };
}
test('transfer status accepts only private session addresses without credentials', () => {
  const h = harness();
  const data = { running: true, url: 'http://192.168.1.2:1000/token', maxFileBytes: 123, files: [], transfers: [], uploads: [] };
  assert.equal(h.api.parseWifiTransferSnapshot(JSON.stringify(data)).running, true);
  for (const url of ['https://public.test/token', 'http://127.0.0.1/token', 'http://user:secret@192.168.1.2/token', 'http://192.168.1.2/token?secret=x', 'http://192.168.1.2.evil.test/token']) assert.throws(() => h.api.parseWifiTransferSnapshot(JSON.stringify({ ...data, url })));
});
test('a superseded pending start cannot stop or publish files into a later transfer', async () => {
  const h = harness(), a = h.api.claimWifiTransfer(); h.hold(); const first = h.api.startWifiTransfer(a); await tick();
  const closed = h.api.stopWifiTransfer(a), b = h.api.claimWifiTransfer(), second = h.api.startWifiTransfer(b);
  h.release(); assert.equal(await first, undefined); await closed; assert.equal((await second).running, true);
  const before = h.calls.length; await h.api.stopWifiTransfer(a); assert.equal(h.calls.length, before, 'stale cleanup cannot stop B');
  assert.equal(await h.api.publishWifiTransferFiles(a, []), false);
  assert.equal(await h.api.publishWifiTransferFiles(b, [{ key: 'one', uri: 'content://media/one', name: 'one.mp3', mime: 'audio/mpeg' }]), true);
  await assert.rejects(h.api.publishWifiTransferFiles(b, [{ key: '../bad', uri: 'https://server/private', name: 'secret', mime: 'audio/mpeg' }]));
  await h.api.stopWifiTransfer(b);
});
test('shared music uses its actual downloaded container rather than its original server suffix', () => {
  const { wifiTransferTrackFileName: name } = harness().api;
  const song = { title: 'Song', artist: 'Artist', suffix: 'flac' };
  assert.equal(name(song, 'file:///cache/song.mp3'), 'Artist - Song.mp3');
  assert.equal(name(song, 'file:///cache/song%2EMP3?download=1'), 'Artist - Song.mp3');
  assert.equal(name({ ...song, suffix: 'M4A' }, 'content://media/external/audio/media/123'), 'Artist - Song.m4a');
  assert.equal(name({ ...song, suffix: 'M4B' }, 'content://media/external/audio/media/456'), 'Artist - Song.m4b');
  assert.equal(name({ title: 'Song', suffix: '../../secret' }, 'content://media/external/audio/media/123'), 'Song.mp3');
});
test('Chinese and emoji filenames stay within 200 UTF-8 bytes and retain the extension and both fields', () => {
  const { wifiTransferTrackFileName: name } = harness().api;
  const value = name({ title: '歌曲🎵'.repeat(100), artist: '艺术家'.repeat(100), suffix: 'flac' }, 'file:///cache/track.opus');
  assert.ok(Buffer.byteLength(value, 'utf8') <= 200); assert.ok(value.length <= 200);
  assert.ok(value.startsWith('艺术家')); assert.ok(value.includes(' - 歌曲🎵')); assert.ok(value.endsWith('.opus'));
  assert.equal(Buffer.from(value).toString(), value, 'UTF-8 truncation cannot split a code point');
});
test('shared filenames remove paths, control characters and desktop-reserved punctuation', () => {
  const { wifiTransferTrackFileName: name } = harness().api;
  const value = name({ title: '../A\\B\u0000:\"?<>|* . ', artist: 'AC/DC\u007f' }, 'file:///cache/no-extension');
  assert.equal(value, 'AC-DC - -A-B.mp3');
  assert.ok(!/[\\/\u0000-\u001f\u007f:*?"<>|]/.test(value));
  assert.equal(name({ title: '... ', artist: '' }, 'file:///cache/unknown'), 'track.mp3');
});
