/** Local, photo-derived roles for the immersive artist page only. */
import { paletteContrast } from './playerPalette';

export interface ArtistImageColors {
  platform?: 'android' | 'ios' | 'web';
  background?: string;
  dominant?: string;
  average?: string;
  muted?: string;
  darkMuted?: string;
  primary?: string;
  /** Raw visible-crop pixels, before the hero's blur/fade or color shaping. */
  lowerMean?: string;
  lowerEdgeMean?: string;
  lowerCenterMean?: string;
  /** Scene background from the original photo's upper corners, excluding the subject/clothes. */
  sourceBackground?: string;
  /** Verified public artwork metadata, bound to the exact displayed asset. */
  artworkBackground?: string;
}

export interface VoltaArtistPalette {
  background: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  controlFill: string;
  onText: string;
  accent: string;
}

type Hsl = readonly [number, number, number];

function hsl(hex: string | undefined): Hsl | null {
  if (!hex || !/^#[\da-f]{6}$/i.test(hex)) return null;
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255);
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const light = (hi + lo) / 2;
  if (hi === lo) return [0, 0, light];
  const delta = hi - lo;
  const hue = hi === r ? (g - b) / delta + (g < b ? 6 : 0)
    : hi === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue / 6, delta / (1 - Math.abs(2 * light - 1)), light];
}

function hex([hue, saturation, light]: Hsl): string {
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const part = hue * 6;
  const x = chroma * (1 - Math.abs(part % 2 - 1));
  const m = light - chroma / 2;
  const channels = part < 1 ? [chroma, x, 0] : part < 2 ? [x, chroma, 0]
    : part < 3 ? [0, chroma, x] : part < 4 ? [0, x, chroma] : part < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return '#' + channels.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('');
}

function mix(first: string, second: string, firstWeight: number): string {
  const a = Number.parseInt(first.slice(1), 16);
  const b = Number.parseInt(second.slice(1), 16);
  return '#' + [16, 8, 0].map((shift) => Math.round(((a >> shift) & 255) * firstWeight
    + ((b >> shift) & 255) * (1 - firstWeight)).toString(16).padStart(2, '0')).join('');
}

/** Background/population roles win over a small, vivid detail such as skin. */
export function pickVoltaArtistSeed(sample: ArtistImageColors): string | null {
  const valid = (color: string | undefined): color is string => hsl(color) !== null;
  if (valid(sample.artworkBackground)) return sample.artworkBackground;
  if (valid(sample.sourceBackground)) return sample.sourceBackground;
  // Lower edges describe the surrounding scene, while the complete band also
  // retains the clothing. Neither the face nor a top-of-photo swatch wins over
  // the exact picture section that meets the page background.
  if (valid(sample.lowerEdgeMean) && valid(sample.lowerMean)) return mix(sample.lowerEdgeMean, sample.lowerMean, 0.6);
  const lower = [sample.lowerMean, sample.lowerEdgeMean, sample.lowerCenterMean].find(valid);
  if (lower) return lower;
  const average = valid(sample.average) ? sample.average : undefined;
  const averageHsl = hsl(average);
  // Palette filters near-black/white pixels. A uniformly neutral real image
  // still has its direct average and must not inherit a fallback's hue.
  if (averageHsl && averageHsl[1] < 0.05 && (averageHsl[2] < 0.04 || averageHsl[2] > 0.96)) return average!;
  const preferred = sample.platform === 'ios'
    ? [sample.background, sample.dominant, average, sample.muted, sample.darkMuted, sample.primary]
    : [sample.dominant, average, sample.muted, sample.darkMuted, sample.background];
  const candidate = preferred.find(valid);
  const tone = hsl(candidate);
  if (tone && (tone[2] < 0.06 || tone[2] > 0.94) && average) return average;
  return candidate ?? null;
}

/** Shift RGB channels equally; preserve the scene's differences between channels. */
function readablePhotoBackground(seed: string): string {
  const value = Number.parseInt(seed.slice(1), 16);
  const minimum = Math.min((value >> 16) & 255, (value >> 8) & 255, value & 255) / 255;
  // Very pale scenes need a little more separation than mid-tone portraits.
  // One smooth range covers both, instead of artist-specific colors or a
  // discontinuous “already readable / divide by two” decision.
  const pale = Math.max(0, Math.min(1, (minimum - 0.85) / 0.13));
  const target = 5 + 0.6 * pale * pale * (3 - 2 * pale);
  if (paletteContrast('#FFFFFF', seed) >= target) return seed;
  const shade = (offset: number) => '#' + [16, 8, 0].map((shift) =>
    Math.max(0, ((value >> shift) & 255) - offset).toString(16).padStart(2, '0')).join('');
  let low = 0;
  let high = 255;
  while (low < high) {
    const midpoint = Math.floor((low + high) / 2);
    if (paletteContrast('#FFFFFF', shade(midpoint)) >= target) high = midpoint;
    else low = midpoint + 1;
  }
  return shade(low);
}

/** Preserve scene hue; clothing colors belong to the extension, not the page. */
export function buildVoltaArtistPalette(sample: ArtistImageColors): VoltaArtistPalette {
  const seed = pickVoltaArtistSeed(sample);
  const tone = hsl(seed ?? undefined) ?? hsl('#40516B')!;
  const [hue, saturation, light] = tone;
  const photographic = hsl(sample.artworkBackground) !== null || hsl(sample.sourceBackground) !== null;
  const s = Math.min(saturation * 0.85, 0.24);
  let l = light;
  const text = '#FFFFFF';
  // Verified metadata and local scene corners share the same continuous
  // treatment, so unavailable public metadata cannot turn a white sweater
  // into a grey page or a brown jacket into a brown page.
  let background = photographic ? readablePhotoBackground(seed!) : hex([hue, s, l]);
  // Only a genuinely bright photograph needs darkening. A medium grey-green
  // body and a dark blue portrait must not both collapse to the same dark L.
  if (paletteContrast(text, background) < 4.6) {
    const current = hsl(background)!;
    const targetHue = current[0];
    const targetSaturation = current[1];
    l = current[2];
    let low = 0;
    let high = l;
    for (let i = 0; i < 18; i++) {
      const midpoint = (low + high) / 2;
      if (paletteContrast(text, hex([targetHue, targetSaturation, midpoint])) >= 4.6) low = midpoint;
      else high = midpoint;
    }
    l = low;
    background = hex([targetHue, targetSaturation, l]);
  }
  // Lighten the local secondary ink when necessary instead of darkening the
  // entire picture merely to accommodate fixed grey-blue text roles.
  const readable = (candidate: string) => paletteContrast(candidate, background) >= 4.5 ? candidate : text;
  const textSecondary = readable('#F5F7F6');
  const textMuted = readable('#E8EDE9');
  const accent = readable('#F6F8F7');
  return Object.freeze({ background, text, textSecondary, textMuted,
    controlFill: 'rgba(255,255,255,0.10)', onText: background, accent });
}

export const VOLTA_ARTIST_FALLBACK = buildVoltaArtistPalette({ dominant: '#40516B' });
export const VOLTA_ARTIST_PALETTE_CACHE_LIMIT = 64;

/** Raw color roles only: no decoded pictures or persistent/private URL logs. */
export class VoltaArtistPaletteCache {
  private readonly entries = new Map<string, ArtistImageColors>();
  private readonly pending = new Map<string, Promise<ArtistImageColors | null>>();
  private readonly read: (uri: string) => Promise<ArtistImageColors | null>;
  private readonly capacity: number;
  constructor(read: (uri: string) => Promise<ArtistImageColors | null>, capacity = VOLTA_ARTIST_PALETTE_CACHE_LIMIT) {
    this.read = read;
    this.capacity = Math.max(1, Math.floor(capacity) || VOLTA_ARTIST_PALETTE_CACHE_LIMIT);
  }

  get size(): number { return this.entries.size; }
  peek(uri: string): ArtistImageColors | undefined { return this.entries.get(uri); }

  load(uri: string, read = this.read): Promise<ArtistImageColors | null> {
    const cached = this.entries.get(uri);
    if (cached) {
      this.entries.delete(uri); this.entries.set(uri, cached);
      return Promise.resolve(cached);
    }
    const existing = this.pending.get(uri);
    if (existing) return existing;
    const request = Promise.resolve().then(() => read(uri)).then((sample) => {
      if (!sample || !pickVoltaArtistSeed(sample)) return null;
      const stored = Object.freeze({ ...sample });
      this.entries.set(uri, stored);
      while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
      return stored;
    }).catch(() => null).finally(() => {
      if (this.pending.get(uri) === request) this.pending.delete(uri);
    });
    this.pending.set(uri, request);
    return request;
  }
}
