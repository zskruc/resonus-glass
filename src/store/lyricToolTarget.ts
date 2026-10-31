/** A short-lived song handoff; route URLs contain no account or artwork URLs. */
import { create } from 'zustand';
import type { Song } from '@/api/backend';
import { profileScopeId } from './auth';

export const useLyricToolTarget = create<{
  song: Song | null; profile: string | null; session: number;
  open: (song: Song) => void;
  clear: (session: number) => void;
}>((set) => ({
  song: null, profile: null, session: 0,
  open: (song) => set((state) => ({ song, profile: profileScopeId(), session: state.session + 1 })),
  clear: (session) => set((state) => state.session === session ? { song: null, profile: null } : state),
}));
