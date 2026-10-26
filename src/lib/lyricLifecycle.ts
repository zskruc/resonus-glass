import { WORD_SWEEP_LEAD_MS } from '@/lib/lyricMotion';

/** Hidden retained views keep the last committed line instead of following playback. */
export function retainedLyricFocus(
  lines: readonly { start?: number }[],
  positionSec: number,
  wordTimed: boolean,
  active: boolean,
  committedIndex: number,
): number {
  if (!active) return committedIndex;
  const positionMs = positionSec * 1000 + (wordTimed ? WORD_SWEEP_LEAD_MS : 250);
  let index = -1;
  for (let i = 0; i < lines.length && (lines[i].start ?? 0) <= positionMs; i++) index = i;
  return index;
}

export interface LyricClockPlan { startMs: number; targetMs: number; durationMs: number }

/** null means cancel and retain the current visual clock, not reset it to playback. */
export function lyricClockPlan(
  positionSec: number,
  isPlaying: boolean,
  speed: number,
  active = true,
): LyricClockPlan | null {
  if (!active) return null;
  const startMs = Math.max(0, Number.isFinite(positionSec) ? positionSec : 0) * 1000;
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const durationMs = isPlaying ? 1200 : 0;
  return { startMs, targetMs: startMs + durationMs * rate, durationMs };
}
