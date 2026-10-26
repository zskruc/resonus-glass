/** One player surface owns entry/drag/exit; navigation only commits once it is offscreen. */
export type PlayerCloseSource = 'button' | 'handle' | 'back' | 'navigation';
export interface PlayerCloseSession {
  generation: number;
  phase: 'open' | 'closing' | 'ready' | 'removed';
  source?: PlayerCloseSource;
}

export function beginPlayerClose(session: PlayerCloseSession, source: PlayerCloseSource): number | undefined {
  if (session.phase !== 'open') return;
  session.phase = 'closing';
  session.source = source;
  return ++session.generation;
}

export function completePlayerClose(session: PlayerCloseSession, generation: number): boolean {
  if (session.phase !== 'closing' || session.generation !== generation) return false;
  session.phase = 'ready';
  return true;
}

/** Navigation objects may update during commit; the route action is replayed once. */
export function commitPlayerClose(session: PlayerCloseSession): boolean {
  if (session.phase !== 'ready') return false;
  session.phase = 'removed';
  return true;
}

export function removePlayerTransition(session: PlayerCloseSession): void {
  session.generation++;
  session.phase = 'removed';
}

/** Upward pulls resist at 32dp; downward pulls track the handle directly. */
export function amllPlayerDragOffset(translation: number, height: number): number {
  'worklet';
  if (!Number.isFinite(translation)) return 0;
  return translation >= 0 ? Math.min(Math.max(0, height), translation) : Math.tanh(translation / 160) * 32;
}

/** Retain Resonus's 120dp / 800dp/s downward dismissal gates. */
export function shouldCloseAmllPlayer(translation: number, velocity: number): boolean {
  'worklet';
  return Number.isFinite(translation) && translation > 0 &&
    (translation > 120 || (Number.isFinite(velocity) && velocity > 800));
}

export function amllPlayerExitDuration(offset: number, height: number): number {
  'worklet';
  const remaining = Math.max(0, height - Math.max(0, offset));
  if (remaining <= 1) return 0;
  return Math.max(100, Math.min(220, 220 * remaining / Math.max(1, height)));
}

/** Existing Resonus keeps native entry; AM++ mini pulls already supply their own. */
export function playerModalAnimation(presentation: 'amll' | 'resonus', revealing: boolean): 'none' | 'fade_from_bottom' {
  return presentation === 'amll' || revealing ? 'none' : 'fade_from_bottom';
}
