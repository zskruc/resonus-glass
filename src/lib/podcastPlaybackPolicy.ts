/** Per-show listening choices. Unknown duration never authorizes an end skip. */
export interface PodcastPlaybackPreferences {
  introSec: number;
  outroSec: number;
  continuous: boolean;
}
export const DEFAULT_PODCAST_PLAYBACK: Readonly<PodcastPlaybackPreferences> = Object.freeze({ introSec: 0, outroSec: 0, continuous: true });
function seconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(600, Math.round(value))) : 0;
}
export function podcastPlaybackPreferences(value: unknown): PodcastPlaybackPreferences {
  const input = value && typeof value === 'object' ? value as Partial<PodcastPlaybackPreferences> : {};
  return { introSec: seconds(input.introSec), outroSec: seconds(input.outroSec), continuous: input.continuous !== false };
}
export function podcastStartPosition(saved: number, duration: number, preferences: PodcastPlaybackPreferences): number {
  const resume = Number.isFinite(saved) && saved >= 0 ? saved : 0;
  const knownDuration = Number.isFinite(duration) && duration > 0;
  // Do not skip most of a trailer or an episode shorter than the intro.
  const intro = knownDuration ? Math.min(preferences.introSec, Math.max(0, duration - 30)) : 0;
  return knownDuration ? Math.min(Math.max(resume, intro), duration) : resume;
}
export function podcastOutroReached(position: number, duration: number, preferences: PodcastPlaybackPreferences): boolean {
  return preferences.outroSec > 0 && Number.isFinite(position) && Number.isFinite(duration)
    && duration > preferences.outroSec + Math.max(30, preferences.introSec)
    && position >= duration - preferences.outroSec && position < duration;
}
