import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/api/lyricSources.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness() {
  const auth = { username: 'A', serverUrl: 'https://music.test' };
  const state = { auth: auth as typeof auth | null, offline: false, manualOffline: false };
  const lyrics = { synced: true, lines: [{ start: 1000, value: 'Server original', translation: '服务器译文' }] };
  const saved: any[] = [];
  let serverRequests = 0;
  class SubsonicRequestError extends Error {}
  const imports: Record<string, unknown> = {
    './backend': { getLyricsBySongId: async (owner: unknown, id: string) => {
      assert.equal(owner, auth); assert.equal(id, 'server-song'); serverRequests++; return lyrics;
    }, SubsonicRequestError },
    '@/lib/localLibrary': { hashKey: (value: string) => value },
    '@/lib/lyricOwner': { captureLyricOwner: (profile: string) => { const owner = state.auth; return () => profile === 'A' && state.auth === owner; } },
    '@/lib/lyricLibraryDb': { cachedLyricCandidates: async () => [], saveLyricCandidate: async (...args: any[]) => { saved.push(args); } },
    '@/lib/localLyrics': { getOnDeviceLyricCandidates: async () => [], findLrclibCandidates: async () => { throw new Error('unexpected external provider request'); } },
    './netGate': { isManualOffline: () => state.manualOffline },
    '@/store/auth': { useAuthStore: { getState: () => state }, profileScopeId: () => 'A' },
    '@/store/downloads': { activeServerDir: () => 'file:///downloads/A/' },
    '@/lib/downloadsDb': { songsByIds: async () => new Map([['server-song', { localUri: 'file:///downloads/A/song.flac' }]]) },
    '@/store/songCache': { cachedUri: () => undefined },
    '@/lib/lyricAudioUri': { ownedLyricAudioUri: (_profile: string, downloaded?: string) => downloaded },
  };
  const api: Record<string, any> = {};
  runInNewContext(code, { exports: api, require(name: string) { const customization = defaultCustomizationBoundary(name); if (customization) return customization; assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { state, lyrics, saved, api, requests: () => serverRequests };
}

test('explicit server source refresh works for an online downloaded server song without sending it to LRCLIB', async () => {
  const h = harness();
  const result = await h.api.getLyricCandidates({ id: 'server-song', title: 'Song', localUri: 'file:///downloads/A/song.flac' }, 'A', { server: true });
  assert.equal(h.requests(), 1); assert.equal(result.length, 1); assert.equal(result[0].id, 'server');
  assert.equal(result[0].lyrics, h.lyrics); assert.equal(h.saved[0][0], 'A'); assert.equal(h.saved[0][2].id, 'server');
});

test('manual offline blocks the explicit server refresh before any server/provider request', async () => {
  const h = harness(); h.state.offline = true; h.state.manualOffline = true;
  await assert.rejects(h.api.getLyricCandidates({ id: 'server-song', title: 'Song', localUri: 'file:///downloads/A/song.flac' }, 'A', { server: true }), /Offline mode/);
  assert.equal(h.requests(), 0); assert.equal(h.saved.length, 0);
});
import { defaultCustomizationBoundary } from './helpers/defaultCustomizationBoundary';
