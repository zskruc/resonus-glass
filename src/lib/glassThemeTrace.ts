import type { GlassAppearanceMode, GlassTarget } from '@/store/glassTuning';

import { isGlassThemeTraceEnabled } from '../../modules/liquid-glass';

let remaining = 40;
let previous: Map<string, string> | undefined;

/** Appearance values only; never accepts route, media, account or backdrop content. */
export function traceResolvedGlassTheme(
  target: GlassTarget,
  role: 'mini' | 'navigation' | 'search',
  mode: GlassAppearanceMode,
  dark: boolean,
  tint: string,
  opacity: number,
): void {
  if (!isGlassThemeTraceEnabled || remaining <= 0) return;
  // Keep all diagnostic allocation behind the process-scoped native opt-in.
  const key = `${target}/${role}`;
  const fingerprint = `${mode}/${dark}/${tint}/${opacity}`;
  previous ??= new Map();
  if (previous.get(key) === fingerprint) return;
  previous.set(key, fingerprint);
  remaining--;
  console.info(`[ResonusGlassTheme] JS.resolve t=${Date.now()} target=${target} role=${role} mode=${mode} dark=${dark} tint=${tint} opacity=${opacity}`);
}
