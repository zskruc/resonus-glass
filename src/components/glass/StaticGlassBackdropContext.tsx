import { createContext, useContext, type PropsWithChildren } from 'react';
import type { ColorValue } from 'react-native';

/** A screen may opt ordinary cards into a known, uniform backdrop source. */
export const StaticGlassBackdropContext = createContext<ColorValue | null>(null);

export function StaticGlassBackdropProvider({ color, children }: PropsWithChildren<{ color: ColorValue }>) {
  return <StaticGlassBackdropContext.Provider value={color}>{children}</StaticGlassBackdropContext.Provider>;
}

/** Portals and nested foreground controls must keep sampling their real scene. */
export function DynamicGlassBackdrop({ children }: PropsWithChildren) {
  return <StaticGlassBackdropContext.Provider value={null}>{children}</StaticGlassBackdropContext.Provider>;
}

export function useStaticGlassBackdropColor(variant: 'regular' | 'prominent' | 'subtle' | 'button'): ColorValue | null {
  const color = useContext(StaticGlassBackdropContext);
  // A button, field or dialog has content behind it, even on an otherwise flat page.
  return variant === 'regular' ? color : null;
}
