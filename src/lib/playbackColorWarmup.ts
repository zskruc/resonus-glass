/** Small, replaceable artwork warmup plans; no React, native calls or timers. */
import type { Song } from '@/api/subsonic';
import { nextPlayable, type RepeatMode } from '@/lib/queue';

export const PLAYBACK_COLOR_WARMUP_LIMIT = 3;
export interface PlaybackColorWarmupItem {
  uri: string;
  mode: 'light' | 'dark';
}

/** Queue order already includes shuffle. Previous at index zero belongs to history. */
export function playbackColorWarmupIndices(
  queue: Song[], index: number, repeat: RepeatMode, playable: (song: Song) => boolean,
): number[] {
  if (!queue[index]) return [];
  const next = nextPlayable(queue, index, repeat, (candidate) => playable(queue[candidate]));
  const previous = index > 0 && playable(queue[index - 1]) ? index - 1 : null;
  return [...new Set([index, next, previous].filter((candidate): candidate is number => candidate != null))];
}

/** A remote podcast/radio artwork URL can bypass songCoverUrl's offline wrapper. */
export function canWarmPlaybackArtwork(uri: string | undefined, offline: boolean, cachedPrefix: string): uri is string {
  return !!uri && !uri.startsWith(cachedPrefix) && !(offline && /^https?:\/\//i.test(uri));
}

function itemKey(item: PlaybackColorWarmupItem): string { return JSON.stringify([item.mode, item.uri]); }

/**
 * One in-flight load across all plan/theme/profile updates. New plans replace
 * queued work rather than growing a backlog. An in-flight native decode cannot
 * be cancelled, but it can never start another obsolete queued request.
 */
export function createPlaybackColorWarmup(load: (item: PlaybackColorWarmupItem) => Promise<void>) {
  let pending: PlaybackColorWarmupItem[] = [];
  let active = false;
  let running = false;
  let disposed = false;
  let signature = '';

  async function pump() {
    if (running || !active || disposed) return;
    running = true;
    try {
      while (active && !disposed && pending.length) {
        const item = pending.shift()!;
        try { await load(item); } catch { /* A later plan/foreground visit can retry. */ }
        // If the replacement plan still needs this exact load, it just landed.
        const completed = itemKey(item);
        pending = pending.filter((candidate) => itemKey(candidate) !== completed);
      }
    } finally { running = false; }
  }

  return {
    update(items: readonly PlaybackColorWarmupItem[], foreground: boolean) {
      if (disposed) return;
      const keys = new Set<string>();
      const plan = foreground ? items.filter((item) => {
        const key = itemKey(item);
        if (!item.uri || keys.has(key) || keys.size >= PLAYBACK_COLOR_WARMUP_LIMIT) return false;
        keys.add(key);
        return true;
      }).map((item) => ({ ...item })) : [];
      const nextSignature = JSON.stringify([foreground, plan]);
      if (signature === nextSignature) return;
      signature = nextSignature;
      active = foreground;
      pending = plan;
      void pump();
    },
    dispose() { disposed = true; active = false; pending = []; },
  };
}
