/**
 * Album tint policy adapted from chenqi92/primuse (294e3f5),
 * PrimuseKit/LibraryDetailTintPolicy.swift. Copyright (c) 2026 Welape.
 * MIT License; see licenses/PRIMUSE-MIT.txt.
 * The input is the native extractor's already-shaped primary, not raw pixels
 * and not the artist-page background/edge sampler.
 */
import { paletteContrast } from './playerPalette';
import type { VoltaArtistPalette } from './voltaArtistPalette';

export interface PrimuseAlbumPalette extends VoltaArtistPalette {
  backgroundTop: string;
  playLabel: string;
}

export const PRIMUSE_ALBUM_GRADIENT_LOCATIONS = [0, 0.42, 1] as const;
type Hsb = readonly [hue: number, saturation: number, brightness: number];
type Rgb = readonly [number, number, number];
const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));

function rgb(color: string | undefined): Rgb | undefined {
  if (!color || !/^#[\da-f]{6}$/i.test(color)) return undefined;
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hex(channels: Rgb): string {
  return '#' + channels.map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('');
}

function hsb(channels: Rgb): Hsb {
  const [red, green, blue] = channels.map((channel) => channel / 255);
  const maximum = Math.max(red, green, blue), difference = maximum - Math.min(red, green, blue);
  if (difference === 0) return [0, 0, maximum];
  const sector = maximum === red ? (green - blue) / difference
    : maximum === green ? 2 + (blue - red) / difference : 4 + (red - green) / difference;
  return [((sector / 6) % 1 + 1) % 1, difference / maximum, maximum];
}

function rgbFor([hue, saturation, brightness]: Hsb): Rgb {
  const part = hue * 6, index = Math.floor(part) % 6, offset = part - Math.floor(part);
  const p = brightness * (1 - saturation);
  const q = brightness * (1 - saturation * offset);
  const t = brightness * (1 - saturation * (1 - offset));
  const channels = index === 0 ? [brightness, t, p] : index === 1 ? [q, brightness, p]
    : index === 2 ? [p, brightness, t] : index === 3 ? [p, q, brightness]
      : index === 4 ? [t, p, brightness] : [brightness, p, q];
  return channels.map((channel) => channel * 255) as unknown as Rgb;
}

function whiteContrast(stop: Hsb): number {
  const channels = rgbFor(stop).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] + 0.05);
}

function readableBrightness(hue: number, saturation: number, preferred: number): number {
  if (whiteContrast([hue, saturation, preferred]) >= 4.5) return preferred;
  let low = 0, high = preferred;
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2;
    if (whiteContrast([hue, saturation, middle]) >= 4.5) low = middle;
    else high = middle;
  }
  return low;
}

/** Keep small secondary labels readable over both ends of the opaque page. */
function secondaryInk(top: string, bottom: string, initialOpacity: number): string {
  const channels = rgb(top)!;
  for (let opacity = initialOpacity; opacity < 1; opacity += 0.02) {
    const candidate = hex(channels.map((channel) => channel + (255 - channel) * opacity) as unknown as Rgb);
    if (Math.min(paletteContrast(candidate, top), paletteContrast(candidate, bottom)) >= 4.5) return candidate;
  }
  return '#FFFFFF';
}

/** Primuse's album HSB shaping and gradient; appearance is recomputed from one cached primary. */
export function buildPrimuseAlbumPalette(primary: string | undefined, dark: boolean): PrimuseAlbumPalette {
  const sample = rgb(primary);
  const source = sample ? hsb(sample) : undefined;
  // Black, white and neutral covers intentionally share the source's blue-grey
  // fallback instead of borrowing a warm accent from a tiny neutral pixel.
  const [hue, saturation, brightness]: Hsb = source && source[1] >= 0.08
    ? [source[0], clamp(source[1], 0.24, 0.58), source[2]] : [0.62, 0.06, 0.5];
  const preferred = (dark ? 0.28 : 0.34) * (0.88 + 0.24 * brightness);
  const topBrightness = readableBrightness(hue, saturation, preferred);
  const backgroundTop = hex(rgbFor([hue, saturation, topBrightness]));
  const background = hex(rgbFor([hue, saturation, topBrightness * 0.58]));
  return {
    backgroundTop, background, text: '#FFFFFF',
    textSecondary: secondaryInk(backgroundTop, background, 0.82),
    textMuted: secondaryInk(backgroundTop, background, 0.62),
    controlFill: '#FFFFFF1F', accent: '#FFFFFF', onText: backgroundTop, playLabel: backgroundTop,
  };
}
