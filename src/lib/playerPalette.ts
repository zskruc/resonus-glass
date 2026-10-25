/**
 * Full-player-only cover palette. Oklab conversion and tonal-role approach adapted
 * from Kifranei/AM-plus-plus-monet-plugin, MonetCoverPalette.kt at
 * 0408c9f9dc7d6f4f893e22f847f60dc443cf9f70 (GPL-3.0).
 * Oklab reference: Björn Ottosson's public-domain implementation.
 *
 * Resonus reuses its existing cover-color extraction rather than downloading or
 * sampling the artwork a second time. These roles never mutate the global theme.
 */
export const PLAYER_PALETTE_STABLE_MS = 900;
export const PLAYER_PALETTE_TRANSITION_MS = 380;
export const PLAYER_PALETTE_CACHE_LIMIT = 64;

export interface PlayerPalette {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  accent: string;
  onAccent: string;
}

type Rgb = readonly [number, number, number];
type Lch = readonly [number, number, number];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHex(hex: string): Rgb | null {
  if (!/^#[\da-f]{6}$/i.test(hex)) return null;
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/** Opaque sRGB WCAG contrast; the roles are deliberately not translucent. */
export function paletteContrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toOklch(rgb: Rgb): Lch {
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [lightness, Math.hypot(a, bb), (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360];
}

function oklchToLinear(lightness: number, chroma: number, hue: number): Rgb {
  const angle = hue * Math.PI / 180;
  const a = chroma * Math.cos(angle);
  const b = chroma * Math.sin(angle);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

function pack(rgb: Rgb): string {
  return '#' + rgb.map((channel) => {
    const value = clamp(channel, 0, 1);
    const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255).toString(16).padStart(2, '0');
  }).join('');
}

/** Reduce chroma before clipping so saturated covers do not shift the chosen hue. */
function fromOklch(lightness: number, chroma: number, hue: number): string {
  let c = chroma;
  for (let i = 0; i < 24; i++) {
    const rgb = oklchToLinear(lightness, c, hue);
    if (rgb.every((value) => value >= -0.0005 && value <= 1.0005)) return pack(rgb);
    c *= 0.9;
  }
  return pack(oklchToLinear(lightness, 0, hue));
}

function guardedTone(start: number, chroma: number, hue: number, background: string, lightInk: boolean, target = 4.5): string {
  let lightness = start;
  let color = fromOklch(lightness, chroma, hue);
  for (let i = 0; i < 100 && paletteContrast(color, background) < target; i++) {
    lightness = clamp(lightness + (lightInk ? 0.01 : -0.01), 0, 1);
    color = fromOklch(lightness, chroma, hue);
  }
  if (paletteContrast(color, background) < target) return lightInk ? '#ffffff' : '#000000';
  return color;
}

/** Greyscale, invalid and fallback-colored covers retain the ordinary player colors. */
export function buildPlayerPalette(seed: string, dark: boolean): PlayerPalette | null {
  const rgb = parseHex(seed);
  if (!rgb) return null;
  const [lightness, chroma, hue] = toOklch(rgb);
  // This seed has already been softened by useCoverTint. Its chroma is lower
  // than the plugin's raw24x24 pixels, so retain usable pale/dark cover hues
  // while still rejecting actual greyscale and tiny rounding noise.
  if (chroma < 0.012 || lightness < 0.12 || lightness > 0.97) return null;
  const background = fromOklch(dark ? 0.19 : 0.95, Math.min(chroma, dark ? 0.035 : 0.025), hue);
  const surface = fromOklch(dark ? 0.26 : 0.9, Math.min(chroma, 0.03), hue);
  const text = guardedTone(dark ? 0.96 : 0.2, Math.min(chroma, 0.02), hue, background, dark, 7);
  const textSecondary = guardedTone(dark ? 0.75 : 0.43, Math.min(chroma, 0.025), hue, background, dark);
  const accent = guardedTone(dark ? 0.76 : 0.53, clamp(chroma, 0.1, 0.17), hue, background, dark);
  const onAccent = paletteContrast(accent, '#000000') >= paletteContrast(accent, '#ffffff') ? '#000000' : '#ffffff';
  return Object.freeze({ background, surface, text, textSecondary, accent, onAccent });
}

/** Process-local only: artwork URLs and palettes never enter settings or diagnostics. */
export class PlayerPaletteCache {
  private readonly entries = new Map<string, PlayerPalette | null>();

  get size(): number { return this.entries.size; }

  resolve(artworkKey: string, seed: string, dark: boolean): PlayerPalette | null {
    const key = JSON.stringify([artworkKey, seed.toLowerCase(), dark]);
    if (this.entries.has(key)) {
      const hit = this.entries.get(key)!;
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const result = buildPlayerPalette(seed, dark);
    this.entries.set(key, result);
    while (this.entries.size > PLAYER_PALETTE_CACHE_LIMIT) this.entries.delete(this.entries.keys().next().value!);
    return result;
  }
}

export interface PlayerPaletteRequest {
  artworkKey?: string;
  seed: string;
  /** False until this artwork's own existing color extraction has completed. */
  ready: boolean;
  enabled: boolean;
  dark: boolean;
}

type Schedule = (callback: () => void, delay: number) => () => void;

/**
 * Stable artwork gate used by the hook and tested independently of the native UI.
 * A late extraction/timer for an earlier song cannot publish over the current one.
 */
export function createStablePlayerPalette(
  publish: (palette: PlayerPalette | null) => void,
  cache = new PlayerPaletteCache(),
  schedule: Schedule = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
) {
  let generation = 0;
  let cancel: (() => void) | undefined;
  let disposed = false;
  return {
    update(request: PlayerPaletteRequest) {
      if (disposed) return;
      const ownGeneration = ++generation;
      cancel?.();
      cancel = undefined;
      if (!request.enabled || !request.artworkKey) {
        publish(null);
        return;
      }
      // Keep the last applied palette while the new artwork is unresolved.
      if (!request.ready) return;
      cancel = schedule(() => {
        if (disposed || ownGeneration !== generation) return;
        publish(cache.resolve(request.artworkKey!, request.seed, request.dark));
      }, PLAYER_PALETTE_STABLE_MS);
    },
    dispose() {
      disposed = true;
      generation++;
      cancel?.();
      cancel = undefined;
    },
  };
}
