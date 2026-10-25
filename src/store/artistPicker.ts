/** State of the artist picker, the bottom sheet for collaborations. */
import { create } from 'zustand';

import type { ArtistTarget } from '@/lib/artistNav';

interface ArtistPickerState {
  artists: ArtistTarget[] | null;
  session: number;
  open: (artists: ArtistTarget[]) => void;
  close: () => void;
}

export const useArtistPicker = create<ArtistPickerState>((set) => ({
  artists: null,
  session: 0,
  open: (artists) => set((state) => ({ artists, session: state.session + 1 })),
  close: () => set((state) => ({ artists: null, session: state.session + 1 })),
}));
