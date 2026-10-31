import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Song } from '@/api/backend';

const h = { profile: 'A', offsetProfile: 'A', offset: 250,
  raw: { synced: true, lines: [{ start: 1000, value: 'line', words: [{ start: 1000, end: 2000, value: 'line' }] }] },
  option: undefined as any, prefetched: undefined as any, hydrated: [] as string[] };
Object.assign(globalThis, { __lyricHookHarness: h });
const stubs = new Map([
  ['react', 'export const useEffect = effect => { effect() }; export const useCallback = value => value'],
  ['@tanstack/react-query', `export const useQuery = options => {
    const h = globalThis.__lyricHookHarness; h.option = options;
    return { data: options.select(h.raw), isLoading: false };
  }`],
  ['@/api/data', 'export const getSongLyrics = async () => globalThis.__lyricHookHarness.raw'],
  ['@/api/backend', 'export {}'],
  ['@/lib/query', 'export const queryClient = { prefetchQuery: options => { globalThis.__lyricHookHarness.prefetched = options } }'],
  ['@/store/auth', `export const profileScopeId = () => globalThis.__lyricHookHarness.profile;
    export const useAuthStore = Object.assign(selector => selector({ auth: {}, offline: false }), { getState: () => ({ auth: {} }) })`],
  ['@/store/settings', "export const useSettings = Object.assign(selector => selector({ lyricsSource: 'off' }), { getState: () => ({ lyricsSource: 'off' }) })"],
  ['@/store/lyricOffsets', `export const useLyricOffsets = Object.assign(selector => {
    const h = globalThis.__lyricHookHarness; return selector({ profile: h.offsetProfile, offsets: { song: h.offset } });
  }, { getState: () => ({ hydrate: async profile => { globalThis.__lyricHookHarness.hydrated.push(profile) } }) })`],
]);
const hook = registerHooks({ resolve(specifier, context, next) {
  const stub = stubs.get(specifier);
  return stub ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true } : next(specifier, context);
} });
const { useLyrics, prefetchLyrics } = await import('@/hooks/useLyrics');
hook.deregister();

test('all lyric consumers receive a derived timing view while the prefetched query stays raw and profile keyed', async () => {
  const song = { id: 'song', title: 'song' } as Song;
  const result = useLyrics(song);
  assert.equal(result.data!.lines[0].start, 1250);
  assert.equal(result.data!.lines[0].words![0].end, 2250);
  assert.equal(h.raw.lines[0].start, 1000);
  assert.deepEqual(h.option.queryKey, ['lyrics', 'song', 'off', 'A']);
  prefetchLyrics(song);
  assert.equal('select' in h.prefetched, false);
  assert.equal(await h.prefetched.queryFn(), h.raw);
  assert.deepEqual(h.prefetched.queryKey, h.option.queryKey);
  h.profile = 'B'; h.offsetProfile = 'A';
  const replacement = useLyrics(song);
  assert.equal(replacement.data!.lines[0].start, 1000, 'never reuse the other profile timing');
  assert.deepEqual(h.option.queryKey, ['lyrics', 'song', 'off', 'B']);
  assert.deepEqual(h.hydrated, ['A', 'B']);
});
