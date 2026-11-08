/** A cancelled mini pull may finish before its route push, or after a newer route. */
export function createPlayerRevealGuard() {
  let generation = 0;
  let pending: string | null = null;
  let focused: { owner: object; request: string | null } | null = null;
  return {
    begin(): string {
      pending = `pull-${++generation}`;
      return pending;
    },
    owns(request: string): boolean { return pending === request; },
    focus(owner: object, request: string | null) {
      focused = { owner, request };
      // A normal tap starts a fresh player, never inherits an old pull.
      if (request === null) pending = null;
    },
    blur(owner: object) {
      if (focused?.owner === owner) focused = null;
    },
    isFocused(owner: object): boolean { return focused?.owner === owner; },
    cancel(request: string): 'close' | 'reset' | 'ignore' {
      if (pending !== request) return 'ignore';
      pending = null;
      return focused?.request === request ? 'close' : 'reset';
    },
  };
}

export const playerRevealGuard = createPlayerRevealGuard();
