/**
 * Global playlist picker for "Add to playlist". Any place (album/artist menu,
 * queue…) opens the sheet with a batch of songs without having to render its
 * own instance. The sheet (`PlaylistPickerSheet`) is mounted once in the root
 * layout and reads from here.
 */
import { create } from 'zustand';

import type { Song } from '@/api/subsonic';

interface PlaylistPickerState {
  /** Songs to add; null = sheet closed. */
  songs: Song[] | null;
  /** Reopening the same songs still starts a distinct picker session. */
  session: number;
  open: (songs: Song[]) => void;
  close: () => void;
}

export const usePlaylistPicker = create<PlaylistPickerState>((set) => ({
  songs: null,
  session: 0,
  open: (songs) => set((state) => ({ songs, session: state.session + 1 })),
  close: () => set((state) => ({ songs: null, session: state.session + 1 })),
}));
