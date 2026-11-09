import type { Song } from '@/api/subsonic';

export const LISTENING_SPACES = ['music', 'podcast', 'radio', 'audiobook'] as const;
export type ListeningSpace = typeof LISTENING_SPACES[number];
export interface SavedListeningSong {
  id: string; title: string; artist?: string; album?: string; albumId?: string; coverArt?: string;
  duration?: number; track?: number; discNumber?: number; year?: number; podcastChannelId?: string;
  artistId?: string; genre?: string; suffix?: string; bitRate?: number; bitDepth?: number; samplingRate?: number;
  replayGain?: Song['replayGain'];
}
export interface ListeningSession {
  space: ListeningSpace; songs: SavedListeningSong[]; index: number; position: number;
  shuffle: boolean; repeat: 'off' | 'one' | 'all'; speed: number; source?: string; href?: string; savedAt: number;
  originalSongs?: SavedListeningSong[]; queueDealt?: boolean;
}
export interface ShuffleLink { from: SavedListeningSong; to: SavedListeningSong; direction: 'next' | 'previous' }
export interface LocalChapter { title: string; start: number; end?: number }
export interface ChapterOverride { songId: string; title: string; duration?: number; chapters: LocalChapter[] }
export interface ListeningSourceData {
  separateSessions: boolean;
  sessions: Partial<Record<ListeningSpace, ListeningSession>>;
  links: ShuffleLink[]; chapters: Record<string, ChapterOverride>;
}
export interface ListeningToolsBackup { version: 1; sources: Record<string, ListeningSourceData> }
export const emptyListeningSource = (): ListeningSourceData => ({ separateSessions: false, sessions: {}, links: [], chapters: {} });
export const emptyListeningTools = (): ListeningToolsBackup => ({ version: 1, sources: {} });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, limit = 500): v is string => typeof v === 'string' && !!v.trim() && v.length <= limit && !/[\u0000-\u001f]/.test(v);
export const validListeningId = (v: unknown): v is string => text(v, 2048) && !/^https?:/i.test(v);
const finite = (v: unknown, min = 0, max = 604800): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** A strict allowlist: auth, source URLs, embedded art and saved paths never enter backups. */
export function savedListeningSong(value: unknown): SavedListeningSong | undefined {
  if (!object(value) || !validListeningId(value.id) || !text(value.title)) return;
  const result: SavedListeningSong = { id: value.id, title: value.title };
  for (const key of ['artist', 'album', 'genre'] as const) if (text(value[key])) result[key] = value[key];
  if (text(value.suffix, 32)) result.suffix = value.suffix;
  for (const key of ['albumId', 'artistId', 'podcastChannelId', 'coverArt'] as const) {
    if (validListeningId(value[key]) && !/^[a-z]+:\/\//i.test(value[key])) result[key] = value[key];
  }
  for (const key of ['duration', 'track', 'discNumber', 'year', 'bitRate', 'bitDepth', 'samplingRate'] as const) if (finite(value[key], 0, 768000)) result[key] = value[key];
  if (object(value.replayGain)) {
    const gains: NonNullable<Song['replayGain']> = {};
    for (const key of ['trackGain', 'albumGain'] as const) if (finite(value.replayGain[key], -100, 100)) gains[key] = value.replayGain[key];
    for (const key of ['trackPeak', 'albumPeak'] as const) if (finite(value.replayGain[key], 0, 100)) gains[key] = value.replayGain[key];
    if (Object.keys(gains).length) result.replayGain = gains;
  }
  return result;
}
export function normalizeLocalChapters(value: unknown, duration?: number): LocalChapter[] {
  if (!Array.isArray(value) || !value.length || value.length > 1000) throw new Error('Invalid chapter list');
  const result: LocalChapter[] = [];
  for (const item of value) {
    if (!object(item) || !text(item.title) || !finite(item.start)
      || (duration !== undefined && item.start >= duration)
      || (item.end !== undefined && (!finite(item.end) || item.end <= item.start || duration !== undefined && item.end > duration))) throw new Error('Invalid chapter time');
    const before = result.at(-1);
    if (before && (before.start >= item.start || before.end !== undefined && before.end > item.start)) throw new Error('Chapter times must increase');
    result.push({ title: item.title.trim(), start: item.start, ...(item.end !== undefined ? { end: item.end } : {}) });
  }
  return result;
}
export function validateListeningTools(value: unknown): ListeningToolsBackup {
  if (!object(value) || value.version !== 1 || !object(value.sources) || Object.keys(value.sources).length > 16) throw new Error('Invalid listening backup');
  const result = emptyListeningTools(); let chapterCount = 0;
  for (const [key, data] of Object.entries(value.sources)) {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(key) || !object(data) || !object(data.sessions) || !Array.isArray(data.links) || data.links.length > 2000 || !object(data.chapters) || Object.keys(data.chapters).length > 500) throw new Error('Invalid listening source');
    const source = emptyListeningSource();
    if (data.separateSessions !== undefined && typeof data.separateSessions !== 'boolean') throw new Error('Invalid session preference');
    source.separateSessions = data.separateSessions === true;
    for (const [space, session] of Object.entries(data.sessions)) {
      if (!LISTENING_SPACES.includes(space as ListeningSpace) || !object(session) || session.space !== space || !Array.isArray(session.songs) || !session.songs.length || session.songs.length > 500
        || !Number.isInteger(session.index) || !finite(session.index, 0, session.songs.length - 1) || !finite(session.position) || !finite(session.savedAt, 0, 9e15)
        || !['off', 'one', 'all'].includes(String(session.repeat)) || typeof session.shuffle !== 'boolean' || !finite(session.speed, 0.5, 2)) throw new Error('Invalid listening session');
      const songs = session.songs.map(savedListeningSong); if (songs.some((song) => !song)) throw new Error('Invalid saved song');
      let originalSongs: SavedListeningSong[] | undefined;
      if (session.originalSongs !== undefined) {
        if (!Array.isArray(session.originalSongs) || session.originalSongs.length > 500) throw new Error('Invalid original queue');
        const original = session.originalSongs.map(savedListeningSong); if (original.some((song) => !song)) throw new Error('Invalid original queue song');
        originalSongs = original as SavedListeningSong[];
      }
      if (session.queueDealt !== undefined && typeof session.queueDealt !== 'boolean') throw new Error('Invalid shuffled queue');
      source.sessions[space as ListeningSpace] = { space: space as ListeningSpace, songs: songs as SavedListeningSong[], index: session.index, position: session.position,
        shuffle: session.shuffle, repeat: session.repeat as ListeningSession['repeat'], speed: session.speed, savedAt: session.savedAt,
        ...(originalSongs ? { originalSongs } : {}), ...(session.queueDealt !== undefined ? { queueDealt: session.queueDealt as boolean } : {}),
        ...(text(session.source) ? { source: session.source } : {}), ...(typeof session.href === 'string' && /^\/[a-zA-Z0-9_/?=&.%:-]{0,240}$/.test(session.href) ? { href: session.href } : {}) };
    }
    for (const link of data.links) {
      if (!object(link)) throw new Error('Invalid shuffle link');
      const from = savedListeningSong(link.from), to = savedListeningSong(link.to);
      if (!from || !to || from.id === to.id || !from.albumId || from.albumId !== to.albumId || !['next', 'previous'].includes(String(link.direction))) throw new Error('Invalid shuffle link');
      source.links.push({ from, to, direction: link.direction as ShuffleLink['direction'] });
    }
    for (const [songId, override] of Object.entries(data.chapters)) {
      if (!validListeningId(songId) || !object(override) || override.songId !== songId || !text(override.title) || override.duration !== undefined && !finite(override.duration, 0.001)) throw new Error('Invalid chapter override');
      const chapters = normalizeLocalChapters(override.chapters, override.duration as number | undefined);
      chapterCount += chapters.length; if (chapterCount > 10000) throw new Error('Too many chapters');
      Object.defineProperty(source.chapters, songId, { enumerable: true, configurable: true, writable: true, value: { songId, title: override.title, ...(override.duration !== undefined ? { duration: override.duration } : {}), chapters } });
    }
    Object.defineProperty(result.sources, key, { enumerable: true, configurable: true, writable: true, value: source });
  }
  return result;
}

/** Disjoint chains; conflicting or cyclic edges are ignored deterministically. */
export function shuffleLinkedGroups<T extends { id: string }>(items: readonly T[], links: readonly ShuffleLink[], shuffle: (items: T[]) => T[], lead?: T, leadIndex?: number): T[] {
  if (!links.length) { const at = leadIndex ?? (lead ? items.indexOf(lead) : -1);
    return lead ? [lead, ...shuffle(items.filter((_, index) => index !== at))] : shuffle([...items]); }
  const next = new Map<string, string>(), prev = new Map<string, string>();
  for (const link of links) {
    const a = link.from.id, b = link.to.id;
    if (a === b || next.has(a) || prev.has(b)) continue;
    let cursor: string | undefined = b; const visited = new Set<string>();
    while (cursor && !visited.has(cursor) && cursor !== a) { visited.add(cursor); cursor = next.get(cursor); }
    if (cursor === a) continue;
    next.set(a, b); prev.set(b, a);
  }
  const first = new Map<string, number>(); items.forEach((item, i) => { if (!first.has(item.id)) first.set(item.id, i); });
  const used = new Set<number>(), groups: T[][] = [], positions = new Map<T[], number[]>();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    if (first.get(items[i].id) !== i) { used.add(i); const group = [items[i]]; groups.push(group); positions.set(group, [i]); continue; }
    let at = i;
    while (prev.has(items[at].id) && first.has(prev.get(items[at].id)!)) { const previous = first.get(prev.get(items[at].id)!)!; if (used.has(previous)) break; at = previous; }
    const group: T[] = [], places: number[] = [];
    while (!used.has(at)) {
      used.add(at); group.push(items[at]); places.push(at); const id = next.get(items[at].id), following = id === undefined ? undefined : first.get(id);
      if (following === undefined) break; at = following;
    }
    groups.push(group); positions.set(group, places);
  }
  const output: T[] = [];
  if (lead) { const index = groups.findIndex((group) => leadIndex === undefined ? group.includes(lead) : positions.get(group)?.includes(leadIndex)); if (index >= 0) { const group = groups.splice(index, 1)[0], offset = leadIndex === undefined ? group.indexOf(lead) : positions.get(group)!.indexOf(leadIndex); output.push(...group.slice(offset)); if (offset) groups.push(group.slice(0, offset)); } }
  const heads = groups.map((group) => group[0]), ordered = shuffle(heads), buckets = new Map<T, T[][]>();
  for (const group of groups) { const list = buckets.get(group[0]) ?? []; list.push(group); buckets.set(group[0], list); }
  for (const head of ordered) { const group = buckets.get(head)?.shift(); if (group) output.push(...group); }
  return output;
}
/** Explicit directional links may bring a missing neighbour, never duplicate it. */
export function expandShuffleLinks(source: readonly Song[], links: readonly ShuffleLink[]): Song[] {
  if (!links.length) return source as Song[];
  const output = [...source], seen = new Set(source.map((song) => song.id));
  const byAnchor = new Map<string, SavedListeningSong[]>();
  for (const link of links) { const anchor = link.direction === 'next' ? link.from : link.to, target = link.direction === 'next' ? link.to : link.from;
    const targets = byAnchor.get(anchor.id) ?? []; targets.push(target); byAnchor.set(anchor.id, targets); }
  for (let index = 0; index < output.length && output.length < source.length + 1000; index++) {
    for (const target of byAnchor.get(output[index].id) ?? []) if (!seen.has(target.id)) { seen.add(target.id); output.push({ ...target }); }
  }
  return output;
}
export function sessionSpace(song: Song | null, audiobook = false): ListeningSpace {
  return song?.podcastChannelId ? 'podcast' : song?.url && !song.vod ? 'radio' : audiobook ? 'audiobook' : 'music';
}
