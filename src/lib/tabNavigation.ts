import type { TabSegment } from './tabOrigin';

type TabJumpAction = {
  type: 'JUMP_TO';
  target: string;
  payload: { name: TabSegment; params?: unknown };
};

/** Target only the first tab navigator on the currently visible route path. */
export function getActiveTabJumpAction(state: unknown, segment: TabSegment): TabJumpAction | null {
  let active = state;
  for (let depth = 0; depth < 16; depth++) {
    if (!active || typeof active !== 'object') return null;
    const navigator = active as { type?: unknown; key?: unknown; index?: unknown; routes?: unknown };
    if (!Array.isArray(navigator.routes)) return null;
    if (navigator.type === 'tab') {
      const destination = navigator.routes.find((route) => route?.name === segment);
      if (typeof navigator.key !== 'string' || !navigator.key || !destination) return null;
      // JUMP_TO replaces params by default. Preserve the target's existing
      // route identity and filters instead of silently dropping them.
      const payload = destination.params === undefined ? { name: segment } : { name: segment, params: destination.params };
      return { type: 'JUMP_TO', target: navigator.key, payload };
    }
    const index = navigator.index === undefined ? 0 : navigator.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= navigator.routes.length) return null;
    active = navigator.routes[index]?.state;
  }
  return null;
}
