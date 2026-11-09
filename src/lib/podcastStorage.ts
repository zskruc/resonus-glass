/** Current-profile podcast maintenance. Persistent user records and audio are separate. */
import * as FileSystem from 'expo-file-system/legacy';
import * as Db from './podcastDb';
import { hashKey } from './localLibrary';
import { captureLyricOwner } from './lyricOwner';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { queryClient } from './query';
import { podcastStorageLeaseVersion, protectedPodcastStorageChannels } from './podcastStorageLease';
export { protectPodcastStorageChannel } from './podcastStorageLease';

export type PodcastStorageCategory = 'audio' | 'covers' | 'catalog';
export interface PodcastStorageOptions { expectedProfile?: string; signal?: AbortSignal; current?: () => boolean }
export interface PodcastStorageUsage {
  audioBytes: number; coverBytes: number; catalogBytes: number; totalBytes: number;
  audioCount: number; coverCount: number; channelCount: number; episodeCount: number;
  databaseAllocatedBytes: number; databaseFreeBytes: number; databaseLiveBytes: number;
}
export interface PodcastStorageClearResult {
  removedFiles: number; removedRecords: number; removedBytes: number; skippedInUse: number; failedFiles: number;
}
const DAY = 24 * 60 * 60_000;
const PREVIEW_AGE = 3 * DAY;
const queues = new Map<string, Promise<unknown>>(), flights = new Map<string, Promise<PodcastStorageClearResult>>();
const generations = new Map<string, number>(), removing = new Set<string>();
const identifier = (scope: string, id: string) => JSON.stringify([scope, id]);
export function isPodcastStorageFileRemoving(scope: string, id: string): boolean { return removing.has(identifier(scope, id)); }
const emptyResult = (): PodcastStorageClearResult => ({ removedFiles: 0, removedRecords: 0, removedBytes: 0, skippedInUse: 0, failedFiles: 0 });
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
const yieldControl = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function owner(options: PodcastStorageOptions) {
  const profile = profileScopeId(), scope = hashKey(profile), auth = useAuthStore.getState().auth;
  const owns = captureLyricOwner(profile), generation = generations.get(scope) ?? 0;
  const alive = () => (generations.get(scope) ?? 0) === generation;
  const current = () => alive() && owns() && profileScopeId() === profile && useAuthStore.getState().auth === auth
    && !options.signal?.aborted && (!options.current || options.current())
    && (options.expectedProfile === undefined || options.expectedProfile === profile);
  const check = () => { if (!current()) throw new Error('Podcast storage owner changed'); };
  check(); return { profile, scope, current, check, alive };
}
type Owner = ReturnType<typeof owner>;
function serialized<T>(scope: string, work: () => Promise<T>): Promise<T> {
  const operation = (queues.get(scope) ?? Promise.resolve()).then(work, work);
  queues.set(scope, operation.catch(() => {})); return operation;
}
/** Called before deleting a profile's directory, never just on logout. */
export async function stopPodcastStorageProfile(scope: string): Promise<void> {
  generations.set(scope, (generations.get(scope) ?? 0) + 1);
  await queues.get(scope)?.catch(() => {});
  queues.delete(scope); flights.delete(scope);
}
function path(scope: string, category: 'audio' | 'art', file: string): string | undefined {
  const prefix = `${Db.podcastDbDir(scope)}${category}/`, name = file.startsWith(prefix) ? file.slice(prefix.length) : '';
  return /^[a-z\d][a-z\d.-]*$/i.test(name) && !name.includes('..') ? prefix + name : undefined;
}
async function info(file: string) { return FileSystem.getInfoAsync(file); }
async function files(scope: string, category: 'audio' | 'art', own: Owner) {
  own.check(); const directory = `${Db.podcastDbDir(scope)}${category}/`;
  let names: string[];
  try { names = await FileSystem.readDirectoryAsync(directory); }
  catch (error) {
    own.check(); const exists = await info(directory); own.check();
    if (exists.exists) throw error; return [];
  }
  own.check(); return names.flatMap((name) => { const file = path(scope, category, directory + name); return file ? [file] : []; });
}
async function dependencies(own: Owner) {
  const [player, downloads, podcasts] = await Promise.all([import('@/store/player'), import('@/store/downloads'), import('@/store/podcastDownloads')]);
  own.check();
  let lastPlayback = '', lastDownloads: unknown, lastVersion = -1;
  let channels = new Set<string>(), episodes = new Set<string>();
  const snapshot = () => {
    const playing = player.getPodcastStoragePlaybackSongs(), d = downloads.useDownloads.getState();
    const signature = JSON.stringify(playing.map((song) => [song.id, song.podcastChannelId]));
    const version = podcastStorageLeaseVersion();
    if (signature !== lastPlayback || d.queue !== lastDownloads || version !== lastVersion) {
      lastPlayback = signature; lastDownloads = d.queue; lastVersion = version;
      channels = protectedPodcastStorageChannels(own.scope); episodes = new Set();
      for (const song of playing) if (song.podcastChannelId) { channels.add(song.podcastChannelId); episodes.add(song.id); }
      for (const row of d.queue ?? []) if (row.song.podcastChannelId && ['queued', 'downloading', 'paused'].includes(row.status)) {
        channels.add(row.song.podcastChannelId); episodes.add(row.song.id);
      }
    }
    return { channels, episodes, version };
  };
  const publishRemoval = (id: string, file: string) => {
    if (!own.current()) return;
    podcasts.usePodcastDownloads.setState((state) => {
      if (state.scope !== own.scope || state.files[id] !== file) return {};
      const next = { ...state.files }; delete next[id]; return { files: next };
    });
  };
  const publishRestored = async (id: string) => {
    if (!own.current()) return;
    const saved = await Db.getDownload(own.scope, id);
    if (saved && own.current()) podcasts.usePodcastDownloads.setState((state) => state.scope === own.scope
      ? { files: { ...state.files, [id]: saved.file } } : {});
  };
  return { snapshot, publishRemoval, publishRestored };
}
type Dependencies = Awaited<ReturnType<typeof dependencies>>;
function invalidate() {
  for (const name of ['podcastDownloads', 'podcastChannels', 'podcastChannel', 'podcastEpisodes', 'podcastLibrary', 'podcastStorage'])
    void queryClient.invalidateQueries({ queryKey: [name] });
}

export async function getPodcastStorageUsage(options: PodcastStorageOptions = {}): Promise<PodcastStorageUsage> {
  const own = owner(options), stats = await Db.podcastStorageStats(own.scope, own.current); own.check();
  let audioBytes = 0, coverBytes = 0, audioCount = 0, coverCount = 0, index = 0;
  for (const category of ['audio', 'art'] as const) for (const file of await files(own.scope, category, own)) {
    own.check(); const item = await info(file); own.check();
    if (item.exists && !item.isDirectory) {
      if (category === 'audio') { audioBytes += finite(item.size); audioCount++; }
      else { coverBytes += finite(item.size); coverCount++; }
    }
    if (++index % 24 === 0) { await yieldControl(); own.check(); }
  }
  let catalogBytes = 0;
  for (const suffix of ['podcasts.db', 'podcasts.db-wal', 'podcasts.db-shm']) {
    own.check(); const item = await info(`${Db.podcastDbDir(own.scope)}${suffix}`); own.check();
    if (item.exists && !item.isDirectory) catalogBytes += finite(item.size);
  }
  return { audioBytes, coverBytes, catalogBytes, totalBytes: audioBytes + coverBytes + catalogBytes,
    audioCount, coverCount, channelCount: stats.channelCount, episodeCount: stats.episodeCount,
    databaseAllocatedBytes: stats.databaseAllocatedBytes, databaseFreeBytes: stats.databaseFreeBytes, databaseLiveBytes: stats.databaseLiveBytes };
}
export async function getPodcastStorageLastMaintenance(options: PodcastStorageOptions = {}) {
  const own = owner(options), state = await Db.getMaintenanceState(own.scope, own.current); own.check(); return { lastStartedAt: state.lastStartedAt ?? undefined, lastCompletedAt: state.lastCompletedAt ?? undefined };
}

async function removeAudio(entry: Db.PodcastDownloadRecord, automatic: boolean, now: number, own: Owner,
  deps: Dependencies, result: PodcastStorageClearResult) {
  own.check(); const file = path(own.scope, 'audio', entry.file);
  if (!file) { result.failedFiles++; return; }
  const protectedNow = () => {
    const current = deps.snapshot(); return protectedPodcastStorageChannels(own.scope).has(entry.channelId) || current.episodes.has(entry.episodeId);
  };
  if (protectedNow()) { result.skippedInUse++; return; }
  const version = podcastStorageLeaseVersion(), id = identifier(own.scope, entry.episodeId);
  const current = () => own.current() && version === podcastStorageLeaseVersion() && !protectedNow();
  removing.add(id); let claimed = false, deleted = false;
  try {
    claimed = automatic ? await Db.claimAutoDownloadRemoval(own.scope, entry, current, now)
      : await Db.claimPodcastDownloadRemoval(own.scope, entry, current);
    if (!claimed) { own.check(); result.skippedInUse++; return; }
    deps.publishRemoval(entry.episodeId, file);
    if (!current()) { own.check(); result.skippedInUse++; return; }
    const item = await info(file);
    if (!current()) { own.check(); result.skippedInUse++; return; }
    if (item.exists && item.isDirectory) throw new Error('Podcast audio path is a directory');
    await FileSystem.deleteAsync(file, { idempotent: true }); deleted = true;
    if (item.exists) { result.removedFiles++; result.removedBytes += finite(item.size); }
    result.removedRecords++;
  } catch (error) {
    own.check();
    if (version !== podcastStorageLeaseVersion() || protectedNow()) result.skippedInUse++;
    else if (claimed) result.failedFiles++;
    else throw error;
  } finally {
    // Compensation is restricted to this already-claimed old record and cannot
    // overwrite a replacement/manual download. Profile deletion revokes it.
    try {
      if (claimed && !deleted && own.alive()) {
        await Db.restoreClaimedPodcastDownload(own.scope, entry, own.alive);
        await deps.publishRestored(entry.episodeId);
      }
    } finally { removing.delete(id); }
  }
}
async function clearCovers(own: Owner, deps: Dependencies, result: PodcastStorageClearResult, orphanOnly = false) {
  const referenceVersion = podcastStorageLeaseVersion();
  const refs = await Db.listPodcastArtReferences(own.scope, own.current); own.check();
  const references = new Map(refs.map((ref) => [ref.file, ref.channelId]));
  let index = 0;
  for (const file of await files(own.scope, 'art', own)) {
    own.check(); if (file.endsWith('.part')) continue;
    const state = deps.snapshot(), channel = references.get(file);
    // Old artwork aliases cannot be reverse-mapped to an active/pinned image.
    // Conservatively keep unreferenced files while any show is in use.
    if (channel ? state.channels.has(channel) : state.channels.size > 0) { result.skippedInUse++; continue; }
    if (orphanOnly && channel) continue;
    const item = await info(file); own.check();
    if (!item.exists || item.isDirectory) continue;
    if (orphanOnly && (!item.modificationTime || Date.now() - item.modificationTime * 1000 < DAY)) continue;
    const latest = deps.snapshot();
    if (referenceVersion !== podcastStorageLeaseVersion() || state.version !== podcastStorageLeaseVersion()
      || (channel ? latest.channels.has(channel) : latest.channels.size > 0)) { result.skippedInUse++; continue; }
    try {
      await FileSystem.deleteAsync(file, { idempotent: true });
      result.removedFiles++; result.removedBytes += finite(item.size);
      await Db.clearPodcastArtReferences(own.scope, [file], own.alive);
    } catch { own.check(); result.failedFiles++; }
    if (++index % 24 === 0) { await yieldControl(); own.check(); }
  }
}
async function clearCatalog(olderThan: number, own: Owner, deps: Dependencies, result: PodcastStorageClearResult) {
  own.check(); const state = deps.snapshot(), version = state.version;
  const current = () => own.current() && version === podcastStorageLeaseVersion()
    && [...deps.snapshot().channels].every((id) => state.channels.has(id));
  const pruned = await Db.prunePreviewCatalog(own.scope, olderThan, [...state.channels],
    current);
  own.check(); result.removedRecords += pruned.removedChannels + pruned.removedEpisodes;
  for (const file of pruned.removedArtFiles) {
    own.check(); if (!path(own.scope, 'art', file)) continue;
    if (!current()) { result.skippedInUse++; continue; }
    try { const item = await info(file); own.check();
      if (!current()) { result.skippedInUse++; continue; }
      if (item.exists && item.isDirectory) { result.failedFiles++; continue; }
      await FileSystem.deleteAsync(file, { idempotent: true });
      if (item.exists) { result.removedFiles++; result.removedBytes += finite(item.size); }
    } catch { own.check(); result.failedFiles++; }
  }
}
/** Explicit cleanup can remove files left by a failed old unlink. Automatic
 * maintenance never guesses the intent of an unrecorded/legacy audio file. */
async function clearOrphanAudio(own: Owner, deps: Dependencies, result: PodcastStorageClearResult) {
  const referenceVersion = podcastStorageLeaseVersion();
  const records = await Db.listPodcastDownloadRecords(own.scope, own.current); own.check();
  const referenced = new Set(records.map((entry) => entry.file)); let index = 0;
  for (const file of await files(own.scope, 'audio', own)) {
    own.check(); if (referenced.has(file)) continue;
    const state = deps.snapshot();
    // An old alias or partial transfer has no reliable episode identity.
    if (referenceVersion !== podcastStorageLeaseVersion() || state.channels.size) { result.skippedInUse++; continue; }
    const item = await info(file); own.check();
    if (!item.exists || item.isDirectory) continue;
    if (referenceVersion !== podcastStorageLeaseVersion() || state.version !== podcastStorageLeaseVersion() || deps.snapshot().channels.size) { result.skippedInUse++; continue; }
    try { await FileSystem.deleteAsync(file, { idempotent: true }); result.removedFiles++; result.removedBytes += finite(item.size); }
    catch { own.check(); result.failedFiles++; }
    if (++index % 24 === 0) { await yieldControl(); own.check(); }
  }
}
export async function clearPodcastStorage(category: PodcastStorageCategory, options: PodcastStorageOptions = {}): Promise<PodcastStorageClearResult> {
  const own = owner(options);
  if (!['audio', 'covers', 'catalog'].includes(category)) throw new Error('Invalid podcast storage category');
  return serialized(own.scope, async () => {
    own.check(); const deps = await dependencies(own), result = emptyResult();
    if (category === 'audio') {
      for (const [index, entry] of (await Db.listPodcastDownloadRecords(own.scope, own.current)).entries()) {
        await removeAudio(entry, false, Date.now(), own, deps, result);
        if (index % 24 === 23) { await yieldControl(); own.check(); }
      }
      await clearOrphanAudio(own, deps, result);
    }
    else if (category === 'covers') await clearCovers(own, deps, result);
    else {
      await clearCatalog(Date.now(), own, deps, result);
      const state = deps.snapshot();
      if (state.channels.size) result.skippedInUse++;
      else {
        const version = state.version;
        await Db.compactPodcastCatalog(own.scope, () => own.current() && version === podcastStorageLeaseVersion());
        own.check();
      }
    }
    own.check(); invalidate(); return result;
  });
}
export function runPodcastMaintenance(options: PodcastStorageOptions = {}): Promise<PodcastStorageClearResult> {
  const own = owner(options), previous = flights.get(own.scope); if (previous) return previous;
  const work = serialized(own.scope, async () => {
    own.check(); const now = Date.now(), result = emptyResult();
    if (!await Db.claimMaintenance(own.scope, now, own.current)) { own.check(); return result; }
    own.check(); const deps = await dependencies(own), state = deps.snapshot();
    const favorites = await Db.favoriteIds(own.scope); own.check();
    const eligible = await Db.eligibleAutoDownloads(own.scope, now, [...state.episodes, ...favorites], own.current);
    for (const [index, entry] of eligible.entries()) {
      if (favorites.has(entry.channelId)) { result.skippedInUse++; continue; }
      await removeAudio(entry, true, now, own, deps, result);
      if (index % 24 === 23) { await yieldControl(); own.check(); }
    }
    await clearCatalog(now - PREVIEW_AGE, own, deps, result);
    await clearCovers(own, deps, result, true);
    own.check(); await Db.completeMaintenance(own.scope, now, Date.now(), own.current); own.check(); invalidate(); return result;
  }).finally(() => { if (flights.get(own.scope) === work) flights.delete(own.scope); });
  flights.set(own.scope, work); return work;
}
