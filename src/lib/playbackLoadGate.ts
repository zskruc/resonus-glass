/** Only optional background work waits here; a playback request never does. */
export class PlaybackLoadGate {
  private current: object | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly waiters = new Set<() => void>();
  private readonly listeners = new Set<() => void>();
  private readonly timeoutMs: number;

  constructor(timeoutMs = 120_000) { this.timeoutMs = timeoutMs; }

  get held(): boolean { return this.current !== null; }

  hold(): object {
    const token = {};
    this.current = token;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.release(token), this.timeoutMs);
    return token;
  }

  /** An old load/failure/timeout cannot unlock the latest requested source. */
  release(token: object): boolean {
    if (this.current !== token) return false;
    this.current = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const waiting = [...this.waiters];
    this.waiters.clear();
    for (const resolve of waiting) resolve();
    for (const listener of this.listeners) listener();
    return true;
  }

  wait(): Promise<void> {
    return this.held ? new Promise((resolve) => this.waiters.add(resolve)) : Promise.resolve();
  }

  onOpen(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const playbackLoadGate = new PlaybackLoadGate();
