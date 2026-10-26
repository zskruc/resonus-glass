/** Flat triples [row index, top, bottom], published after actual text measurement. */
export type LyricViewportWindow = { first: number; last: number; indices: number[] };

export interface LyricVisibilityFlag { get(): boolean; set(value: boolean): void }

/** Ignore unmeasured or backwards stale rows while a new font/layout batch arrives. */
export function collectLyricMeasurements(rows: readonly ({ y: number; h: number } | undefined)[], count: number): number[] {
  const result: number[] = [];
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < count; index++) {
    const row = rows[index];
    if (!row || !Number.isFinite(row.y) || !Number.isFinite(row.h) || row.h <= 0 || row.y < bottom - 0.01) continue;
    result.push(index, row.y, row.y + row.h);
    bottom = row.y + row.h;
  }
  return result;
}

export function sameLyricViewportWindow(a: LyricViewportWindow, b: LyricViewportWindow): boolean {
  'worklet';
  if (a.first !== b.first || a.last !== b.last || a.indices.length !== b.indices.length) return false;
  for (let i = 0; i < a.indices.length; i++) if (a.indices[i] !== b.indices[i]) return false;
  return true;
}

/** Binary searches measured rows; work remains logarithmic while the list scrolls. */
export function lyricViewportWindow(
  measured: readonly number[],
  offset: number,
  height: number,
  overscan = 64,
): LyricViewportWindow {
  'worklet';
  const count = Math.floor(measured.length / 3);
  if (count === 0 || !Number.isFinite(offset) || !Number.isFinite(height) || height <= 0) {
    return { first: -1, last: -1, indices: [] };
  }
  const margin = Number.isFinite(overscan) ? Math.max(0, overscan) : 0;
  const top = Math.max(0, offset - margin);
  const bottom = offset + height + margin;
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (measured[middle * 3 + 2] <= top) low = middle + 1;
    else high = middle;
  }
  const first = low;
  low = first;
  high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (measured[middle * 3 + 1] < bottom) low = middle + 1;
    else high = middle;
  }
  if (first >= low) return { first: -1, last: -1, indices: [] };
  const indices: number[] = [];
  for (let position = first; position < low; position++) indices.push(measured[position * 3]);
  return { first: indices[0], last: indices[indices.length - 1], indices };
}

/** Touch only the old/new viewport rows, never every lyric on each scroll event. */
export function updateLyricViewportVisibility(
  flags: readonly LyricVisibilityFlag[],
  previous: LyricViewportWindow,
  next: LyricViewportWindow,
): void {
  'worklet';
  for (const index of previous.indices) {
    if (index < 0 || index >= flags.length) continue;
    if (next.indices.indexOf(index) < 0 && flags[index].get()) flags[index].set(false);
  }
  for (const index of next.indices) {
    if (index >= 0 && index < flags.length && !flags[index].get()) flags[index].set(true);
  }
}
