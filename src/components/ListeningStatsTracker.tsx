/** Batched, on-device listening ledger. No React render is driven by playback ticks. */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { createListeningMeter } from '@/lib/listeningMath';
import { flushListeningCredits, queueListeningCredit } from '@/lib/listeningDb';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useListeningStats } from '@/store/listeningStats';
import { currentSong, usePlayerStore } from '@/store/player';

export function ListeningStatsTracker() {
  useEffect(() => {
    const meter = createListeningMeter(queueListeningCredit);
    let profile = profileScopeId();
    let blocked: ReturnType<typeof usePlayerStore.getState>['queue'] | null = null;
    const flush = () => { void flushListeningCredits().catch(() => {}); };
    const update = () => {
      const auth = useAuthStore.getState(), state = usePlayerStore.getState(), prefs = useListeningStats.getState();
      if (blocked && blocked !== state.queue) blocked = null;
      if (auth.hydrating || (!auth.auth && !auth.offline) || blocked || !prefs.hydrated || !prefs.enabled || prefs.profile !== profileScopeId()) {
        meter.reset(); return;
      }
      meter.sample({ profile: prefs.profile, song: currentSong(state) ?? undefined, playing: state.isPlaying, buffering: state.isBuffering,
        position: state.positionSec, speed: state.speed, at: Date.now() });
    };
    const auth = useAuthStore.subscribe((state, previous) => {
      if (state.auth === previous.auth && state.offline === previous.offline && state.hydrating === previous.hydrating) return;
      const next = profileScopeId();
      if (next !== profile) {
        blocked = usePlayerStore.getState().queue;
        profile = next; meter.reset(); flush();
        void useListeningStats.getState().load(true);
      } else if (state.hydrating !== previous.hydrating && !state.hydrating) void useListeningStats.getState().load();
      update();
    });
    const player = usePlayerStore.subscribe((state, previous) => {
      if (state.positionSec === previous.positionSec && state.index === previous.index && state.queue === previous.queue
        && state.isPlaying === previous.isPlaying && state.isBuffering === previous.isBuffering && state.speed === previous.speed) return;
      update();
      if (state.isPlaying !== previous.isPlaying || state.queue !== previous.queue || state.index !== previous.index) flush();
    });
    const prefs = useListeningStats.subscribe((state, previous) => {
      if (state.profile !== previous.profile || state.hydrated !== previous.hydrated || state.enabled !== previous.enabled) {
        meter.reset(); update(); if (!state.enabled) flush();
      }
    });
    const app = AppState.addEventListener('change', (state) => { if (state !== 'active') flush(); });
    void useListeningStats.getState().load();
    update();
    return () => { auth(); player(); prefs(); app.remove(); flush(); };
  }, []);
  return null;
}
