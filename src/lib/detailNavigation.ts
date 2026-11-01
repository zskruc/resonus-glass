/** Revisit an exact media ancestor by popping; never reorder an existing Screen. */
export type DetailKind = 'artist' | 'album';
export type DetailTarget = Readonly<{ kind: DetailKind; id: string }>;
export type DetailHref = Readonly<{ pathname: '/artist/[id]' | '/album/[id]'; params: { id: string } }>;
export type DetailPopAction = Readonly<{
  type: 'POP'; target: string; source: string; payload: { count: number };
}>;
type Route = Readonly<{ key: string; name: string; params?: Record<string, unknown>; state?: unknown }>;
type AppStack = Readonly<{ key: string; type: 'stack'; index: number; routes: readonly Route[] }>;
type Decision = Readonly<{ type: 'push'; href: DetailHref }> | Readonly<{ type: 'noop' }>
  | Readonly<{ type: 'pop'; action: DetailPopAction }>;
const MODALS = new Set(['player', 'lyrics', 'queue', 'login']);

function appStack(value: unknown): AppStack | undefined {
  let current = value;
  for (let depth = 0; depth < 8; depth++) {
    if (!current || typeof current !== 'object') return;
    const state = current as { key?: unknown; type?: unknown; index?: unknown; routes?: unknown; routeNames?: unknown };
    if (!Array.isArray(state.routes) || !state.routes.length || !Number.isInteger(state.index)
      || (state.index as number) < 0 || (state.index as number) >= state.routes.length) return;
    const focused = state.routes[state.index as number];
    // Only unwrap Expo's generated container. Never search unrelated nested navigators.
    if (state.routes.length === 1 && focused?.name === '__root') { current = focused.state; continue; }
    const routeNames = state.routeNames;
    if (state.type !== 'stack' || typeof state.key !== 'string' || !Array.isArray(routeNames)
      || !['(tabs)', 'artist/[id]', 'album/[id]'].every((name) => routeNames.includes(name))
      || !state.routes.every((route) => typeof route?.key === 'string' && typeof route?.name === 'string')) return;
    return state as AppStack;
  }
}

export function detailNavigationDecision(root: unknown, target: DetailTarget): Decision {
  if (!target.id) return { type: 'noop' };
  const name = target.kind === 'artist' ? 'artist/[id]' : 'album/[id]';
  const push: Decision = { type: 'push', href: { pathname: `/${name}`, params: { id: target.id } } };
  const stack = appStack(root);
  if (!stack) return push;
  const focused = stack.routes[stack.index];
  if (focused.name === name && focused.params?.id === target.id) return { type: 'noop' };
  // A detail link above/below a player must not change that modal's lifecycle.
  for (let index = stack.index; index >= 0; index--) {
    const route = stack.routes[index];
    if (MODALS.has(route.name)) break;
    if (route.name === name && route.params?.id === target.id) {
      return { type: 'pop', action: { type: 'POP', target: stack.key, source: focused.key,
        payload: { count: stack.index - index } } };
    }
  }
  return push;
}

export interface DetailNavigationDriver {
  getRootState(): unknown;
  dispatch(action: DetailPopAction): void;
  push(href: DetailHref): void;
}

/** One small tap guard; it holds no route objects, native handles or navigation snapshots. */
export class DetailNavigationController {
  private last?: { target: string; origin: string; at: number };
  private readonly now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  open(target: DetailTarget, driver: DetailNavigationDriver): Decision['type'] {
    const root = driver.getRootState();
    const decision = detailNavigationDecision(root, target);
    if (decision.type === 'noop') return 'noop';
    const stack = appStack(root);
    const focused = stack?.routes[stack.index];
    const origin = JSON.stringify([stack?.key, stack?.index, focused?.key, focused?.params?.id]);
    const identity = JSON.stringify([target.kind, target.id]);
    const now = this.now();
    if (this.last?.target === identity && this.last.origin === origin && now - this.last.at < 600) return 'noop';
    this.last = { target: identity, origin, at: now };
    if (decision.type === 'pop') driver.dispatch(decision.action);
    else driver.push(decision.href);
    return decision.type;
  }
}
