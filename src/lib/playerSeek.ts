/** A held position belongs to the song at touch-down, even before React commits a new song. */
export function canApplyPlayerSeek(
  startSong: string | undefined,
  currentSong: string | undefined,
  active: boolean,
  foreground: boolean,
): boolean {
  return startSong !== undefined && startSong === currentSong && active && foreground;
}
