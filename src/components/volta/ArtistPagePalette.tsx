import { createContext, useContext, type ReactNode } from 'react';

import { type VoltaArtistPalette } from '@/lib/voltaArtistPalette';

// Detail pages explicitly opt into local content roles. Artist photos and the
// optional Minidisc album can share readable rows without changing the global
// theme or glass tuning; updates also reach memoized media rows.
const ArtistPagePaletteContext = createContext<VoltaArtistPalette | undefined>(undefined);

export function ArtistPagePaletteProvider({ value, children }: {
  value: VoltaArtistPalette | undefined;
  children: ReactNode;
}) {
  return <ArtistPagePaletteContext.Provider value={value}>{children}</ArtistPagePaletteContext.Provider>;
}

export function useArtistPagePalette(): VoltaArtistPalette | undefined {
  return useContext(ArtistPagePaletteContext);
}
