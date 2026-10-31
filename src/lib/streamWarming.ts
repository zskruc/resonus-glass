import { speculativeSlots, withSpeculativeSlot, type RequestSlots } from '@/lib/netBudget';
import type { PlaybackLoadGate } from '@/lib/playbackLoadGate';

type WarmEvent = 'asked' | 'ready' | 'failed';
type PlaybackIntent = object;

interface Options<Owner> {
  /** Read live settings/account/window state; never capture an old boolean. */
  canRequest: (owner: Owner, id: string) => boolean;
  request: (url: string, signal: AbortSignal) => Promise<unknown>;
  timeoutMs: number;
  onEvent?: (event: WarmEvent) => void;
  slots?: RequestSlots;
  gate?: PlaybackLoadGate;
}

/**
 * Serial, best-effort stream requests belonging to the current queue. A tap
 * publishes its queue before loading audio, so the latest playback intent
 * holds warming until its own source has been requested. When a playback gate
 * is supplied, native readiness additionally owns priority after installation;
 * an earlier load's finally block cannot release either newer hold.
 */
export class StreamWarming<Owner> {
  private generation = 0;
  private latestIntent: PlaybackIntent | null = null;
  private heldIntent: PlaybackIntent | null = null;
  private heldSource: object | null = null;
  private latestSource: object | null = null;
  private queuePriority: object | null = null;
  private sourcePriority: object | null = null;
  private readonly seen = new Set<string>();
  private chain: Promise<void> = Promise.resolve();
  private active: AbortController | null = null;
  private readonly options: Options<Owner>;

  constructor(options: Options<Owner>) { this.options = options; }

  get held(): boolean {
    // The shared gate owns the bounded wait in production. Queue/source
    // identities still guard their finally callbacks, but cannot strand work
    // if a native installation promise never returns before the deadline.
    return this.options.gate ? this.options.gate.held : this.heldIntent !== null || this.heldSource !== null;
  }

  /** Source loads from next/previous/jump are independent of queue rollback. */
  beginSource(priority = true): object {
    this.invalidate();
    const source = {};
    this.heldSource = source;
    this.latestSource = source;
    this.cancelSourcePriority();
    this.sourcePriority = priority ? this.options.gate?.hold() ?? null : null;
    if (!priority && this.queuePriority) this.options.gate?.release(this.queuePriority);
    return source;
  }

  /** Source installation returned; native readiness still owns the priority hold. */
  sourceReady(source: object): boolean {
    if (this.latestSource !== source) return false;
    return this.cancelSourcePriority();
  }

  /** Explicit pause/offline/failure ends priority without corrupting load ownership. */
  cancelSourcePriority(): boolean {
    const priority = this.sourcePriority;
    this.sourcePriority = null;
    return priority ? this.options.gate?.release(priority) ?? false : false;
  }

  releaseSource(source: object): boolean {
    if (this.heldSource !== source) return false;
    this.heldSource = null;
    return true;
  }

  beginQueue(): PlaybackIntent {
    this.reset();
    const intent = {};
    this.latestIntent = intent;
    this.heldIntent = intent;
    this.queuePriority = this.options.gate?.hold() ?? null;
    return intent;
  }

  owns(intent: PlaybackIntent): boolean { return this.latestIntent === intent; }

  release(intent: PlaybackIntent): boolean {
    if (this.heldIntent !== intent) return false;
    this.heldIntent = null;
    if (this.queuePriority) this.options.gate?.release(this.queuePriority);
    this.queuePriority = null;
    return true;
  }

  /** Network/setting changes cancel work without releasing a source still loading. */
  invalidate(): void {
    this.generation++;
    this.seen.clear();
    this.active?.abort();
  }

  /** Explicitly replacing or clearing the queue also supersedes its old load. */
  reset(): void {
    this.invalidate();
    this.cancelSourcePriority();
    if (this.queuePriority) this.options.gate?.release(this.queuePriority);
    this.queuePriority = null;
    this.latestIntent = null;
    this.latestSource = null;
    this.heldIntent = null;
    this.heldSource = null;
  }

  enqueue(id: string, url: string, owner: Owner): void {
    if (this.held || !this.options.canRequest(owner, id) || this.seen.has(id)) return;
    const generation = this.generation;
    this.seen.add(id);
    // Each task absorbs its own HTTP failure. A failed best-effort request
    // must not poison the chain and strand every song queued after it.
    this.chain = this.chain.then(() => this.run(id, url, owner, generation)).catch(() => {
      if (generation === this.generation) this.seen.delete(id);
    });
  }

  private async run(id: string, url: string, owner: Owner, generation: number): Promise<void> {
    const current = () => generation === this.generation;
    const wanted = () => current() && !this.held && this.options.canRequest(owner, id);
    try {
      await withSpeculativeSlot(wanted, async () => {
        const controller = new AbortController();
        this.active = controller;
        const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
        try {
          this.options.onEvent?.('asked');
          await this.options.request(url, controller.signal);
          if (current()) this.options.onEvent?.('ready');
        } catch {
          if (current()) {
            this.seen.delete(id);
            this.options.onEvent?.('failed');
          }
        } finally {
          clearTimeout(timer);
          // Headers are enough to warm a provider. Stop an ignored Range
          // response rather than accidentally downloading its whole song.
          controller.abort();
          if (this.active === controller) this.active = null;
        }
      }, this.options.slots ?? speculativeSlots, this.options.gate);
    } finally {
      // A song that left the upcoming window while waiting can return later.
      // Old generations must never delete a newer queue's same-ID marker.
      if (current() && !wanted()) this.seen.delete(id);
    }
  }
}
