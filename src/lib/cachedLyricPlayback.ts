/** Search text may outlive a file path. Resolve IDs against the current source before playing. */
import type { CachedLyricMatch } from './lyricDocuments';
import { captureLyricOwner } from './lyricOwner';
import { currentRecommendationSongs } from './recommendationPlaybackSource';
import { resolveRecommendationQueue } from './recommendationPlayback';
import { playbackUserSeekVersion, usePlayerStore } from '@/store/player';
import { tg } from '@/i18n';

let intent = 0;
export async function playCachedLyricResult(matches: readonly CachedLyricMatch[], index: number, profile: string): Promise<'played' | 'unavailable' | 'superseded'> {
  const ticket = ++intent, owns = captureLyricOwner(profile), before = usePlayerStore.getState();
  const queue = before.queue, selected = before.index, seekVersion = playbackUserSeekVersion();
  const current = () => owns() && ticket === intent && usePlayerStore.getState().queue === queue
    && usePlayerStore.getState().index === selected && playbackUserSeekVersion() === seekVersion;
  try {
    const resolved = await resolveRecommendationQueue(matches.map((entry) => entry.song), index, currentRecommendationSongs, current);
    if (!current()) return 'superseded';
    if (!resolved) return 'unavailable';
    const ok = await usePlayerStore.getState().playQueue(resolved.songs, resolved.index, tg('Lyrics'));
    return ok ? 'played' : owns() && ticket === intent ? 'unavailable' : 'superseded';
  } catch { return current() ? 'unavailable' : 'superseded'; }
}
