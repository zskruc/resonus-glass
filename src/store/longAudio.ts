/** SQLite-backed user marks. The bounded active-profile snapshot never follows player ticks. */
import * as SQLite from 'expo-sqlite';
import { create } from 'zustand';
import type { Song } from '@/api/subsonic';
import { LongAudioRepository, parseLongAudioEntries, longAudioEntry, canRememberLongAudio, LONG_AUDIO_BOOKMARK_LIMIT } from '@/lib/longAudio';
import { audiobookProfileScope } from './albumProgress';

export const longAudioScope = audiobookProfileScope;
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
async function database() {
  opening ??= SQLite.openDatabaseAsync('resonus-long-audio.db').then(async (db) => {
    await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA journal_size_limit=524288; CREATE TABLE IF NOT EXISTS long_audio(profile TEXT PRIMARY KEY NOT NULL,data TEXT NOT NULL);');
    return db;
  }).catch((error) => { opening = undefined; throw error; });
  return opening;
}
const repository = new LongAudioRepository({ currentProfile: longAudioScope,
  read: async (profile) => (await (await database()).getFirstAsync<{ data: string }>('SELECT data FROM long_audio WHERE profile=?', profile))?.data ?? null,
  write: async (profile, data) => { await (await database()).runAsync('INSERT INTO long_audio(profile,data) VALUES(?,?) ON CONFLICT(profile) DO UPDATE SET data=excluded.data', profile, data); },
  remove: async (profile) => { await (await database()).runAsync('DELETE FROM long_audio WHERE profile=?', profile); },
});
export const useLongAudio = create(() => ({ ...repository.getSnapshot(), load: repository.load,
  retry: repository.retry, remember: repository.remember.bind(repository),
  setEnabled: (profile: string, song: Song, enabled: boolean) => canRememberLongAudio(song)
    ? repository.change(profile, song.id, (old) => ({ ...longAudioEntry(song, old), enabled })) : Promise.resolve(false),
  resetPosition: (profile: string, song: Song) => repository.change(profile, song.id, (old) => ({ ...longAudioEntry(song, old), positionSec: 0 })),
  forget: (profile: string, songId: string) => repository.change(profile, songId, () => undefined),
  addBookmark: (profile: string, song: Song, seconds: number, note: string) => {
    if (!canRememberLongAudio(song) || !Number.isFinite(seconds) || seconds < 0) return Promise.resolve(false);
    const entries = repository.getSnapshot().entries;
    const old = Object.hasOwn(entries, song.id) ? entries[song.id] : undefined;
    if ((old?.bookmarks.length ?? 0) >= LONG_AUDIO_BOOKMARK_LIMIT) return Promise.resolve(false);
    return repository.change(profile, song.id, (previous) => ({ ...longAudioEntry(song, previous),
      bookmarks: [...(previous?.bookmarks ?? []), { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        seconds: Math.min(seconds, song.duration || Infinity), note: note.trim().slice(0, 160), createdAt: Date.now() }].sort((a, b) => a.seconds - b.seconds) }));
  },
  removeBookmark: (profile: string, song: Song, id: string) => repository.change(profile, song.id, (old) => old
    ? { ...old, updatedAt: Date.now(), bookmarks: old.bookmarks.filter((mark) => mark.id !== id) } : undefined),
}));
repository.subscribe(() => useLongAudio.setState(repository.getSnapshot()));
export async function clearLongAudioProfile(rawProfile: string) {
  const db = await database();
  const prefix = rawProfile + '|';
  const rows = await db.getAllAsync<{ profile: string }>('SELECT profile FROM long_audio WHERE profile=? OR substr(profile,1,?)=?', rawProfile, prefix.length, prefix);
  const scopes = new Set(rows.map((row) => row.profile));
  for (const profile of repository.knownProfiles()) if (profile === rawProfile || profile.startsWith(prefix)) scopes.add(profile);
  for (const profile of scopes) await repository.removeProfile(profile);
}

/** Portable bookmarks/progress for the active source, without playable URLs. */
export async function exportLongAudio() {
  const profile = longAudioScope(); await repository.load(profile);
  const state = repository.getSnapshot();
  if (profile !== longAudioScope() || !state.hydrated || state.profile !== profile) throw new Error('Long-audio data unavailable');
  return parseLongAudioEntries(JSON.stringify(state.entries));
}
export async function importLongAudio(value: unknown, current: () => boolean) {
  const entries = parseLongAudioEntries(JSON.stringify(value));
  const profile = longAudioScope(); await repository.load(profile);
  for (const [id, entry] of Object.entries(entries)) {
    if (!current() || profile !== longAudioScope()) throw new Error('Library changed');
    const old = repository.getSnapshot().entries[id];
    // Existing newer bookmarks win on conflict, instead of silently replacing them.
    if (!old || old.updatedAt < entry.updatedAt) {
      if (!(await repository.change(profile, id, () => entry))) throw new Error('Could not restore bookmarks');
    }
  }
}
