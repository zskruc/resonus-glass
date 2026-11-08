import { normalizeShuffleMode, type ShuffleMode } from './weightedShuffle';

export interface ShufflePreferenceSnapshot { profile: string; mode: ShuffleMode; hydrated: boolean; error: boolean }
export function createShufflePreference(deps: {
  profile(): string; read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void>;
  publish(snapshot: ShufflePreferenceSnapshot): void;
}) {
  let current: ShufflePreferenceSnapshot = { profile: '', mode: 'uniform', hydrated: false, error: false };
  let generation = 0, revision = 0;
  let reading: { profile: string; job: Promise<void> } | null = null;
  let writing: Promise<unknown> = Promise.resolve();
  const publish = (snapshot: ShufflePreferenceSnapshot) => { current = snapshot; deps.publish(snapshot); };
  const key = (profile: string) => `resonus.shufflePolicy.${profile}`;
  function hydrate(): Promise<void> {
    const profile = deps.profile();
    if (reading?.profile === profile) return reading.job;
    // Shuffle actions may ask repeatedly. Reuse the owned preference instead
    // of flashing uniform while rereading it; an accepted save settles first.
    if (current.profile === profile && current.hydrated && !current.error) return writing.then(() => {}, () => {});
    const token = ++generation;
    const editRevision = revision, pendingWrites = writing;
    publish({ profile, mode: 'uniform', hydrated: false, error: false });
    const job = (async () => {
      try {
        // An accepted A save still belongs to A after A -> B -> A. Reading
        // before that write settles would restore the older disk value.
        await pendingWrites.catch(() => {});
        const raw = await deps.read(key(profile));
        if (token !== generation || editRevision !== revision || deps.profile() !== profile) return;
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        const mode = normalizeShuffleMode(parsed && typeof parsed === 'object' && 'mode' in parsed ? parsed.mode : parsed);
        publish({ profile, mode, hydrated: true, error: false });
      } catch {
        if (token === generation && deps.profile() === profile) publish({ profile, mode: 'uniform', hydrated: false, error: true });
      }
    })();
    const owner = { profile, job }; reading = owner;
    void job.finally(() => { if (reading === owner) reading = null; });
    return job;
  }
  return {
    hydrate,
    getMode: () => current.profile === deps.profile() && current.hydrated ? current.mode : 'uniform' as ShuffleMode,
    async setMode(mode: ShuffleMode): Promise<void> {
      const profile = deps.profile();
      if (!current.hydrated || current.profile !== profile) await hydrate();
      if (!current.hydrated || current.profile !== profile || deps.profile() !== profile) throw new Error('Shuffle preference is unavailable');
      const next = normalizeShuffleMode(mode), token = generation, edit = ++revision;
      const work = writing.catch(() => {}).then(() => deps.write(key(profile), JSON.stringify({ version: 1, mode: next })));
      writing = work;
      try {
        await work;
        if (token === generation && edit === revision && profile === deps.profile()) publish({ profile, mode: next, hydrated: true, error: false });
      } catch (error) {
        if (token === generation && edit === revision && profile === deps.profile()) publish({ ...current, error: true });
        throw error;
      }
    },
  };
}
