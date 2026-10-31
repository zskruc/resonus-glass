/** Page layout is independent from the colour theme, player and glass tuning. */
export const UI_STYLES = ['spotify', 'appleMusic'] as const;
export type UiStyle = (typeof UI_STYLES)[number];
export const ALBUM_STYLES = ['volta', 'minidisc'] as const;
export type AlbumStyle = (typeof ALBUM_STYLES)[number];
export const PLAYLIST_STYLES = ['artist', 'compact'] as const;
export type PlaylistStyle = (typeof PLAYLIST_STYLES)[number];

/** Preview the artist-page header while retaining the compact layout as a reversible choice. */
export function normalizePlaylistStyle(value: unknown): PlaylistStyle {
  return value === 'compact' ? 'compact' : 'artist';
}

/** Existing Apple Music profiles retain their Volta album presentation. */
export function normalizeAlbumStyle(value: unknown): AlbumStyle {
  return value === 'minidisc' ? 'minidisc' : 'volta';
}

/** Old profiles and unrecognised imported values retain the original layout. */
export function normalizeUiStyle(value: unknown): UiStyle {
  return value === 'appleMusic' ? 'appleMusic' : 'spotify';
}

export function isAppleMusicStyle(value: unknown): value is 'appleMusic' {
  return value === 'appleMusic';
}
