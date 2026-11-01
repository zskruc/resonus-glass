/** Bound decoded image ownership without removing routes or their list state. */
export type ImageLeaseRoute = Readonly<{ key: string; name: string }>;
export type ImageLeaseNavigation = Readonly<{ index?: number; routes: readonly ImageLeaseRoute[] }>;
export interface RouteImagePlan {
  readonly identity: string;
  readonly ready: boolean;
  readonly focusedKey?: string;
  readonly retainedKeys: ReadonlySet<string>;
}
export interface RouteImageLeaseSnapshot extends RouteImagePlan {
  readonly transitionKeys: ReadonlySet<string>;
}

const OVERLAYS = new Set(['player', 'lyrics', 'queue']);
const EMPTY_KEYS: ReadonlySet<string> = new Set();
const EMPTY_PLAN: RouteImagePlan = Object.freeze({ identity: '', ready: false, retainedKeys: EMPTY_KEYS });

/** Expo's container may wrap the app stack in its generated __root slot. */
export function rootImageNavigation(value: unknown): ImageLeaseNavigation | undefined {
  let current = value;
  for (let depth = 0; depth < 8; depth++) {
    if (!current || typeof current !== 'object') return undefined;
    const state = current as { index?: unknown; routes?: unknown };
    if (!Array.isArray(state.routes) || state.routes.length === 0) return undefined;
    const index = state.index === undefined ? state.routes.length - 1 : state.index;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= state.routes.length) return undefined;
    const route = state.routes[index as number];
    if (route?.name === '__root') {
      if (!route.state) return undefined;
      current = route.state; continue;
    }
    if (!state.routes.every((entry) => typeof entry?.key === 'string' && typeof entry?.name === 'string')) return undefined;
    return { index: index as number, routes: state.routes };
  }
  return undefined;
}

/** Keep Home, the two most recent opaque pages, and their nearest modal surfaces. */
export function planRouteImages(state: ImageLeaseNavigation | undefined): RouteImagePlan {
  if (!state?.routes.length) return EMPTY_PLAN;
  const index = Math.min(state.routes.length - 1, Math.max(0, state.index ?? state.routes.length - 1));
  const routes = state.routes.slice(0, index + 1);
  const retained = new Set<string>();
  const tabs = routes.find((route) => route.name === '(tabs)');
  if (tabs) retained.add(tabs.key);
  const opaque = routes.map((route, at) => ({ ...route, at }))
    .filter((route) => route.name !== '(tabs)' && !OVERLAYS.has(route.name)).slice(-2);
  for (const route of opaque) retained.add(route.key);
  const lowerBound = opaque[0]?.at ?? 0;
  const modalNames = new Set<string>();
  for (let at = routes.length - 1; at >= lowerBound; at--) {
    const route = routes[at];
    if (OVERLAYS.has(route.name) && !modalNames.has(route.name)) {
      modalNames.add(route.name);
      retained.add(route.key);
    }
  }
  return Object.freeze({ ready: true, focusedKey: routes[index].key,
    identity: JSON.stringify(routes.map((route) => [route.key, route.name])), retainedKeys: retained });
}

type Timer = ReturnType<typeof setTimeout>;
type Clock = { schedule: (callback: () => void, delay: number) => Timer; cancel: (timer: Timer) => void };
const CLOCK: Clock = { schedule: (callback, delay) => setTimeout(callback, delay), cancel: clearTimeout };

/** Native events can precede/lag state commits; each fallback belongs to one navigation generation. */
export class RouteImageLeaseController {
  private desired: RouteImagePlan = EMPTY_PLAN;
  private previous: RouteImagePlan = EMPTY_PLAN;
  private snapshot: RouteImageLeaseSnapshot = Object.freeze({ ...EMPTY_PLAN, transitionKeys: EMPTY_KEYS });
  private listeners = new Set<() => void>();
  private timer: Timer | undefined;
  private timerVersion = 0;
  private generation = 0;
  private transitioning = false;
  private activeTransitions = new Set<string>();
  private pendingStarts: { target: string; closing: boolean; generation: number }[] = [];
  private readonly clock: Clock;

  constructor(clock: Clock = CLOCK) { this.clock = clock; }
  getSnapshot = (): RouteImageLeaseSnapshot => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  observe(state: ImageLeaseNavigation | undefined) {
    const plan = planRouteImages(state);
    // Expo can briefly publish a partial generated slot during hydration or
    // deep-link replacement. Keep the last proven ownership, not default-on
    // for every old route (which would decode the entire navigation history).
    if (!plan.ready && this.desired.ready) return;
    if (plan.identity === this.desired.identity) return;
    this.previous = this.desired;
    this.desired = plan;
    const priorGeneration = this.generation;
    this.generation++;
    this.activeTransitions.clear();
    this.transitioning = this.previous.ready && plan.ready;
    for (const start of this.pendingStarts) {
      if (start.generation === priorGeneration && this.matchesTarget(start.target, start.closing)) this.activeTransitions.add(start.target);
    }
    this.pendingStarts = [];
    this.publish();
    // Some routes explicitly use animation:none and emit no transition event.
    // A bounded handoff still leaves native fade/back gestures time to finish.
    if (this.transitioning && this.activeTransitions.size === 0) this.arm(700);
    else this.clearTimer();
  }

  transitionStart = (target?: string, closing?: boolean) => {
    if (!this.transitioning || !this.matchesTarget(target, closing)) {
      // Native onWillDisappear/onWillAppear can precede the JS state event.
      // Carry only the next-generation candidates, never an unbounded history.
      if (target && typeof closing === 'boolean' &&
          (closing ? target === this.desired.focusedKey : target !== this.desired.focusedKey)) {
        this.pendingStarts = [...this.pendingStarts.filter((start) => start.target !== target),
          { target, closing, generation: this.generation }].slice(-2);
      }
      return;
    }
    this.activeTransitions.add(target ?? '');
    // The old/new union is already bounded. A real interactive transition may
    // remain half open for arbitrarily long; never drop its image on a timer.
    this.clearTimer();
  };

  transitionEnd = (target?: string, closing?: boolean) => {
    this.pendingStarts = this.pendingStarts.filter((start) => start.target !== target || closing !== undefined && start.closing !== closing);
    if (!this.transitioning || !this.matchesTarget(target, closing)) return;
    this.activeTransitions.delete(target ?? '');
    if (this.activeTransitions.size === 0) this.settle();
  };

  transitionCancel = (target?: string) => {
    this.pendingStarts = this.pendingStarts.filter((start) => start.target !== target);
    if (this.transitioning && this.matchesTarget(target)) this.settle();
  };

  dispose() { this.generation++; this.pendingStarts = []; this.clearTimer(); this.listeners.clear(); }

  private matchesTarget(target?: string, closing?: boolean) {
    if (target === undefined) return true;
    // A delayed "B appeared" from A→B cannot complete the newer B→A pop.
    if (target === this.desired.focusedKey) return closing !== true;
    return target === this.previous.focusedKey && closing !== false;
  }
  private arm(delay: number) {
    this.clearTimer();
    const generation = this.generation;
    const version = this.timerVersion;
    this.timer = this.clock.schedule(() => {
      if (this.generation === generation && this.timerVersion === version) this.settle();
    }, delay);
  }
  private clearTimer() { this.timerVersion++; if (this.timer !== undefined) this.clock.cancel(this.timer); this.timer = undefined; }
  private settle() {
    this.clearTimer(); this.transitioning = false; this.activeTransitions.clear();
    this.previous = this.desired; this.publish();
  }
  private publish() {
    const transitionKeys = this.transitioning
      ? new Set([...this.previous.retainedKeys, ...this.desired.retainedKeys]) : EMPTY_KEYS;
    this.snapshot = Object.freeze({ ...this.desired,
      retainedKeys: this.transitioning ? transitionKeys : this.desired.retainedKeys, transitionKeys });
    for (const listener of [...this.listeners]) listener();
  }
}

/** A covered route may freeze only after its new image lease reached a host commit. */
export function canFreezeRouteImages(snapshot: RouteImageLeaseSnapshot, routeKey: string, leaseCommitted: boolean) {
  return snapshot.ready && !snapshot.retainedKeys.has(routeKey) && leaseCommitted && !snapshot.transitionKeys.has(routeKey);
}
