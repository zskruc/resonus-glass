import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { create } from 'zustand';
import ts from 'typescript';

/** Actual JS bridge with a controlled native event boundary. Native transport
 * SOAP behavior is covered separately by the module's Kotlin tests. */
function bridge() {
  const listeners = new Map<string, (event: any) => void>();
  const calls: { kind: string; args: unknown[] }[] = [];
  const native = { connect: async () => true, getVolume: async () => 40, disconnect: async () => {},
    addListener: (name: string, listener: (event: any) => void) => { listeners.set(name, listener); return { remove: () => { listeners.delete(name); } }; } };
  const imports: Record<string, unknown> = {
    'expo-modules-core': { requireOptionalNativeModule: () => native }, zustand: { create },
    '@/api/backend': { coverArtUrl: () => '', streamUrl: () => '' }, '@/api/data': { COVER: { card: 600 } },
    '@/lib/audioQuality': { transcodeTarget: () => ({}) },
    '@/lib/localHttp': { localFileUrl: () => '', publishLocalFiles: async () => {}, stopLocalHttp: async () => {} },
    '@/lib/localLibrary': { localCoverUrl: () => undefined }, '@/lib/perfLog': { note: () => {} },
    './auth': { useAuthStore: { getState: () => ({ auth: null, offline: false }) } },
    './castMedia': { castStop: () => {} }, './settings': { useSettings: { getState: () => ({}) } },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/store/upnp.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, setTimeout, clearTimeout, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  for (const name of ['onConnected', 'onDisconnected', 'onTrackChanged', 'onProgress', 'onPlayingChanged', 'onRepeatChanged', 'onVolumeChanged', 'onFinished', 'onLost']) {
    calls.push({ kind: 'register', args: [name] });
  }
  // Keep names stable rather than reusing callback payloads as labels.
  exports.initUpnp(Object.fromEntries(calls.filter((call) => call.kind === 'register').map(({ args: [name] }) =>
    [name, (...args: unknown[]) => { calls.push({ kind: String(name), args }); }])));
  return { exports, calls, send: (event: Record<string, unknown>) => listeners.get('state')!({ playbackState: 'PLAYING', positionMs: 10_000, durationMs: 200_000, ...event }),
    lost: (reason: string) => listeners.get('lost')!({ reason }) };
}

test('native-managed cast repeats remain app-owned and remote track IDs travel with indices', async () => {
  const h = bridge(); await h.exports.upnpConnect({ id: 'speaker', name: 'Speaker' });
  h.send({ nativeQueueManaged: true, queueIndex: 1, trackId: 'song-B', playMode: 'REPEAT_ONE' });
  assert.equal(h.calls.filter((call) => call.kind === 'onRepeatChanged').length, 0);
  assert.deepEqual(h.calls.find((call) => call.kind === 'onTrackChanged')!.args, [1, 10, 200, 'song-B']);
  h.send({ nativeQueueManaged: false, trackNumber: 2, playMode: 'REPEAT_ONE' });
  assert.deepEqual(h.calls.find((call) => call.kind === 'onRepeatChanged')!.args, ['one']);
});

test('unreachable polls never publish fake zero progress and lost connection retains the last position', async () => {
  const h = bridge(); await h.exports.upnpConnect({ id: 'speaker', name: 'Speaker' });
  h.send({ positionMs: 45_000 }); const count = h.calls.filter((call) => call.kind === 'onProgress').length;
  h.send({ reachable: false, positionMs: 0 });
  assert.equal(h.calls.filter((call) => call.kind === 'onProgress').length, count);
  assert.deepEqual(h.calls.filter((call) => call.kind === 'onPlayingChanged').at(-1)!.args, [true, true]);
  h.lost('unreachable'); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.exports.isUpnpConnected(), false);
  assert.deepEqual(h.calls.find((call) => call.kind === 'onDisconnected')!.args, [45]);
});
