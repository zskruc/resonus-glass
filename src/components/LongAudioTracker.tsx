/** Event-driven saves with no React playback-tick renders or extra polling timer. */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { longAudioScope, useLongAudio } from '@/store/longAudio';
import { useAuthStore } from '@/store/auth';
import { longAudioPlaybackSample, usePlayerStore } from '@/store/player';

export function LongAudioTracker() {
  useEffect(() => {
    type Sample = NonNullable<ReturnType<typeof longAudioPlaybackSample>>;
    let previous: Sample | undefined;
    let scope = longAudioScope();
    const save = (sample: Sample | undefined, force = false) => {
      if (!sample || sample.buffering || sample.position < 1) return;
      void useLongAudio.getState().remember(sample.scope, sample.song, sample.position, sample.duration, force);
    };
    const update = () => {
      const nextScope = longAudioScope();
      if (scope !== nextScope) {
        save(previous, true); previous = undefined; scope = nextScope;
        void useLongAudio.getState().load(scope);
      }
      const sample = longAudioPlaybackSample();
      if (previous && (!sample || previous.song.id !== sample.song.id || previous.scope !== sample.scope || previous.playing && !sample.playing)) save(previous, true);
      previous = sample;
      if (sample?.playing) save(sample);
    };
    const player = usePlayerStore.subscribe((state, old) => {
      if (state.positionSec !== old.positionSec || state.index !== old.index || state.queue !== old.queue
        || state.isPlaying !== old.isPlaying || state.isBuffering !== old.isBuffering) update();
    });
    const account = useAuthStore.subscribe(update);
    const preferences = useLongAudio.subscribe((state, old) => {
      const id = previous?.song.id;
      if (state.hydrated !== old.hydrated || state.profile !== old.profile || (id && state.entries[id]?.enabled !== old.entries[id]?.enabled)) {
        update(); if (state.entries[id ?? '']?.enabled) save(previous, true);
      }
    });
    const app = AppState.addEventListener('change', (state) => { if (state !== 'active') { update(); save(previous, true); } });
    void useLongAudio.getState().load(scope);
    update();
    return () => { player(); account(); preferences(); app.remove(); save(previous, true); };
  }, []);
  return null;
}
