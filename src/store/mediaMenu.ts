/** Album/playlist context menu state (long-press on cards). */
import type Icon from '@/components/Icon';
import { create } from 'zustand';

import type { Album, Playlist } from '@/api/subsonic';

/** An entry a screen adds to the album sheet, above the stock ones. */
export type MediaMenuExtraAction = {
  icon: keyof typeof Icon.glyphMap;
  label: string;
  onPress: () => void | Promise<void>;
};

export type MediaMenuItem =
  | { kind: 'album'; album: Album; extraActions?: MediaMenuExtraAction[] }
  | { kind: 'playlist'; playlist: Playlist };

interface MediaMenuState {
  item: MediaMenuItem | null;
  session: number;
  open: (item: MediaMenuItem) => void;
  close: () => void;
}

export const useMediaMenu = create<MediaMenuState>((set) => ({
  item: null,
  session: 0,
  open: (item) => set((state) => ({ item, session: state.session + 1 })),
  close: () => set((state) => ({ item: null, session: state.session + 1 })),
}));
