/** Page layout is independent from the colour theme, player and glass tuning. */
export const UI_STYLES = ['spotify', 'appleMusic'] as const;
export type UiStyle = (typeof UI_STYLES)[number];
export const ALBUM_STYLES = ['volta', 'minidisc'] as const;
export type AlbumStyle = (typeof ALBUM_STYLES)[number];

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
