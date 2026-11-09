/** Older isolated UI/API suites run with the unchanged default display policy.
 * Full customization persistence/rendering has dedicated production-path tests. */
import { sourceSong } from '../../src/lib/sourceSongMetadata';
export function defaultCustomizationBoundary(name: string): unknown {
  if (name === '@/lib/sourceSongMetadata') return { sourceSong };
  if (name === '@/hooks/useLocalMetadata') return { useDisplaySong: (song: unknown) => song,
    useDisplayArtist: (artist: unknown) => artist, useDisplayAlbum: (album: unknown) => album };
  if (name === '@/components/LyricsTypography' || name === './LyricsTypography') return { LyricFontText: ({ text }: { text: string }) => text };
  if (name === './useLocalLyricEdit') return { useLocalLyricEdit: () => ({ data: null, isPending: false }), editedLyrics: (lyrics: unknown) => lyrics };
  return undefined;
}
