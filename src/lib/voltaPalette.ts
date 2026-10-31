/**
 * Volta-inspired detail pages keep one artwork-tinted surface beneath their
 * header and songs. Existing rows use the app's text roles, so constrain the
 * tint against those roles instead of changing the global theme per route.
 */
import { paletteContrast } from './playerPalette';

function channels(hex: string): [number, number, number] | null {
  if (!/^#[\da-f]{6}$/i.test(hex)) return null;
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mix(seed: [number, number, number], base: [number, number, number], amount: number): string {
  return '#' + seed.map((value, index) => Math.round(value * amount + base[index] * (1 - amount))
    .toString(16).padStart(2, '0')).join('');
}

/** Deterministic and cheap: no image decoding, timers, or scroll subscriptions. */
export function voltaDetailBackground(seed: string, base: string, primary: string, secondary: string): string {
  const art = channels(seed);
  const page = channels(base);
  if (!art || !page || !channels(primary) || !channels(secondary)) return base;
  for (let amount = 0.8; amount > 0; amount -= 0.05) {
    const candidate = mix(art, page, amount);
    if (paletteContrast(primary, candidate) >= 7 && paletteContrast(secondary, candidate) >= 4.5) return candidate;
  }
  return base;
}
