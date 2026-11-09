import type { Song } from '@/api/subsonic';
import type { ListeningSession } from './listeningTools';
import { currentRecommendationSongs } from './recommendationPlaybackSource';
import { getSong } from '@/api/data';
import { getRadioStations } from '@/api/backend';
import { hashKey } from './localLibrary';
import * as PodcastDb from './podcastDb';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { podcastFile, usePodcastDownloads } from '@/store/podcastDownloads';
import { isManualOffline } from '@/api/netGate';

/** Preserve repeated occurrences and the selected occurrence when missing rows are omitted. */
export function resolveSessionOccurrences(session: ListeningSession, resolved: ReadonlyMap<string, Song>): { songs: Song[]; index: number; originalSongs?: Song[] } | undefined {
  const songs: Song[] = []; let index = -1;
  session.songs.forEach((entry, original) => {
    const song = resolved.get(entry.id); if (!song || song.unavailable) return;
    if (original === session.index) index = songs.length;
    songs.push(song);
  });
  const originalSongs = session.originalSongs?.flatMap((entry) => { const song = resolved.get(entry.id); return song && !song.unavailable ? [song] : []; });
  return index < 0 ? undefined : { songs, index, originalSongs };
}
/** Media URLs are rebuilt from this account's catalog, never loaded from a backup. */
export async function prepareListeningSession(session: ListeningSession, current: () => boolean) {
  const check = () => { if (!current()) throw new Error('Listening session changed'); };
  check(); let songs = new Map<string, Song>();
  if (session.space === 'radio') {
    const auth = useAuthStore.getState().auth;
    if (isManualOffline()) return;
    const { exportDiscoveryPreferences } = await import('@/store/discoveryPreferences'); check();
    const local = await exportDiscoveryPreferences(profileScopeId()); check();
    const stations = auth && !useAuthStore.getState().offline ? await getRadioStations(auth) : []; check();
    songs = new Map([
      ...local.stations.map((station) => [station.id, { id: station.id, title: station.name, url: station.streamUrl, coverArt: station.imageUrl }] as const),
      ...stations.map((station) => [station.id, { id: station.id, title: station.name, url: station.streamUrl, coverArt: station.coverArt }] as const),
    ]);
  } else if (session.space === 'podcast') {
    const scope = hashKey(profileScopeId());
    const added = await PodcastDb.addedIds(scope); check();
    await usePodcastDownloads.getState().hydrate(); check();
    const { episodeToSong } = await import('@/api/podcasts'); check();
    const channelReads = new Map<string, ReturnType<typeof PodcastDb.getChannel>>();
    const entries = [...new Map(session.songs.map((song) => [song.id, song])).values()]; let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (cursor < entries.length) {
        check(); const entry = entries[cursor++];
        if (!entry.podcastChannelId || !added.has(entry.podcastChannelId)) continue;
        const episode = await PodcastDb.getEpisode(scope, entry.id); check();
        if (!episode || episode.channelId !== entry.podcastChannelId) continue;
        let read = channelReads.get(entry.podcastChannelId);
        if (!read) { read = PodcastDb.getChannel(scope, entry.podcastChannelId); channelReads.set(entry.podcastChannelId, read); }
        const channel = await read; check(); if (!channel) continue;
        const song = episodeToSong(episode, channel), local = podcastFile(song);
        if (useAuthStore.getState().offline && !local) continue;
        if (local) song.localUri = local;
        songs.set(song.id, song);
      }
    }));
  } else {
    songs = await currentRecommendationSongs([...session.songs, ...(session.originalSongs ?? [])], current); check();
    if (useAuthStore.getState().auth && !useAuthStore.getState().offline) {
      // Same-account safe catalog metadata retains ReplayGain and audiobook
      // classification; playable URLs still come solely from current auth.
      for (const saved of [...session.songs, ...(session.originalSongs ?? [])]) if (songs.has(saved.id)) songs.set(saved.id, { ...songs.get(saved.id)!, ...saved });
    }
    // Validate the chosen media immediately. Remaining same-profile IDs can be
    // streamed with current auth without hundreds of network metadata requests.
    const selected = await getSong(session.songs[session.index].id); check();
    if (!selected || selected.url || selected.podcastChannelId) return;
    songs.set(selected.id, selected);
  }
  check(); return resolveSessionOccurrences(session, songs);
}
