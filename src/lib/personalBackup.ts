/** Explicit backup/preview/merge pipeline; no server mutation until the user applies a preview. */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { canEditPlaylist, createPlaylist, getAllAlbums, getArtists, getPlaylist, getPlaylists, getStarred, getPlaylistForEditing, insertRecoveredPlaylistTracks, updatePlaylist, setRating, star } from '@/api/data';
import type { Song } from '@/api/subsonic';
import { exportedSettings, useSettings } from '@/store/settings';
import { exportLongAudio, importLongAudio } from '@/store/longAudio';
import { parseLongAudioEntries } from './longAudio';
import { exportDiscoveryPreferences, importDiscoveryPreferences } from '@/store/discoveryPreferences';
import { parseDiscoveryPreferences } from './discoveryPreferences';
import { exportListeningTools, importListeningTools } from '@/store/listeningTools';
import { validateListeningTools } from './listeningTools';
import { exportLocalCustomizations, restoreLocalCustomizations, validateLocalCustomizations } from './localCustomizations';
import { exportPlaylistRecovery, importPlaylistRecovery, personalOwner, rememberRestoredPlaylist, restoredPlaylistId, saveRecoveryPlaylist, validatePlaylistRecovery, wholeLibraryReadError } from '@/store/playlistRecovery';
import { readRecoveryJournal, saveRecoveryJournal, deleteRecoveryJournal } from '@/store/playlistRecoveryJournal';
import { exportPendingSongMarks, savePendingSongMarks, validatePendingSongMarks } from '@/store/pendingSongMarks';
import { exportPersonalPlaybackBackup, validatePersonalPlaybackBackup, restorePersonalPlaybackBackup } from './personalPlaybackBackup';
import { customFontPath, importCustomFont } from './customFont';
import { readMusicCatalog } from './musicToolsCatalog';
import { matchBackupTracks, observedRecoveryEntries, portableBackupTrack, validatePersonalBackup, type BackupMatch, type PersonalBackup } from './personalBackupModels';
import { exportListeningLedger, importListeningLedger, savedSmartRules, saveSmartRule, validateListeningLedger } from './listeningDb';
import { normalizeSmartRule } from './smartRules';
import { savedLyricOffsets } from './lyricTiming';
import { useLyricOffsets } from '@/store/lyricOffsets';
import { useLyricDisplay } from '@/store/lyricDisplay';
import { exportPins, importPins } from '@/store/pins';
import { exportAlbumProgress, importAlbumProgress } from '@/store/albumProgress';
import { parseAlbumProgress } from './albumProgressPersistence';
import { exportGlassBackup, importGlassBackup, validateGlassBackup } from '@/store/glassTuning';
import { getItem } from './storage';
import { hashKey } from './localLibrary';
import { queryClient } from './query';

export type BackupOwner = ReturnType<typeof personalOwner>;
const MAX_BYTES = 40_000_000;
const norm = (s: string | undefined) => (s ?? '').normalize('NFKC').trim().toLocaleLowerCase();
export async function buildPersonalBackup(owner: BackupOwner, progress: (message: string, count: number) => void): Promise<PersonalBackup> {
  owner.check(); const unavailable = wholeLibraryReadError(); if (unavailable) throw new Error(unavailable); progress('Reading library metadata', 0);
  const catalog = await readMusicCatalog({ isCurrent: owner.current, onProgress: (n) => progress('Reading library metadata', n) });
  const favorites = await getStarred(); owner.check();
  const lists = (await getPlaylists()).filter(canEditPlaylist); owner.check();
  if (lists.length > 1000) throw new Error('Invalid backup limits');
  const recovery = await exportPlaylistRecovery(owner);
  const playlists: PersonalBackup['playlists'] = [];
  const starred = new Set(favorites.songs.map((s) => s.id));
  const ratingsById = new Map(catalog.songs.map((song) => [song.id, song.userRating]));
  const catalogIds = new Set(catalog.songs.map((song) => song.id));
  for (let i = 0; i < lists.length; i++) {
    owner.check(); progress('Reading playlists', i + 1);
    const detail = await getPlaylist(lists[i].id); owner.check();
    if ((detail.playlist.songCount ?? detail.songs.length) !== detail.songs.length) throw new Error('Playlist changed. Reopen it and try again.');
    const previous = recovery.find((p) => p.playlistId === lists[i].id);
    const present = new Set(detail.songs.map((song) => song.id));
    const entries = observedRecoveryEntries(previous?.entries ?? [], detail.songs)
      .filter((e) => !e.songId || present.has(e.songId) || !catalogIds.has(e.songId))
      .map((e) => ({ ...e, songId: e.songId && !present.has(e.songId) && !catalogIds.has(e.songId) ? undefined : e.songId,
        marks: e.songId ? { favorite: starred.has(e.songId) || undefined, rating: ratingsById.get(e.songId) || e.marks?.rating || undefined } : e.marks }));
    playlists.push({ key: lists[i].id, name: lists[i].name, entries });
  }
  owner.check(); progress('Reading personal settings', 0);
  const extras: Record<string, unknown> = {
    personalPlayback: await exportPersonalPlaybackBackup(owner), pendingSongMarks: await exportPendingSongMarks(owner), glass: await exportGlassBackup(), pins: await exportPins(owner.profile), albumProgress: await exportAlbumProgress(),
    discovery: await exportDiscoveryPreferences(owner.profile), customizations: await exportLocalCustomizations(owner.profile, owner.current),
    listeningTools: await exportListeningTools(), longAudio: await exportLongAudio(), recovery,
    lyricOffsets: savedLyricOffsets(JSON.parse(await getItem(`resonus.lyricOffsets.${hashKey(owner.profile)}`) ?? '{}')),
    lyricDisplay: JSON.parse(await getItem(`resonus.lyricDisplay.${hashKey(owner.profile)}`) ?? '"both"'),
    smartRules: await savedSmartRules(owner.profile), listeningLedger: await exportListeningLedger(owner.profile),
  };
  owner.check();
  let font: PersonalBackup['font'];
  const custom = useSettings.getState();
  if (custom.customFontUri) {
    const uri = customFontPath(custom.customFontUri), info = await FileSystem.getInfoAsync(uri); owner.check();
    if (info.exists && info.size <= 8_000_000) font = { name: custom.customFontUri.split('/').pop() ?? 'font.ttf', base64: await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }) };
  }
  owner.check();
  return validatePersonalBackup({ format: 'resonus-personal-backup', version: 1, createdAt: new Date().toISOString(), library: owner.library,
    settings: exportedSettings(), favorites: { songs: favorites.songs.map(portableBackupTrack),
      albums: favorites.albums.map((a) => ({ id: a.id, title: a.name, artist: a.artist })), artists: favorites.artists.map((a) => ({ id: a.id, name: a.name })) },
    ratings: catalog.songs.filter((s) => s.userRating && s.userRating >= 1).map((s) => ({ track: portableBackupTrack(s), value: s.userRating! })), playlists, extras, font,
  }, Object.keys(exportedSettings()));
}
export async function sharePersonalBackup(backup: PersonalBackup) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable');
  const dir = new Directory(Paths.cache, 'personal-backup'); dir.create({ idempotent: true, intermediates: true });
  for (const f of dir.list()) if (f instanceof File && f.modificationTime && Date.now() - f.modificationTime > 86400000) f.delete();
  const file = new File(dir, `resonus-personal-${Date.now()}.json`), body = JSON.stringify(backup);
  if (body.length > MAX_BYTES) throw new Error('Backup file is too large');
  file.create({ overwrite: true }); file.write(body); await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
}
export async function pickPersonalBackup(): Promise<PersonalBackup | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0], file = new File(asset.uri);
  if ((asset.size ?? 0) > MAX_BYTES || file.size > MAX_BYTES) throw new Error('Backup file is too large');
  const backup = validatePersonalBackup(JSON.parse(await file.text()), Object.keys(exportedSettings())); validateExtras(backup.extras); return backup;
}
function validateExtras(e: Record<string, unknown>) {
  if (e.personalPlayback !== undefined) validatePersonalPlaybackBackup(e.personalPlayback);
  if (e.pendingSongMarks !== undefined) validatePendingSongMarks(e.pendingSongMarks);
  if (e.glass !== undefined) validateGlassBackup(e.glass);
  if (e.albumProgress !== undefined) parseAlbumProgress(JSON.stringify({ restored: e.albumProgress }));
  if (e.discovery !== undefined) parseDiscoveryPreferences(e.discovery);
  if (e.customizations !== undefined) validateLocalCustomizations(e.customizations);
  if (e.listeningTools !== undefined) validateListeningTools(e.listeningTools);
  if (e.longAudio !== undefined) parseLongAudioEntries(JSON.stringify(e.longAudio));
  if (e.recovery !== undefined) validatePlaylistRecovery(e.recovery);
  if (e.listeningLedger !== undefined) validateListeningLedger(e.listeningLedger);
  if (e.smartRules !== undefined && (!Array.isArray(e.smartRules) || e.smartRules.length > 1000 || e.smartRules.some((r) => !normalizeSmartRule(r)))) throw new Error('Invalid smart playlists');
}
export interface PersonalRestorePreview {
  backup: PersonalBackup; owner: BackupOwner; sameLibrary: boolean; songs: Song[]; tracks: BackupMatch[];
  favoriteIndices: number[]; ratingIndices: number[]; playlistIndices: number[][];
  albums: { id?: string; name: string; candidates: number }[]; artists: { id?: string; name: string; candidates: number }[];
  conflicts: number;
}
export async function previewPersonalRestore(backup: PersonalBackup, owner: BackupOwner, progress: (count: number) => void): Promise<PersonalRestorePreview> {
  validateExtras(backup.extras); owner.check(); const unavailable = wholeLibraryReadError(); if (unavailable) throw new Error(unavailable);
  const catalog = await readMusicCatalog({ isCurrent: owner.current, onProgress: progress }); owner.check();
  const tracks = [...backup.favorites.songs, ...backup.ratings.map((r) => r.track), ...backup.playlists.flatMap((p) => p.entries.map((e) => e.track))];
  const matches = await matchBackupTracks(tracks, catalog.songs, backup.library === owner.library, owner.current);
  const albums = await getAllAlbums(); owner.check(); const artists = await getArtists(); owner.check();
  const sameLibrary = backup.library === owner.library;
  type Bucket = { id: string; count: number };
  const albumIds = new Map(albums.map((a) => [a.id, a])), artistIds = new Map(artists.map((a) => [a.id, a]));
  const albumNames = new Map<string, Bucket>(), albumPairs = new Map<string, Bucket>(), artistNames = new Map<string, Bucket>();
  const add = (map: Map<string, Bucket>, key: string, id: string) => { const old = map.get(key); map.set(key, { id, count: (old?.count ?? 0) + 1 }); };
  const pause = async (index: number) => { if ((index + 1) % 512 === 0) { await new Promise<void>((r) => setTimeout(r, 0)); owner.check(); } };
  let processed = 0;
  for (const a of albumIds.values()) { const name = norm(a.name); add(albumNames, name, a.id); add(albumPairs, JSON.stringify([name, norm(a.artist)]), a.id); await pause(processed++); }
  for (const a of artistIds.values()) { add(artistNames, norm(a.name), a.id); await pause(processed++); }
  const albumRows: PersonalRestorePreview['albums'] = [], artistRows: PersonalRestorePreview['artists'] = [];
  for (const a of backup.favorites.albums) {
    const direct = sameLibrary && a.id && albumIds.get(a.id);
    const bucket = a.artist ? albumPairs.get(JSON.stringify([norm(a.title), norm(a.artist)])) : albumNames.get(norm(a.title));
    albumRows.push({ id: direct ? direct.id : bucket?.count === 1 ? bucket.id : undefined, name: a.title, candidates: direct ? 1 : bucket?.count ?? 0 });
    await pause(processed++);
  }
  for (const a of backup.favorites.artists) {
    const direct = sameLibrary && a.id && artistIds.get(a.id), bucket = artistNames.get(norm(a.name));
    artistRows.push({ id: direct ? direct.id : bucket?.count === 1 ? bucket.id : undefined, name: a.name, candidates: direct ? 1 : bucket?.count ?? 0 });
    await pause(processed++);
  }
  let at = 0; const favoriteIndices = backup.favorites.songs.map(() => at++), ratingIndices = backup.ratings.map(() => at++), playlistIndices = backup.playlists.map((p) => p.entries.map(() => at++));
  return { backup, owner, sameLibrary, songs: catalog.songs, tracks: matches, favoriteIndices, ratingIndices, playlistIndices, albums: albumRows, artists: artistRows,
    conflicts: ratingIndices.filter((index, i) => matches[index].selected?.userRating && matches[index].selected?.userRating !== backup.ratings[i].value).length };
}
interface RestorePlaylistOperation { kind: 'restore-playlist'; temporaryName: string; targetIds: string[]; playlistId?: string; }
function restoreOperation(raw: unknown): RestorePlaylistOperation {
  const x = raw as RestorePlaylistOperation;
  if (!x || x.kind !== 'restore-playlist' || typeof x.temporaryName !== 'string' || !x.temporaryName.includes('[Resonus restore ')
    || x.temporaryName.length > 500 || !Array.isArray(x.targetIds) || x.targetIds.length > 10000 || x.targetIds.some((id) => typeof id !== 'string' || !id || id.length > 2048)
    || x.playlistId !== undefined && (typeof x.playlistId !== 'string' || !x.playlistId)) throw new Error('Invalid recovery journal');
  return { kind: 'restore-playlist', temporaryName: x.temporaryName, targetIds: x.targetIds, playlistId: x.playlistId };
}
export async function applyPersonalRestore(p: PersonalRestorePreview, options: { appearance: boolean; personal: boolean; local: boolean; replaceRatings: boolean }, progress: (done: number) => void) {
  const { owner, backup } = p; let done = 0;
  const step = () => { owner.check(); progress(++done); };
  owner.check(); validateExtras(backup.extras);
  if (options.personal) {
    const unresolved = p.favoriteIndices.flatMap((index) => !p.tracks[index].selected ? [{ track: p.tracks[index].track, marks: { favorite: true } }] : []);
    const unrated = p.ratingIndices.flatMap((index, n) => !p.tracks[index].selected ? [{ track: p.tracks[index].track, marks: { rating: backup.ratings[n].value } }] : []);
    const carried = backup.extras.pendingSongMarks === undefined ? [] : validatePendingSongMarks(backup.extras.pendingSongMarks);
    if (unresolved.length || unrated.length || carried.length) { await savePendingSongMarks([...unresolved, ...unrated, ...carried], owner); owner.check(); }
    const starred = await getStarred(); owner.check(); const existing = new Set(starred.songs.map((s) => s.id));
    for (const i of p.favoriteIndices) { owner.check(); const song = p.tracks[i].selected; if (song && !existing.has(song.id)) { await star(song.id, 'song'); step(); } }
    const oldAlbums = new Set(starred.albums.map((a) => a.id)), oldArtists = new Set(starred.artists.map((a) => a.id));
    for (const a of p.albums) { owner.check(); if (a.id && !oldAlbums.has(a.id)) { await star(a.id, 'album'); step(); } }
    for (const a of p.artists) { owner.check(); if (a.id && !oldArtists.has(a.id)) { await star(a.id, 'artist'); step(); } }
    for (let r = 0; r < p.ratingIndices.length; r++) {
      owner.check(); const song = p.tracks[p.ratingIndices[r]].selected;
      if (song && (!song.userRating || options.replaceRatings) && song.userRating !== backup.ratings[r].value) { await setRating(song.id, backup.ratings[r].value); step(); }
    }
    const recovered = new Map((await exportPlaylistRecovery(owner)).map((r) => [r.key, r.playlistId])); owner.check();
    for (let i = 0; i < backup.playlists.length; i++) {
      owner.check(); const list = backup.playlists[i], key = `${backup.library}:${backup.createdAt}:${list.key}`;
      const operationKey = `restore:${key}`;
      const existingOperation = await readRecoveryJournal(operationKey, owner); owner.check();
      const restored = await restoredPlaylistId(key, owner) ?? recovered.get(key); owner.check();
      if (restored && !existingOperation) { step(); continue; }
      const entries = list.entries.map((entry, n) => ({ ...entry, songId: p.tracks[p.playlistIndices[i][n]].selected?.id }));
      const songs = entries.flatMap((e, n) => e.songId ? [p.tracks[p.playlistIndices[i][n]].selected!] : []);
      const targetIds = songs.map((song) => song.id);
      const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      let op: RestorePlaylistOperation = existingOperation ? restoreOperation(existingOperation) : { kind: 'restore-playlist',
        temporaryName: `${list.name.slice(0, 380)} [Resonus restore ${nonce}]`, targetIds };
      if (JSON.stringify(op.targetIds) !== JSON.stringify(targetIds)) throw new Error('Recovery choices changed. Review the partially restored playlist before retrying.');
      if (!existingOperation) await saveRecoveryJournal(operationKey, { ...op }, owner); owner.check();
      const lists = await getPlaylists(); owner.check();
      let playlistId = op.playlistId ?? restored;
      if (!playlistId) {
        const sameName = lists.filter((row) => row.name === op.temporaryName && canEditPlaylist(row));
        if (sameName.length > 1) throw new Error('Ambiguous recovery playlist');
        if (sameName.length) playlistId = sameName[0].id;
        else {
          const before = new Set(lists.map((row) => row.id));
          playlistId = await createPlaylist(op.temporaryName); owner.check();
          if (before.has(playlistId)) throw new Error('The server did not return a new playlist');
        }
        op = { ...op, playlistId }; await saveRecoveryJournal(operationKey, { ...op }, owner); owner.check();
      }
      const fresh = await getPlaylistForEditing(playlistId); owner.check();
      if (fresh.playlist.name !== op.temporaryName && fresh.playlist.name !== list.name) throw new Error('The restored playlist was renamed. Review it before retrying.');
      const actual = fresh.songs.map((song) => song.id);
      if (actual.length > targetIds.length || actual.some((id, n) => id !== targetIds[n])) throw new Error('The restored playlist changed. Review it before retrying.');
      if (actual.length < targetIds.length) {
        await insertRecoveredPlaylistTracks(playlistId, songs.slice(actual.length).map((song) => ({ before: actual.length, song })), actual, owner.current); owner.check();
      }
      await saveRecoveryPlaylist({ key, playlistId, name: list.name, entries, updatedAt: Date.now() }, owner);
      await rememberRestoredPlaylist(key, playlistId, owner); owner.check();
      await updatePlaylist(playlistId, { name: list.name }); owner.check();
      await deleteRecoveryJournal(operationKey, owner); step();
    }
  }
  if (options.local && p.sameLibrary) {
    const e = backup.extras;
    if (e.personalPlayback !== undefined) { owner.check(); await restorePersonalPlaybackBackup(e.personalPlayback, owner); }
    if (e.pins !== undefined) { owner.check(); await importPins(owner.profile, e.pins, owner.current); }
    if (e.albumProgress !== undefined) { owner.check(); await importAlbumProgress(e.albumProgress, owner.current); }
    if (e.discovery !== undefined) { owner.check(); await importDiscoveryPreferences(owner.profile, e.discovery); }
    if (e.customizations !== undefined) { owner.check(); await restoreLocalCustomizations(owner.profile, e.customizations, { current: owner.current }); }
    if (e.listeningTools !== undefined) { owner.check(); if (!(await importListeningTools(e.listeningTools))) throw new Error('Could not restore listening tools'); }
    if (e.longAudio !== undefined) { owner.check(); await importLongAudio(e.longAudio, owner.current); }
    if (e.recovery !== undefined) { owner.check(); await importPlaylistRecovery(e.recovery, owner); }
    if (e.listeningLedger !== undefined) { owner.check(); await importListeningLedger(owner.profile, e.listeningLedger, owner.current); }
    if (e.lyricOffsets !== undefined) {
      await useLyricOffsets.getState().hydrate(owner.profile); owner.check();
      for (const [id, offset] of Object.entries(savedLyricOffsets(e.lyricOffsets))) { owner.check(); if (!(await useLyricOffsets.getState().setOffset(id, offset, owner.profile))) throw new Error('Could not restore lyric timing'); }
    }
    if (['original', 'translation', 'romanization', 'both'].includes(String(e.lyricDisplay))) {
      await useLyricDisplay.getState().hydrate(owner.profile, owner.current); owner.check();
      if (!(await useLyricDisplay.getState().save(owner.profile, e.lyricDisplay as Parameters<ReturnType<typeof useLyricDisplay.getState>['save']>[1], owner.current))) throw new Error('Could not restore lyric display');
    }
    for (const raw of Array.isArray(e.smartRules) ? e.smartRules : []) { const rule = normalizeSmartRule(raw); owner.check(); if (rule) await saveSmartRule(owner.profile, rule); }
    step();
  }
  if (options.appearance) {
    owner.check();
    if (backup.extras.glass !== undefined) { await importGlassBackup(backup.extras.glass, owner.current); owner.check(); }
    if (backup.font) {
      const file = new File(Paths.cache, `restore-font-${Date.now()}.ttf`);
      file.create({ overwrite: true }); await FileSystem.writeAsStringAsync(file.uri, backup.font.base64, { encoding: FileSystem.EncodingType.Base64 }); owner.check();
      try { const font = await importCustomFont(file.uri, backup.font.name); owner.check(); useSettings.getState().setCustomFont(font.family, font.file); }
      finally { file.delete(); }
    }
    owner.check(); useSettings.getState().importSettings(backup.settings); step();
  }
  owner.check(); void queryClient.invalidateQueries({ queryKey: ['starred'] }); void queryClient.invalidateQueries({ queryKey: ['playlists'] }); return done;
}
