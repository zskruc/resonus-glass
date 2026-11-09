/** Portable music-history order, device play counts and shuffle selection.
 * URLs, comments, local files, auth and URL-only radio/episode history are not portable music identities. */
import type { Song, SubsonicAuth } from '@/api/subsonic';
import { exportPlayHistory, importPlayHistory, clearPlayHistoryProfile, type HistoryEntry } from '@/store/playHistory';
import { exportLocalPlayCounts, importLocalPlayCounts, clearLocalPlayCountsProfile } from '@/store/playCounts';
import { exportShufflePreference, importShufflePreference, clearShufflePreferenceProfile } from '@/store/shufflePreferences';
import { MAX_LOCAL_PLAY_COUNTS, cleanPlayCounts } from './profilePlayCounts';
import { SHUFFLE_MODES, type ShuffleMode } from './weightedShuffle';
import { personalOwner } from '@/store/playlistRecovery';
export interface PersonalPlaybackBackup { version: 1; history: HistoryEntry[]; counts: Record<string, number>; shuffleMode: ShuffleMode }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 500) => typeof value === 'string' ? value.replace(/[\0\r\n]/g, ' ').trim().slice(0, max) : '';
const identity = (value: unknown) => { const result = text(value, 1024); return result && !/^(?:[a-z][a-z\d+.-]*:\/\/|file:|content:|data:)/i.test(result) ? result : undefined; };
function portableSong(raw: unknown): Song {
  if (!object(raw) || !identity(raw.id) || !text(raw.title)) throw new Error('Invalid playback history');
  const song: Song = { id: identity(raw.id)!, title: text(raw.title) };
  for (const field of ['artist', 'album'] as const) if (text(raw[field])) song[field] = text(raw[field]);
  for (const field of ['albumId', 'artistId', 'coverArt'] as const) if (identity(raw[field])) song[field] = identity(raw[field]);
  for (const field of ['duration', 'track', 'discNumber', 'year'] as const) if (typeof raw[field] === 'number' && Number.isFinite(raw[field]) && raw[field] >= 0 && raw[field] <= 604800) song[field] = raw[field];
  return song;
}
export function validatePersonalPlaybackBackup(raw: unknown): PersonalPlaybackBackup {
  if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.history) || raw.history.length > 100 || !object(raw.counts)
    || Object.keys(raw.counts).length > MAX_LOCAL_PLAY_COUNTS || !(SHUFFLE_MODES as readonly unknown[]).includes(raw.shuffleMode)) throw new Error('Invalid personal playback backup');
  const history = raw.history.map((entry): HistoryEntry => {
    if (!object(entry) || typeof entry.playedAt !== 'number' || !Number.isFinite(entry.playedAt) || entry.playedAt < 0 || entry.playedAt > 9e15) throw new Error('Invalid history timestamp');
    return { song: portableSong(entry.song), playedAt: entry.playedAt };
  });
  const counts = cleanPlayCounts(raw.counts);
  if (Object.entries(raw.counts).some(([id, value]) => !identity(id) || !Number.isSafeInteger(value) || Number(value) <= 0 || counts[id] !== value)) throw new Error('Invalid local play counts');
  return { version: 1, history, counts, shuffleMode: raw.shuffleMode as ShuffleMode };
}
export async function exportPersonalPlaybackBackup(owner = personalOwner()): Promise<PersonalPlaybackBackup> {
  owner.check(); const history = await exportPlayHistory(owner.current); owner.check();
  const counts = await exportLocalPlayCounts(owner.current); owner.check(); const shuffleMode = await exportShufflePreference(owner.current); owner.check();
  return validatePersonalPlaybackBackup({ version: 1, history: history.filter((entry) => !entry.song.url && !entry.song.podcastChannelId), counts, shuffleMode });
}
export async function restorePersonalPlaybackBackup(value: unknown, owner = personalOwner()): Promise<void> {
  const backup = validatePersonalPlaybackBackup(value); owner.check();
  await importPlayHistory(backup.history, owner.current); owner.check();
  await importLocalPlayCounts(backup.counts, owner.current); owner.check();
  await importShufflePreference(backup.shuffleMode, owner.current); owner.check();
}
export async function clearPersonalPlaybackProfile(profile: string, auth?: SubsonicAuth): Promise<void> {
  await Promise.all([clearPlayHistoryProfile(profile, auth), clearLocalPlayCountsProfile(profile), clearShufflePreferenceProfile(profile)]);
}
