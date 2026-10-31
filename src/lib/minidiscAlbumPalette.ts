/**
 * Album palette adapted from Loriage/Minidisc, AlbumDetailView.swift,
 * commit 09789242135b6f63a51cab1f3f6207986bb72c3d.
 * Copyright (c) 2026 NO HIT Dev; based on Cassette,
 * Copyright (c) 2024-2026 Mathieu Dubart.
 * This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See licenses/Minidisc-MPL-2.0.txt or https://mozilla.org/MPL/2.0/.
 */
import { paletteContrast } from './playerPalette';
import type { VoltaArtistPalette } from './voltaArtistPalette';

export interface MinidiscAlbumPalette extends VoltaArtistPalette {
  backgroundTop: string;
  playLabel: string;
}

type Rgb = readonly [number, number, number];
function rgb(hex: string | undefined): Rgb | null {
  if (!hex || !/^#[\da-f]{6}$/i.test(hex)) return null;
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex(channels: Rgb): string {
  return '#' + channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('');
}
function mix(first: string, second: string, amount: number): string {
  const a = rgb(first)!; const b = rgb(second)!;
  return hex(a.map((n, i) => n * amount + b[i] * (1 - amount)) as unknown as Rgb);
}
function hsv(channels: Rgb): readonly [number, number, number] {
  const [r, g, b] = channels.map((n) => n / 255);
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo;
  const h = d === 0 ? 0 : hi === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
    : hi === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h, hi === 0 ? 0 : d / hi, hi];
}
function fromHsv(h: number, s: number, v: number): string {
  const c = v * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = v - c;
  const part = h * 6;
  const channels = part < 1 ? [c, x, 0] : part < 2 ? [x, c, 0] : part < 3 ? [0, c, x]
    : part < 4 ? [0, x, c] : part < 5 ? [x, 0, c] : [c, 0, x];
  return hex(channels.map((n) => (n + m) * 255) as unknown as Rgb);
}
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** Minidisc's chromatic/neutral HSV shaping, with readable ink at BOTH ends. */
export function buildMinidiscAlbumPalette(seed: string | undefined, dark: boolean): MinidiscAlbumPalette {
  const channels = rgb(seed);
  if (!channels) {
    const background = dark ? '#141619' : '#FFFFFF', text = dark ? '#FFFFFF' : '#111111';
    return { background, backgroundTop: background, text, textSecondary: dark ? '#C6C8CC' : '#55565B',
      textMuted: dark ? '#C6C8CC' : '#55565B', controlFill: dark ? '#FFFFFF1F' : '#0000001F',
      onText: background, accent: text, playLabel: '#111111' };
  }
  const [h, s, v] = hsv(channels);
  const saturation = s >= 0.08 ? clamp(s * (dark ? 1.7 : 1.45), 0.46, 0.96) : Math.min(s * 1.2, 0.10);
  const brightness = s >= 0.08 ? dark ? clamp(v * 0.78, 0.28, 0.48) : clamp(v * 1.08, 0.52, 0.74)
    : dark ? clamp(v * 0.52, 0.18, 0.30) : clamp(v * 0.78, 0.34, 0.48);
  let backgroundTop = fromHsv(h, saturation, brightness * (dark ? 1.06 : 1.08));
  let background = fromHsv(h, saturation, brightness * (dark ? 0.84 : 0.92));
  const contrast = (color: string) => Math.min(paletteContrast(color, backgroundTop), paletteContrast(color, background));
  // The source's luminance threshold can choose white on a bright yellow.
  // Keep its background, and choose local ink by actual contrast instead.
  const text = contrast('#FFFFFF') >= contrast('#000000') ? '#FFFFFF' : '#000000';
  // A neutral gradient can straddle the narrow range where neither black nor
  // white reaches 4.5 at BOTH ends. Move only the offending endpoint enough.
  const readableBackground = (color: string) => {
    if (paletteContrast(text, color) >= 4.6) return color;
    for (let amount = 0.995; amount >= 0; amount -= 0.005) {
      const candidate = mix(color, text === '#FFFFFF' ? '#000000' : '#FFFFFF', amount);
      if (paletteContrast(text, candidate) >= 4.6) return candidate;
    }
    return text === '#FFFFFF' ? '#000000' : '#FFFFFF';
  };
  backgroundTop = readableBackground(backgroundTop);
  background = readableBackground(background);
  let textSecondary = text;
  for (let amount = 0.7; amount <= 1.001; amount += 0.025) {
    const candidate = mix(text, background, Math.min(amount, 1));
    if (contrast(candidate) >= 4.5) { textSecondary = candidate; break; }
  }
  const playSeed = fromHsv(h, saturation, brightness * clamp(0.32 / Math.max(brightness, 0.01), 0.5, 1));
  return { backgroundTop, background, text, textSecondary, textMuted: textSecondary,
    controlFill: text === '#FFFFFF' ? '#FFFFFF1F' : '#0000001F', onText: background, accent: text,
    playLabel: paletteContrast(playSeed, '#FFFFFF') >= 4.5 ? playSeed : '#111111' };
}

/** Source max-width / side margins, capped vertically for landscape phones. */
export function minidiscAlbumCoverSize(width: number, height: number): number {
  return Math.round(Math.max(96, Math.min(340, width - 128, height * 0.42)));
}
