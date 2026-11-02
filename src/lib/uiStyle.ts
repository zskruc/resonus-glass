/** Page layout is independent from the colour theme, player and glass tuning. */
export const UI_STYLES = ['spotify', 'appleMusic'] as const;
export type UiStyle = (typeof UI_STYLES)[number];
export const ALBUM_STYLES = ['artist', 'volta', 'minidisc', 'primuse'] as const;
export type AlbumStyle = (typeof ALBUM_STYLES)[number];
export const PLAYLIST_STYLES = ['artist', 'compact', 'primuse'] as const;
export type PlaylistStyle = (typeof PLAYLIST_STYLES)[number];

/** Keep explicit playlist layouts without replacing existing profile choices. */
export function normalizePlaylistStyle(value: unknown): PlaylistStyle {
  return value === 'compact' || value === 'primuse' ? value : 'artist';
}

/** Keep explicit album choices while unknown profiles retain the artist header. */
export function normalizeAlbumStyle(value: unknown): AlbumStyle {
  return value === 'volta' || value === 'minidisc' || value === 'primuse' ? value : 'artist';
}

/** Old profiles and unrecognised imported values retain the original layout. */
export function normalizeUiStyle(value: unknown): UiStyle {
  return value === 'appleMusic' ? 'appleMusic' : 'spotify';
}

export function isAppleMusicStyle(value: unknown): value is 'appleMusic' {
  return value === 'appleMusic';
}
