import type { Song } from '@/api/subsonic';
import { shufflePlayCount, weightedShuffle } from './weightedShuffle';

export const RECOMMENDATION_KINDS = ['daily', 'rewind', 'releases'] as const;
export type RecommendationKind = typeof RECOMMENDATION_KINDS[number];
export const RECOMMENDATION_TRACKS = 24;
export const RECOMMENDATION_POOL_LIMIT = 600;
export interface RecommendationCandidates {
  songs: Song[];
  counts: Readonly<Record<string, number>>;
  rewindIds: ReadonlySet<string>;
  releaseIds: ReadonlySet<string>;
}
export interface DailyRecommendationSnapshot {
  version: 1; day: string; batch: number; generatedAt: number;
  lists: Record<RecommendationKind, Song[]>;
}
export const localRecommendationDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const text = (value: unknown, max = 2048) => typeof value === 'string' && value.length <= max ? value : undefined;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const identifier = (value: unknown, max = 1024) => {
  const valueText = text(value, max);
  return valueText && !/:\/\/|^(?:data|file|content):/i.test(valueText) ? valueText : undefined;
};

/** Keep playback metadata, never whole cover bitmaps, comments or stream URLs. */
export function recommendationSong(raw: unknown): Song | null {
  if (!raw || typeof raw !== 'object') return null;
  const song = raw as Song;
  if (!identifier(song.id) || !text(song.title, 4096) || song.url || song.podcastChannelId || song.unavailable) return null;
  return { id: song.id, title: song.title, artist: text(song.artist), album: text(song.album),
    albumId: identifier(song.albumId), artistId: identifier(song.artistId), coverArt: identifier(song.coverArt, 2048),
    duration: number(song.duration), year: number(song.year),
    track: number(song.track), discNumber: number(song.discNumber), playCount: number(song.playCount),
    suffix: text(song.suffix, 32), bitRate: number(song.bitRate), dlBitRate: number(song.dlBitRate),
    bitDepth: number(song.bitDepth), samplingRate: number(song.samplingRate),
    starred: text(song.starred), explicitStatus: text(song.explicitStatus, 32),
  };
}
function uniqueSongs(source: readonly unknown[], limit: number): Song[] {
  const seen = new Set<string>(), out: Song[] = [];
  for (const raw of source) {
    const song = recommendationSong(raw);
    if (!song || seen.has(song.id)) continue;
    seen.add(song.id); out.push(song);
    if (out.length >= limit) break;
  }
  return out;
}
export function decodeDailyRecommendations(raw: string | null): DailyRecommendationSnapshot | null {
  if (!raw) return null;
  let parsed: DailyRecommendationSnapshot;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (parsed?.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.day) || !Number.isSafeInteger(parsed.batch)
    || parsed.batch < 0 || !Number.isFinite(parsed.generatedAt) || !parsed.lists
    || RECOMMENDATION_KINDS.some((kind) => !Array.isArray(parsed.lists[kind]))) return null;
  return { version: 1, day: parsed.day, batch: parsed.batch, generatedAt: parsed.generatedAt,
    lists: Object.fromEntries(RECOMMENDATION_KINDS.map((kind) => [kind, uniqueSongs(parsed.lists[kind], RECOMMENDATION_TRACKS)])) as DailyRecommendationSnapshot['lists'] };
}

/** Repeatable within a saved day/batch; no global Math.random state is changed. */
export function recommendationRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return ((state >>> 0) + 0.5) / 4294967296;
  };
}
function freshFirst(source: Song[], previous: readonly Song[], pick: (songs: Song[]) => Song[]): Song[] {
  const old = new Set(previous.map((song) => song.id));
  const fresh = pick(source.filter((song) => !old.has(song.id))).slice(0, RECOMMENDATION_TRACKS);
  if (fresh.length >= Math.min(source.length, RECOMMENDATION_TRACKS)) return fresh;
  const used = new Set(fresh.map((song) => song.id));
  return fresh.concat(pick(source.filter((song) => !used.has(song.id))).slice(0, RECOMMENDATION_TRACKS - fresh.length));
}
export function buildDailyRecommendations(
  source: RecommendationCandidates, profile: string, now: Date, batch = 0, previous?: DailyRecommendationSnapshot | null,
): DailyRecommendationSnapshot {
  const day = localRecommendationDay(now), random = recommendationRandom(`${profile}|${day}|${batch}`);
  const pool = uniqueSongs(source.songs, RECOMMENDATION_POOL_LIMIT);
  const year = now.getFullYear();
  const older = pool.filter((song) => source.rewindIds.has(song.id)
    || !!song.year && song.year <= year - 5 && shufflePlayCount(song, source.counts) > 0);
  const rewind = older.length ? older : pool.filter((song) => !!song.year && song.year <= year - 5);
  const releases = pool.filter((song) => source.releaseIds.has(song.id)
    || !!song.year && song.year >= year - 1 && song.year <= year);
  const daily = freshFirst(pool, previous?.lists.daily ?? [], (songs) => {
    // Half familiar, half discovery, both drawn from real catalogue entries.
    const familiar = weightedShuffle(songs, 'frequentSongs', source.counts, random).slice(0, RECOMMENDATION_TRACKS / 2);
    const taken = new Set(familiar.map((song) => song.id));
    const discovery = weightedShuffle(songs.filter((song) => !taken.has(song.id)), 'rareSongs', source.counts, random);
    return familiar.concat(discovery);
  });
  return { version: 1, day, batch, generatedAt: now.getTime(), lists: {
    daily,
    rewind: freshFirst(rewind, previous?.lists.rewind ?? [], (songs) => weightedShuffle(songs, 'rareSongs', source.counts, random)),
    releases: freshFirst(releases, previous?.lists.releases ?? [], (songs) => weightedShuffle(songs, 'uniform', {}, random)),
  } };
}

export interface DailyRecommendationsState {
  profile: string; snapshot: DailyRecommendationSnapshot | null; loading: boolean; error: boolean;
}
/** Daily persistence and ownership are independent from navigation/rendering. */
export function createDailyRecommendations(deps: {
  profile(): string; owner(): unknown; now(): Date;
  read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void>;
  candidates(current: () => boolean): Promise<RecommendationCandidates>;
  publish(state: DailyRecommendationsState): void;
}) {
  let state: DailyRecommendationsState = { profile: '', snapshot: null, loading: false, error: false };
  let generation = 0;
  let running: { profile: string; owner: unknown; work: Promise<void> } | null = null;
  let writes: Promise<unknown> = Promise.resolve();
  const publish = (next: DailyRecommendationsState) => { state = next; deps.publish(next); };
  const key = (profile: string) => `resonus.dailyRecommendations.${profile}`;
  function ensure(refresh = false): Promise<void> {
    const profile = deps.profile(), owner = deps.owner(), now = deps.now();
    if (!refresh && running?.profile === profile && running.owner === owner) return running.work;
    if (!refresh && state.profile === profile && state.snapshot?.day === localRecommendationDay(now)) return Promise.resolve();
    const token = ++generation;
    const current = () => token === generation && deps.profile() === profile && deps.owner() === owner;
    const retained = state.profile === profile ? state.snapshot : null;
    publish({ profile, snapshot: retained, loading: true, error: false });
    const work = (async () => {
      let saved = retained;
      try {
        if (!saved) saved = decodeDailyRecommendations(await deps.read(key(profile)));
        if (!current()) return;
        if (!refresh && saved?.day === localRecommendationDay(now)) {
          publish({ profile, snapshot: saved, loading: false, error: false }); return;
        }
        const candidates = await deps.candidates(current);
        if (!current()) return;
        const batch = saved?.day === localRecommendationDay(now) ? saved.batch + 1 : 0;
        const next = buildDailyRecommendations(candidates, profile, now, batch, saved);
        const save = writes.catch(() => {}).then(async () => {
          if (current()) await deps.write(key(profile), JSON.stringify(next));
        });
        writes = save; await save;
        if (current()) publish({ profile, snapshot: next, loading: false, error: false });
      } catch {
        if (current()) publish({ profile, snapshot: saved, loading: false, error: true });
      }
    })();
    const ticket = { profile, owner, work }; running = ticket;
    void work.finally(() => { if (running === ticket) running = null; });
    return work;
  }
  return { ensure, refresh: () => ensure(true), invalidate() {
    generation++; running = null;
    const profile = deps.profile();
    publish({ profile, snapshot: profile === state.profile ? state.snapshot : null, loading: false, error: false });
  } };
}
