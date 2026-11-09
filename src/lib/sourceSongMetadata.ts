import type { Song } from '@/api/subsonic';
const originals = new WeakMap<object, Song>();
/** A display copy never becomes a provider, cache or streaming identity. */
export function sourceSong(song: Song): Song { return originals.get(song) ?? song; }
export function rememberSourceSong(displayed: Song, raw: Song): void { originals.set(displayed, sourceSong(raw)); }
