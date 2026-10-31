/** Only a rendered PNG is shared; source images, URLs and metadata stay private. */
import { Directory, File, Paths } from 'expo-file-system';
import { validPosterPng } from './lyricPoster';

/** Only our own derived PNGs; recently shared files stay alive for slow receivers. */
function prunePosterCache(directory: Directory, now: number) {
  try {
    const files = directory.list().flatMap((entry) => {
      const match = /^lyrics-(\d{13})-[a-z0-9]{6}\.png$/.exec(entry.name);
      return entry instanceof File && match ? [{ file: entry, at: Number(match[1]) }] : [];
    }).sort((a, b) => b.at - a.at);
    const stale = files.filter((entry, index) => now - entry.at > 7 * 24 * 60 * 60 * 1000
      || index >= 40 && now - entry.at > 60 * 60 * 1000).reverse();
    for (const entry of stale.slice(0, 8)) {
      try { entry.file.delete(); } catch { /* A simultaneous cache clear is harmless. */ }
    }
  } catch { /* Cleanup cannot turn a successful export into a failure. */ }
}

export async function materializeLyricPoster(temporaryUri: string) {
  if (!temporaryUri.startsWith('file://') && !temporaryUri.startsWith('/')) throw new Error('Invalid poster capture');
  const source = new File(temporaryUri);
  if (!source.exists || source.size < 128) throw new Error('Empty poster capture');
  const handle = source.open();
  let valid: boolean;
  try { valid = validPosterPng(handle.readBytes(24), source.size); }
  finally { handle.close(); }
  if (!valid) throw new Error('Invalid poster image');
  const directory = new Directory(Paths.cache, 'lyric-posters');
  directory.create({ intermediates: true, idempotent: true });
  const now = Date.now();
  prunePosterCache(directory, now);
  const file = new File(directory, `lyrics-${now}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}.png`);
  const discard = () => { try { if (file.exists) file.delete(); } catch { /* Android may have reclaimed its cache. */ } };
  try { source.copy(file); }
  catch (error) { discard(); throw error; }
  return { uri: file.uri, discard };
}
