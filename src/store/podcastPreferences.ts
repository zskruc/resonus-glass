/** Small, profile-owned preferences; writes are awaited and never overwrite a failed read. */
import { create } from 'zustand';
import { hashKey } from '@/lib/localLibrary';
import { deleteItem, getItem, setItemStrict } from '@/lib/storage';
import { podcastPlaybackPreferences, DEFAULT_PODCAST_PLAYBACK, type PodcastPlaybackPreferences } from '@/lib/podcastPlaybackPolicy';
import { profileScopeId, useAuthStore } from './auth';

const key = (profile: string) => `resonus.podcastPreferences.${hashKey(profile)}`;
let sequence = 0;
let accountEpoch = 0;
const removed = new Map<string, number>();
let pending: { profile: string; promise: Promise<void> } | undefined;
let writes: Promise<unknown> = Promise.resolve();
type State = { profile: string; ready: boolean; values: Record<string, PodcastPlaybackPreferences>;
  load(): Promise<void>; save(channelId: string, value: PodcastPlaybackPreferences): Promise<boolean> };
export const usePodcastPreferences = create<State>((set, get) => ({
  profile: '', ready: false, values: {},
  load: () => {
    const profile = profileScopeId();
    if (get().profile === profile && get().ready) return Promise.resolve();
    if (pending?.profile === profile) return pending.promise;
    const generation = ++sequence;
    set({ profile, ready: false, values: {} });
    const barrier = writes;
    const promise = (async () => {
      // A returning account must see every previously accepted durable write.
      await barrier.catch(() => {});
      const raw = await getItem(key(profile));
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid podcast preferences');
      const values = Object.fromEntries(Object.entries(parsed).slice(0, 2000).map(([id, value]) => [id, podcastPlaybackPreferences(value)]));
      if (generation === sequence && profileScopeId() === profile) set({ profile, ready: true, values });
    })().finally(() => { if (pending?.promise === promise) pending = undefined; });
    pending = { profile, promise }; return promise;
  },
  save: async (channelId, value) => {
    const profile = profileScopeId(), epoch = accountEpoch, revision = removed.get(profile) ?? 0;
    // Start hydration before joining the write queue: it must not wait on itself.
    const prepared = get().load();
    void prepared.catch(() => {});
    const run = async () => {
      await prepared;
      if (epoch !== accountEpoch || revision !== (removed.get(profile) ?? 0) || profileScopeId() !== profile || get().profile !== profile || !get().ready) return false;
      const values = { ...get().values, [channelId]: podcastPlaybackPreferences(value) };
      await setItemStrict(key(profile), JSON.stringify(values));
      if (epoch !== accountEpoch || revision !== (removed.get(profile) ?? 0) || profileScopeId() !== profile || get().profile !== profile) return false;
      set({ values }); return true;
    };
    const operation = writes.then(run, run); writes = operation.catch(() => {}); return operation;
  },
}));
export async function clearPodcastPreferencesProfile(profile: string): Promise<void> {
  removed.set(profile, (removed.get(profile) ?? 0) + 1);
  if (usePodcastPreferences.getState().profile === profile || pending?.profile === profile) {
    sequence++; pending = undefined; usePodcastPreferences.setState({ profile: '', ready: false, values: {} });
  }
  // Delete after native writes settle, so an old completion cannot recreate the key.
  const clear = writes.then(() => deleteItem(key(profile)), () => deleteItem(key(profile)));
  writes = clear.catch(() => {}); await clear;
}
useAuthStore.subscribe((state, previous) => {
  if (state.auth === previous.auth && (state.auth || state.offline === previous.offline)) return;
  accountEpoch++; sequence++; pending = undefined;
  usePodcastPreferences.setState({ profile: '', ready: false, values: {} });
});
export function getPodcastPreferences(channelId: string): PodcastPlaybackPreferences {
  const state = usePodcastPreferences.getState();
  return state.profile === profileScopeId() && state.ready && Object.hasOwn(state.values, channelId)
    ? state.values[channelId] : DEFAULT_PODCAST_PLAYBACK;
}
