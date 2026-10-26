/** Original native gesture math for the AMLL-style player bar. */
export interface AmllSliderRange {
  minimum: number;
  maximum: number;
  lower: number;
  upper: number;
  step: number;
}

export function amllSliderReversed(inverted: boolean, rtl: boolean | undefined): boolean {
  return inverted !== (rtl === true);
}

/** Guards callbacks already queued when a song, output or range is replaced. */
export interface AmllSliderInteraction {
  generation: number;
  active: boolean;
}

export function invalidateAmllSliderInteraction(session: AmllSliderInteraction): boolean {
  const cancelled = session.active;
  session.generation++;
  session.active = false;
  return cancelled;
}

export function beginAmllSliderInteraction(session: AmllSliderInteraction, generation: number): boolean {
  if (session.generation !== generation || session.active) return false;
  session.active = true;
  return true;
}

export function isCurrentAmllSliderInteraction(session: AmllSliderInteraction, generation: number): boolean {
  return session.generation === generation && session.active;
}

export function finishAmllSliderInteraction(session: AmllSliderInteraction, generation: number): boolean {
  if (!isCurrentAmllSliderInteraction(session, generation)) return false;
  session.active = false;
  return true;
}

export function amllSliderRange(minimum = 0, maximum = 1, step = 0, lower?: number, upper?: number): AmllSliderRange {
  'worklet';
  const min = Number.isFinite(minimum) ? minimum : 0;
  const max = Number.isFinite(maximum) ? Math.max(min, maximum) : min;
  const low = Number.isFinite(lower) ? Math.max(min, Math.min(max, lower!)) : min;
  const high = Number.isFinite(upper) ? Math.max(low, Math.min(max, upper!)) : max;
  return { minimum: min, maximum: max, lower: low, upper: high,
    step: Number.isFinite(step) ? Math.max(0, step) : 0 };
}

export function amllSliderClamp(value: number, range: AmllSliderRange): number {
  'worklet';
  return Math.max(range.lower, Math.min(range.upper, Number.isFinite(value) ? value : range.lower));
}

export function amllSliderProgress(value: number, range: AmllSliderRange): number {
  'worklet';
  const span = range.maximum - range.minimum;
  return span > 0 ? (amllSliderClamp(value, range) - range.minimum) / span : 0;
}

export function amllSliderValueAt(x: number, width: number, range: AmllSliderRange, reversed = false): number {
  'worklet';
  const raw = Number.isFinite(x) && Number.isFinite(width) && width > 0 ? x / width : 0;
  const position = reversed ? 1 - raw : raw;
  const value = amllSliderClamp(range.minimum + position * (range.maximum - range.minimum), range);
  // Keep both authored endpoints reachable even when a step does not divide
  // the range evenly; intermediate steps stay anchored to the minimum.
  if (range.step <= 0 || value === range.lower || value === range.upper) return value;
  const snapped = range.minimum + Math.round((value - range.minimum) / range.step) * range.step;
  return amllSliderClamp(Number(snapped.toPrecision(12)), range);
}

/** Overshooting either end moves the entire bar, never the committed value. */
export function amllSliderElasticOffset(x: number, width: number): number {
  'worklet';
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return 0;
  const position = x / width;
  const excess = position < 0 ? position : position > 1 ? position - 1 : 0;
  return Math.tanh(excess * 2) * 12;
}
