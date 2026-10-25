/**
 * Global share sheet. Anywhere with something to share (song menu, album or
 * playlist menu, playlist header) opens it with `useSharePicker.open(...)`
 * instead of creating the link on the spot: how long the link lives is asked
 * first, and the sheet (`ShareSheet`, mounted once in the root layout) is what
 * asks and then hands the link to the system.
 */
import { create } from 'zustand';

export interface ShareTarget {
  /** Song, album or playlist id, as the server knows it. */
  id: string;
  /** Its name, used as the share's description and in the sheet's title. */
  name?: string;
}

interface SharePickerState {
  /** What to share; null = sheet closed. */
  target: ShareTarget | null;
  session: number;
  open: (target: ShareTarget) => void;
  close: () => void;
}

export const useSharePicker = create<SharePickerState>((set) => ({
  target: null,
  session: 0,
  open: (target) => set((state) => ({ target, session: state.session + 1 })),
  close: () => set((state) => ({ target: null, session: state.session + 1 })),
}));
