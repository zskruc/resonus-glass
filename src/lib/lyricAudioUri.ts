import * as FileSystem from 'expo-file-system/legacy';

/** Download/song-cache stores hydrate asynchronously after account changes.
 * Their old same-ID URI is usable only inside the captured profile's folder. */
export function ownedLyricAudioUri(profile: string, downloaded?: string, cached?: string): string | undefined {
  const root = FileSystem.documentDirectory;
  if (!root || !/^[\da-z_-]+$/i.test(profile)) return undefined;
  return [downloaded, cached].find((uri) => uri?.startsWith(`${root}downloads/${profile}/`)
    || uri?.startsWith(`${root}song-cache/${profile}/`));
}
