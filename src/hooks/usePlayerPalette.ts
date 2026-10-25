/** Optional full-player roles; artwork extraction remains owned by useCoverTint. */
import { useEffect, useRef, useState } from 'react';

import {
  createStablePlayerPalette,
  PLAYER_PALETTE_TRANSITION_MS,
  PlayerPaletteCache,
  type PlayerPalette,
  type PlayerPaletteRequest,
} from '@/lib/playerPalette';

const cache = new PlayerPaletteCache();

export function usePlayerPalette(request: PlayerPaletteRequest): {
  palette: PlayerPalette | null;
  transitionDuration: number;
} {
  const { artworkKey, seed, ready, enabled, dark } = request;
  const [applied, setApplied] = useState<{ palette: PlayerPalette | null; dark: boolean }>({ palette: null, dark });
  const publisher = useRef<ReturnType<typeof createStablePlayerPalette> | null>(null);

  useEffect(() => {
    // Build in an effect so React's development effect replay gets a fresh gate.
    const gate = createStablePlayerPalette((palette) => setApplied({ palette, dark }), cache);
    publisher.current = gate;
    return () => {
      gate.dispose();
      publisher.current = null;
    };
  }, [dark]);

  useEffect(() => {
    publisher.current?.update({ artworkKey, seed, ready, enabled, dark });
  }, [artworkKey, seed, ready, enabled, dark]);

  return {
    // A theme change or explicit Off must never show the previous theme's ink.
    palette: enabled && artworkKey && applied.dark === dark ? applied.palette : null,
    transitionDuration: PLAYER_PALETTE_TRANSITION_MS,
  };
}
