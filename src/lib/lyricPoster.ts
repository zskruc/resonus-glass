/** Pure selection and export ownership rules for static lyric sharing. */
import type { SongLyrics } from '@/api/subsonic';

export const MAX_POSTER_LINES = 6;
export const MAX_POSTER_CHARS = 420;
export type PosterStyle = 'artwork' | 'light' | 'dark';

export function posterLines(lyrics: SongLyrics | null | undefined): string[] {
  return (lyrics?.lines ?? []).map((line) => typeof line.value === 'string'
    ? line.value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim() : '').filter(Boolean);
}

export function selectedPosterLines(lines: readonly string[], indices: readonly number[]): string[] {
  const chosen = [...new Set(indices)].filter((index) => Number.isInteger(index) && index >= 0 && index < lines.length)
    .sort((a, b) => a - b).map((index) => lines[index]);
  return chosen.length <= MAX_POSTER_LINES && chosen.join('\n').length <= MAX_POSTER_CHARS ? chosen : [];
}

/** Sanity-check the signature and bounded dimensions of the native PNG capture. */
export function validPosterPng(header: Uint8Array, byteSize: number): boolean {
  if (header.length < 24 || byteSize < 128) return false;
  const magic = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!magic.every((byte, index) => header[index] === byte)
    || String.fromCharCode(...header.slice(12, 16)) !== 'IHDR') return false;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  return width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16_000_000;
}

export async function shareCapturedPoster(deps: {
  current: () => boolean;
  available: () => Promise<boolean>;
  capture: () => Promise<string>;
  materialize: (temporaryUri: string) => Promise<{ uri: string; discard: () => void }>;
  share: (uri: string) => Promise<void>;
  release: (temporaryUri: string) => void;
}): Promise<'shared' | 'cancelled' | 'unavailable'> {
  if (!deps.current()) return 'cancelled';
  if (!(await deps.available())) return 'unavailable';
  if (!deps.current()) return 'cancelled';
  const temporary = await deps.capture();
  let file: Awaited<ReturnType<typeof deps.materialize>> | undefined;
  let shared = false;
  try {
    if (!deps.current()) return 'cancelled';
    file = await deps.materialize(temporary);
    if (!deps.current()) return 'cancelled';
    await deps.share(file.uri); shared = true;
    return 'shared';
  } finally {
    if (!shared) file?.discard();
    deps.release(temporary);
  }
}
