import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { createAppAccentFollower, normalizeAccentSource } from '@/lib/appAccent';
import { createPlaybackColorWarmup, canWarmPlaybackArtwork, playbackColorWarmupIndices } from '@/lib/playbackColorWarmup';
import { paletteContrast } from '@/lib/playerPalette';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const request = (identity: string, uri = identity, mode: 'dark' | 'light' = 'dark') => ({ identity, uri, mode, enabled: true });

test('a warmed artwork accent applies synchronously without an additional read or repeated publication', () => {
  let reads = 0;
  const colors: (string | null)[] = [];
  const follower = createAppAccentFollower({ cached: () => '#7543ab', read: async () => { reads++; return '#7543ab'; }, publish: (color) => colors.push(color) });
  follower.update(request('song-a', 'album'));
  assert.deepEqual(colors, ['#7543ab']);
  follower.update(request('song-b', 'album'));
  assert.deepEqual(colors, ['#7543ab'], 'two songs on one album do not repaint the whole application');
  assert.equal(reads, 0);
});

test('late reads cannot overwrite a newer song, manual selection, account clear or background suspension', async () => {
  const pending = new Map<string, ReturnType<typeof deferred<string | null>>>();
  const colors: (string | null)[] = [];
  const follower = createAppAccentFollower({ cached: () => undefined, read: (uri) => {
    const next = deferred<string | null>(); pending.set(uri, next); return next.promise;
  }, publish: (color) => colors.push(color) });
  follower.update(request('old')); follower.update(request('new'));
  pending.get('old')!.resolve('#ff0000'); await flush();
  assert.deepEqual(colors, []);
  pending.get('new')!.resolve('#0000ff'); await flush();
  assert.deepEqual(colors, ['#0000ff']);
  follower.update(request('suspended')); follower.suspend();
  pending.get('suspended')!.resolve('#00ff00'); await flush();
  assert.deepEqual(colors, ['#0000ff'], 'backgrounding preserves the current applied color');
  follower.update(request('manual')); follower.update({ ...request('manual'), enabled: false });
  pending.get('manual')!.resolve('#ffffff'); await flush();
  assert.deepEqual(colors, ['#0000ff', null]);
  follower.update(request('other-account')); follower.clear();
  pending.get('other-account')!.resolve('#ff0000'); await flush();
  assert.deepEqual(colors, ['#0000ff', null]);
});

test('failed or missing artwork falls back and can retry; invalid seeds never paint application colors', async () => {
  let calls = 0;
  const colors: (string | null)[] = [];
  const follower = createAppAccentFollower({ cached: () => undefined,
    read: async () => (++calls === 1 ? null : calls === 2 ? 'rgba(1,2,3,.2)' : '#abddef'), publish: (color) => colors.push(color) });
  follower.update(request('a')); await flush();
  follower.update(request('a')); await flush();
  follower.update({ ...request('none'), uri: undefined });
  follower.update(request('b')); await flush();
  assert.deepEqual(colors, [null, '#abddef']);
  assert.equal(normalizeAccentSource('artwork'), 'artwork');
  for (const invalid of ['automatic', 'Manual', undefined, true, {}, ['artwork']]) assert.equal(normalizeAccentSource(invalid), 'manual');
});

function compiled(file: string) {
  return ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
function themeHarness() {
  const exports: Record<string, any> = {};
  runInNewContext(compiled('../src/theme/index.ts'), { exports, setTimeout, clearTimeout,
    require(name: string) {
      if (name === 'react') return { useSyncExternalStore: (_s: unknown, read: () => unknown) => read() };
      if (name === 'react-native') return { Platform: { OS: 'android', select: (values: any) => values.android ?? values.default },
        Appearance: { getColorScheme: () => 'dark', addChangeListener: () => ({ remove() {} }) },
        AppState: { addEventListener: () => ({ remove() {} }) } };
      throw new Error(name);
    },
  });
  return exports;
}

test('real global theme keeps manual accents separate, adapts artwork contrast in both modes and does not tint backgrounds', () => {
  const theme = themeHarness();
  theme.applyAccents('#ad67e5', '#a52243');
  const manualDark = theme.colors.accent;
  theme.applyThemePreference('light'); const manualLight = theme.colors.accent;
  theme.applyAccents('#ad67e5', '#a52243', 'artwork');
  for (const seed of ['#000000', '#ffffff', '#777777', '#112244', '#e5e0ff', '#ff1100', '#ffff00']) {
    theme.applyArtworkAccent(seed);
    for (const mode of ['light', 'dark']) {
      theme.applyThemePreference(mode);
      const before = { ...theme.colors };
      assert.ok(paletteContrast(theme.colors.accent, theme.colors.background) >= 4.5, `${seed} ${mode}`);
      assert.ok(paletteContrast(theme.colors.accent, theme.colors.onAccent) >= 4.5, `onAccent: ${seed} ${mode}`);
      theme.applyArtworkAccent('#5678ad');
      for (const key of Object.keys(before).filter((key) => !['accent', 'accentPressed', 'accentVivid'].includes(key))) {
        assert.equal(theme.colors[key], before[key], `${key} must remain independent from artwork`);
      }
      theme.applyArtworkAccent(seed);
    }
  }
  theme.applyAccents('#ad67e5', '#a52243', 'manual');
  theme.applyThemePreference('dark'); assert.equal(theme.colors.accent, manualDark);
  theme.applyThemePreference('light'); assert.equal(theme.colors.accent, manualLight);
  theme.applyAccents('#1DB954', '#1DB954', 'artwork', true);
  assert.equal(theme.colors.accentVivid, '#1DB954', 'factory/profile handoff clears the previous session-only artwork seed');
});

function store<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<(value: T, previous: T) => void>();
  return { getState: () => state, subscribe: (callback: (value: T, previous: T) => void) => { listeners.add(callback); return () => listeners.delete(callback); },
    set(next: Partial<T>) { const previous = state; state = { ...state, ...next }; for (const cb of listeners) cb(state, previous); } };
}

test('real warmup adapter applies current cached colors and blocks the old queue during an account handoff', () => {
  let scope = 'one';
  const auth = store({ auth: {} as object | null, offline: false, hydrating: false, offlineSource: 'downloads' });
  const queue = [{ id: 'red', uri: 'red' }, { id: 'blue', uri: 'blue' }];
  const player = store({ queue, index: 0, repeat: 'off' });
  const settings = store({ accentSource: 'artwork', hydrated: true });
  const downloads = store({ files: {} }); const cache = store({ entries: {} });
  const colors: (string | null)[] = [];
  const cleanups: (() => void)[] = [];
  let appStateChanged = () => {};
  let painted: string | null = null;
  const state: any = { currentState: 'active', addEventListener: (_name: string, callback: () => void) => {
    appStateChanged = callback; return { remove() {} };
  } };
  const dependencies: Record<string, unknown> = {
    react: { useRef: (value: unknown) => ({ current: value }), useState: (init: () => unknown) => [init()],
      useEffect: (work: () => (() => void) | void) => { const close = work(); if (close) cleanups.push(close); } },
    'react-native': { AppState: state },
    '@/api/data': { CACHED_COVER: 'cached:', COVER: { thumb: 120 }, songCoverUrl: (song: any) => song.uri },
    '@/hooks/useDominantColor': { cachedCoverTint: (uri: string) => uri === 'red' ? '#ff0000' : '#0000ff',
      readSharedCoverTint: async () => '#ffffff', prefetchCoverTint: async () => {} },
    '@/lib/appAccent': { createAppAccentFollower },
    '@/lib/playbackColorWarmup': { createPlaybackColorWarmup, canWarmPlaybackArtwork, playbackColorWarmupIndices },
    '@/store/auth': { useAuthStore: auth, profileScopeId: () => scope }, '@/store/player': { usePlayerStore: player },
    '@/store/settings': { useSettings: settings }, '@/store/downloads': { useDownloads: downloads },
    '@/store/songCache': { useSongCache: cache, cachedUri: () => undefined },
    '@/theme': { applyArtworkAccent: (color: string | null) => { painted = color; colors.push(color); }, themeMode: () => 'dark', useThemeMode: () => 'dark' },
  };
  const exports: Record<string, any> = {};
  runInNewContext(compiled('../src/components/PlaybackColorWarmup.tsx'), { exports,
    require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  exports.PlaybackColorWarmup();
  assert.deepEqual(colors, ['#ff0000']);
  player.set({ index: 1 }); assert.deepEqual(colors, ['#ff0000', '#0000ff']);
  state.currentState = 'background'; appStateChanged();
  settings.set({ accentSource: 'manual' });
  assert.equal(painted, null, 'manual/factory reset must also invalidate the follower while backgrounded');
  painted = null; // importSettings resets the theme's session-only artwork cache.
  settings.set({ accentSource: 'artwork' });
  state.currentState = 'active'; appStateChanged();
  assert.equal(painted, '#0000ff', 'restoring automatic in the background must reapply even the same cached color');
  scope = 'two'; auth.set({ auth: {} });
  assert.equal(colors.at(-1), null);
  settings.set({ hydrated: false }); settings.set({ hydrated: true });
  assert.equal(colors.at(-1), null, 'new preferences alone cannot adopt the old account queue');
  player.set({ queue: [{ id: 'red', uri: 'red' }], index: 0 });
  assert.equal(colors.at(-1), '#ff0000');
  settings.set({ accentSource: 'manual' }); assert.equal(colors.at(-1), null);
  cleanups.forEach((close) => close());
});
