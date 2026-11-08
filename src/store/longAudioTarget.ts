import { create } from 'zustand';
import type { Song } from '@/api/subsonic';
import { longAudioScope } from './longAudio';

/** A single ephemeral handoff; no audio URLs or account details in route parameters. */
export const useLongAudioTarget = create<{
  song: Song | null; scope: string | null; session: number;
  open(song: Song): void; clear(session: number): void;
}>((set) => ({ song: null, scope: null, session: 0,
  open: (song) => set((state) => ({ song, scope: longAudioScope(), session: state.session + 1 })),
  clear: (session) => set((state) => state.session === session ? { song: null, scope: null } : state),
}));
