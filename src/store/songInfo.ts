/** Which song the information sheet is showing, if any (#59). */
import { create } from 'zustand';

import type { Song } from '@/api/subsonic';

interface SongInfoState {
  song: Song | null;
  session: number;
  open: (song: Song) => void;
  close: () => void;
}

export const useSongInfo = create<SongInfoState>((set) => ({
  song: null,
  session: 0,
  open: (song) => set((state) => ({ song, session: state.session + 1 })),
  close: () => set((state) => ({ song: null, session: state.session + 1 })),
}));
