/** Song context menu state, shared by player controls and song rows. */
import { create } from 'zustand';

import type { Song } from '@/api/subsonic';

/** Optional context: if the song is opened from an editable playlist. */
export interface SongMenuContext {
  playlistId: string;
  /** Position of the song within the playlist (for removing it). */
  index: number;
}

/** Extra options when opening the menu (e.g. from the player). */
export interface SongMenuOptions {
  /** Every song entry opens the same floating card unless explicitly overridden. */
  presentation?: 'sheet' | 'card';
  /** Shows the «Lyrics» action. Only from the player: /lyrics opens the
   *  current song, not an arbitrary row's song. */
  showLyrics?: boolean;
  /** Opens straight on the sleep timer's choices (the player's button). */
  sleep?: boolean;
  /**
   * The player's own buttons, for when they are hidden from the row under the
   * controls: hiding all of them left the queue out of reach (#248).
   */
  queue?: boolean;
  devices?: () => void;
  speed?: () => void;
}

/** What the player hands over of its own buttons; empty from anywhere else. */
export interface PlayerExtras {
  queue: boolean;
  devices?: () => void;
  speed?: () => void;
}

const NO_EXTRAS: PlayerExtras = { queue: false };

interface SongMenuState {
  song: Song | null;
  session: number;
  presentation: 'sheet' | 'card';
  context: SongMenuContext | null;
  showLyrics: boolean;
  sleep: boolean;
  extras: PlayerExtras;
  open: (song: Song, context?: SongMenuContext, opts?: SongMenuOptions) => void;
  close: () => void;
}

export const useSongMenu = create<SongMenuState>((set) => ({
  song: null,
  session: 0,
  presentation: 'card',
  context: null,
  showLyrics: false,
  sleep: false,
  extras: NO_EXTRAS,
  open: (song, context, opts) =>
    set((state) => ({
      song,
      session: state.session + 1,
      presentation: opts?.presentation ?? 'card',
      context: context ?? null,
      showLyrics: !!opts?.showLyrics,
      sleep: !!opts?.sleep,
      extras: { queue: !!opts?.queue, devices: opts?.devices, speed: opts?.speed },
    })),
  close: () => set((state) => ({ song: null, session: state.session + 1, presentation: 'card', context: null, showLyrics: false, sleep: false, extras: NO_EXTRAS })),
}));
