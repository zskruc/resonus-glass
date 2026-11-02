/** RSS files have their own durable catalog but share the music queue's real
 * transfer slots, progress UI, pause/cancel controls and native work lease. */
import * as FileSystem from 'expo-file-system/legacy';
import * as Network from 'expo-network';
import { create } from 'zustand';

import type { PodcastChannel, PodcastEpisode, Song } from '@/api/subsonic';
import { isManualOffline } from '@/api/netGate';
import { profileScopeId, useAuthStore } from './auth';
import { useDownloads } from './downloads';
import { hashKey } from '@/lib/localLibrary';
import { podcastUrlExtension as urlExtension } from '@/lib/podcastMedia';
import * as Db from '@/lib/podcastDb';
import { queryClient } from '@/lib/query';

interface PodcastDownloadsState {
  scope: string;
  files: Record<string, string>;
  hydrated: boolean;
  hydrate(): Promise<void>;
  download(channel: PodcastChannel, episodes: PodcastEpisode[], automatic?: boolean): Promise<void>;
  deleteEpisodes(ids: string[]): Promise<void>;
  deleteShow(channelId: string): Promise<void>;
  clearAll(allProfiles?: boolean): Promise<void>;
  usageBytes(): Promise<number>;
  forgetIfMissing(song: Song): Promise<boolean>;
}
let hydration = 0, serial = 0;
let networkRevision = 0, wifiAvailable = false;
const isWifi = (network: Network.NetworkState | null) => network?.type === Network.NetworkStateType.WIFI
  && network.isConnected !== false && network.isInternetReachable !== false;
const generations = new Map<string, number>();
const groups = new Map<string, Map<string, number>>();
const activeScope = () => hashKey(profileScopeId());
const savedScopes = async () => {
  const scopes = await FileSystem.readDirectoryAsync(Db.podcastDbDir('')).catch(() => [] as string[]);
  const found: string[] = [];
  for (const scope of scopes) if (/^[a-z0-9]{1,16}$/.test(scope)) {
    const info = await FileSystem.getInfoAsync(`${Db.podcastDbDir(scope)}podcasts.db`).catch(() => null);
    if (info?.exists) found.push(scope);
  }
  return found;
};
const invalidate = () => {
  void queryClient.invalidateQueries({ queryKey: ['podcastDownloads'] });
  void queryClient.invalidateQueries({ queryKey: ['podcastChannels'] });
};
const validAudio = (headers: Record<string, string> | undefined) => {
  const type = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.toLowerCase();
  return !type || !/^(text\/|application\/(?:json|xml|xhtml))/.test(type);
};

export const usePodcastDownloads = create<PodcastDownloadsState>((set, get) => ({
  scope: '', files: {}, hydrated: false,
  async hydrate() {
    const own = activeScope(), ticket = ++hydration;
    // Another account's paths cannot remain visible while its replacement loads.
    set({ scope: own, files: {}, hydrated: false });
    const files = await Db.listDownloads(own).catch(() => ({}));
    if (ticket === hydration && own === activeScope()) set({ scope: own, files, hydrated: true });
  },
  async download(channel, episodes, automatic = false) {
    const owner = useAuthStore.getState().auth, own = activeScope();
    if (!owner || isManualOffline() || useAuthStore.getState().offline) return;
    if (automatic) {
      // Auto means a new arrival over actual Wi-Fi, never a guess from an old
      // cached network snapshot and never a download of the whole back catalog.
      const revision = networkRevision;
      const network = await Network.getNetworkStateAsync().catch(() => null);
      if (revision === networkRevision) wifiAvailable = isWifi(network);
      if (!wifiAvailable || useAuthStore.getState().auth !== owner || own !== activeScope()) return;
    }
    const generation = generations.get(own) ?? 0;
    const current = () => own === activeScope() && useAuthStore.getState().auth === owner
      && (generations.get(own) ?? 0) === generation;
    if (!current()) return;
    // Manual taps enter the protected queue before any DB await. Locking just
    // after the tap cannot turn an accepted download into a silent no-op.
    const existing = get().scope === own ? get().files : {};
    const seen = new Set<string>();
    const pending = episodes.filter((episode) => episode.channelId === channel.id && /^https?:\/\//i.test(episode.url ?? '')
      && !existing[episode.id] && !seen.has(episode.id) && !!seen.add(episode.id));
    const group = `${automatic ? 'podcast-auto' : 'podcast'}:${channel.id}`;
    let ownGroups = groups.get(own); if (!ownGroups) groups.set(own, ownGroups = new Map());
    ownGroups.set(group, (ownGroups.get(group) ?? 0) + 1);
    const work = pending.map((episode) => {
      const song: Song = { id: episode.id, title: episode.title, artist: channel.title, album: channel.title,
        podcastChannelId: channel.id, vod: true, url: episode.url, duration: episode.duration,
        coverArt: channel.artFile ?? channel.imageUrl };
      let part: string | undefined;
      let durable: { uri: string; bytes: number } | undefined;
      const cleanup = async () => { if (part) await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {}); };
      return useDownloads.getState().enqueueExternal(song, group, async (context) => {
        const owns = () => current() && context.current();
        const check = () => { context.check(); if (!current()) throw new Error('Podcast download stopped'); };
        check();
        if (!durable) {
          const recorded = await Db.getDownload(own, episode.id); check();
          if (recorded) durable = { uri: recorded.file, bytes: recorded.bytes ?? 0 };
        }
        // A pause may arrive after an unabortable DB commit. Resume publishes
        // that complete file instead of downloading again and orphaning it.
        if (durable) {
          const existing = await FileSystem.getInfoAsync(durable.uri); check();
          if (existing.exists && (existing.size ?? 0) > 0) {
            const saved = durable;
            set((state) => state.scope === own ? { files: { ...state.files, [episode.id]: saved.uri } } : {});
            context.progress(saved.bytes, saved.bytes); invalidate(); return;
          }
          durable = undefined;
        }
        const directory = `${Db.podcastDbDir(own)}audio/`;
        await FileSystem.makeDirectoryAsync(directory, { intermediates: true }); check();
        const token = `${Date.now().toString(36)}-${++serial}`;
        const final = `${directory}${hashKey(episode.id)}-${token}.${urlExtension(episode.url!, 'audio')}`;
        part = `${final}.part`;
        let moved = false, committed = false;
        const transfer = FileSystem.createDownloadResumable(episode.url!, part, {}, (event) => {
          if (owns()) context.progress(event.totalBytesWritten, event.totalBytesExpectedToWrite);
        });
        const release = context.transfer({ pause: () => transfer.pauseAsync(), cancel: async () => {
          await transfer.pauseAsync().catch(() => {}); await cleanup();
        } });
        try {
          const result = await transfer.downloadAsync(); check();
          if (!result || result.status !== 200 || !validAudio(result.headers)) throw new Error('Invalid podcast audio');
          const info = await FileSystem.getInfoAsync(part); check();
          if (!info.exists || !info.size) throw new Error('Empty podcast audio');
          await FileSystem.moveAsync({ from: part, to: final }); moved = true; check();
          await Db.saveDownload(own, episode, final, info.size, owns); committed = true;
          durable = { uri: final, bytes: info.size };
          check();
          set((state) => state.scope === own ? { files: { ...state.files, [episode.id]: final } } : {});
          invalidate();
        } finally {
          release(); await cleanup();
          if (moved && !committed) await FileSystem.deleteAsync(final, { idempotent: true }).catch(() => {});
        }
      }, cleanup, automatic ? (members) => wifiAvailable || members.some((member) => member !== group) : undefined);
    });
    await Promise.all(work);
    const count = (ownGroups.get(group) ?? 1) - 1;
    if (count > 0) ownGroups.set(group, count); else ownGroups.delete(group);
    if (!ownGroups.size && groups.get(own) === ownGroups) groups.delete(own);
  },
  async deleteEpisodes(ids) {
    const own = activeScope();
    // An accepted native move/DB commit may not be abortable. Let this exact
    // entry settle before reading its final recorded path and unlinking it.
    await useDownloads.getState().forgetExternal(ids);
    if (own !== activeScope()) return;
    const saved = await Db.listDownloads(own);
    if (own !== activeScope()) return;
    await Db.dropDownloads(own, ids);
    if (own === activeScope()) set((state) => {
      const files = { ...state.files }; for (const id of ids) delete files[id]; return { files };
    });
    for (const id of ids) if (saved[id]) await FileSystem.deleteAsync(saved[id], { idempotent: true }).catch(() => {});
    invalidate();
  },
  async deleteShow(channelId) {
    const own = activeScope();
    const queued = useDownloads.getState().queue.filter((item) => item.song.podcastChannelId === channelId).map((item) => item.song.id);
    useDownloads.getState().cancelExternal(`podcast:${channelId}`, own);
    useDownloads.getState().cancelExternal(`podcast-auto:${channelId}`, own);
    const saved = await Db.downloadedForChannel(own, channelId);
    if (own === activeScope()) await get().deleteEpisodes([...new Set([...queued, ...saved.ids])]);
  },
  async clearAll(allProfiles = false) {
    const own = activeScope(), scopes = allProfiles ? new Set([own, ...await savedScopes()]) : new Set([own]);
    for (const scope of scopes) {
      generations.set(scope, (generations.get(scope) ?? 0) + 1);
      for (const group of groups.get(scope)?.keys() ?? []) useDownloads.getState().cancelExternal(group, scope);
      const saved = await Db.listDownloads(scope);
      await Db.dropDownloads(scope, Object.keys(saved));
      await FileSystem.deleteAsync(`${Db.podcastDbDir(scope)}audio/`, { idempotent: true }).catch(() => {});
      if (scope !== activeScope()) await Db.closePodcastDb(scope);
    }
    if (scopes.has(activeScope())) set({ files: {} });
    invalidate();
  },
  async usageBytes() {
    let bytes = 0;
    for (const scope of new Set([activeScope(), ...await savedScopes()])) {
      bytes += await Db.downloadedBytes(scope);
      if (scope !== activeScope()) await Db.closePodcastDb(scope);
    }
    return bytes;
  },
  async forgetIfMissing(song) {
    const file = podcastFile(song); if (!file) return false;
    try { const info = await FileSystem.getInfoAsync(file); if (info.exists && (info.size ?? 0) > 0) return false; }
    catch { return false; }
    await get().deleteEpisodes([song.id]); return true;
  },
}));

/** Purely synchronous: the player never substitutes another account's file. */
export function podcastFile(song: Song): string | undefined {
  const state = usePodcastDownloads.getState();
  return song.podcastChannelId && state.scope === activeScope() ? state.files[song.id] : undefined;
}

useAuthStore.subscribe((state, previous) => {
  if (state.auth === previous.auth && state.offline === previous.offline) return;
  const old = usePodcastDownloads.getState().scope;
  if (old) {
    generations.set(old, (generations.get(old) ?? 0) + 1);
    for (const group of groups.get(old)?.keys() ?? []) useDownloads.getState().cancelExternal(group, old);
    groups.delete(old);
  }
  void usePodcastDownloads.getState().hydrate();
});

// Observe the actual native type, never infer Wi-Fi from a cached
// "not cellular" default. VPN/unknown is conservatively paused for automation.
if (typeof Network.addNetworkStateListener === 'function') Network.addNetworkStateListener((network) => {
  networkRevision++; wifiAvailable = isWifi(network);
  useDownloads.getState().syncExternal();
});
