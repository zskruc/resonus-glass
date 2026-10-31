/** Foreground-only neighbor palette warmup; the mini player's material is unchanged. */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { CACHED_COVER, COVER, songCoverUrl } from '@/api/data';
import { cachedCoverTint, prefetchCoverTint, readSharedCoverTint } from '@/hooks/useDominantColor';
import { createAppAccentFollower } from '@/lib/appAccent';
import { canWarmPlaybackArtwork, createPlaybackColorWarmup, playbackColorWarmupIndices } from '@/lib/playbackColorWarmup';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { cachedUri, useSongCache } from '@/store/songCache';
import { applyArtworkAccent, themeMode, useThemeMode } from '@/theme';

export function PlaybackColorWarmup() {
  const mode = useThemeMode();
  // Retain the same serial worker across theme, route and account changes.
  // Effect cleanup pauses rather than destroys it, supporting React effect replay.
  const [worker] = useState(() => createPlaybackColorWarmup((item) => prefetchCoverTint(item.uri, item.mode)));
  const [accent] = useState(() => createAppAccentFollower({
    cached: cachedCoverTint, read: readSharedCoverTint, publish: applyArtworkAccent,
  }));
  const replan = useRef<() => void>(() => {});

  useEffect(() => {
    let scope = profileScopeId();
    let blockedQueue: ReturnType<typeof usePlayerStore.getState>['queue'] | null = null;
    const update = () => {
      const auth = useAuthStore.getState();
      const preferences = useSettings.getState();
      const state = usePlayerStore.getState();
      if (blockedQueue && blockedQueue !== state.queue) blockedQueue = null;
      const foreground = AppState.currentState === 'active' && !auth.hydrating &&
        (!!auth.auth || auth.offline) && !blockedQueue;
      if (!foreground) {
        worker.update([], false);
        if (auth.hydrating || !preferences.hydrated || blockedQueue || preferences.accentSource !== 'artwork') accent.clear();
        else accent.suspend();
        return;
      }
      const song = state.queue[state.index];
      const currentUri = song ? songCoverUrl(song, COVER.thumb) : undefined;
      accent.update({
        identity: JSON.stringify([scope, song?.id]), mode: themeMode(),
        uri: canWarmPlaybackArtwork(currentUri, auth.offline, CACHED_COVER) ? currentUri : undefined,
        enabled: preferences.hydrated && preferences.accentSource === 'artwork',
      });
      const indices = playbackColorWarmupIndices(state.queue, state.index, state.repeat,
        (song) => !auth.offline || !!song.url || !!song.localUri ||
          !!useDownloads.getState().files[song.id] || !!cachedUri(song.id));
      const items = indices.map((index) => songCoverUrl(state.queue[index], COVER.thumb))
        .filter((uri) => canWarmPlaybackArtwork(uri, auth.offline, CACHED_COVER))
        .map((uri) => ({ uri, mode: themeMode() }));
      worker.update(items, true);
    };
    replan.current = update;
    const player = usePlayerStore.subscribe((state, previous) => {
      if (state.queue !== previous.queue || state.index !== previous.index || state.repeat !== previous.repeat) update();
    });
    const auth = useAuthStore.subscribe((state, previous) => {
      if (state.auth === previous.auth && state.offline === previous.offline &&
        state.hydrating === previous.hydrating && state.offlineSource === previous.offlineSource) return;
      const nextScope = profileScopeId();
      if (scope !== nextScope || (!state.auth && state.offlineSource !== previous.offlineSource)) {
        // Auth may commit before the old queue is cleared/restored. Never send
        // the previous profile's song IDs to the newly selected server.
        blockedQueue = usePlayerStore.getState().queue;
        accent.clear();
        worker.update([], false);
      }
      scope = nextScope;
      update();
    });
    const downloads = useDownloads.subscribe((state, previous) => { if (state.files !== previous.files) update(); });
    const cache = useSongCache.subscribe((state, previous) => { if (state.entries !== previous.entries) update(); });
    const settings = useSettings.subscribe((state, previous) => {
      if (state.accentSource !== previous.accentSource || state.hydrated !== previous.hydrated) update();
    });
    const appState = AppState.addEventListener('change', update);
    update();
    return () => {
      replan.current = () => {};
      player(); auth(); downloads(); cache(); settings(); appState.remove();
      worker.update([], false);
      accent.clear();
    };
  }, [worker, accent]);

  useEffect(() => { replan.current(); }, [mode]);
  return null;
}
