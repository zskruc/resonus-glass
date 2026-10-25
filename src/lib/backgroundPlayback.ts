/** Recovery policy shared by the player's timer and network-change listener. */
export const BACKGROUND_RETRY_FIRST_MS = 15_000;
export const BACKGROUND_RETRY_MS = 60_000;
export const BACKGROUND_RETRY_ROUNDS = 30;
export const NETWORK_RESUME_WINDOW_MS = 15 * 60 * 1000;

interface RecoveryContext {
  songId: string | null;
  isPlaying: boolean;
  background: boolean;
  remote: boolean;
}

export interface PlaybackRecoveryTicket {
  generation: number;
  songId: string;
  positionSec: number;
}

interface PlaybackStatus {
  playing: boolean;
  isLoaded: boolean;
  isBuffering: boolean;
  error?: string | null;
}

/** Android reports playing intent during buffering; that is not recovery. */
export function playbackIsRunning(status: PlaybackStatus): boolean {
  return status.playing && status.isLoaded && !status.isBuffering && !status.error;
}

/** No native objects or timers: a canceled attempt can never regain ownership. */
export class PlaybackOutage {
  private generation = 0;
  private failure: { songId: string; positionSec: number; at: number; rounds: number } | null = null;
  waiting = false;
  private recovering = false;

  get pending(): boolean {
    return !!this.failure;
  }

  remember(songId: string, positionSec: number, now: number, background: boolean): boolean {
    if (this.failure?.songId !== songId) {
      this.generation++;
      this.failure = { songId, positionSec, at: now, rounds: 0 };
    }
    const started = background && !this.waiting;
    this.waiting ||= background;
    return started;
  }

  cancel(): void {
    this.generation++;
    this.failure = null;
    this.waiting = false;
    this.recovering = false;
  }

  trackChanged(songId: string | null): void {
    if (this.failure && this.failure.songId !== songId) this.cancel();
  }

  /** Foreground ends the unattended wait, but a later network edge can rescue it. */
  leaveBackground(): boolean {
    const waiting = this.waiting;
    if (waiting) {
      this.generation++;
      this.waiting = false;
      this.recovering = false;
    }
    return waiting;
  }

  owns(ticket: PlaybackRecoveryTicket): boolean {
    return ticket.generation === this.generation && ticket.songId === this.failure?.songId;
  }

  /** Queue edits may move this same song while audio initialization awaits. */
  targetIndex(
    ticket: PlaybackRecoveryTicket,
    state: { queue: readonly { id: string }[]; index: number },
    remote: boolean,
  ): number | null {
    if (!this.owns(ticket) || remote || state.queue[state.index]?.id !== ticket.songId) return null;
    return state.index;
  }

  private ticket(): PlaybackRecoveryTicket {
    const failure = this.failure!;
    return { generation: this.generation, songId: failure.songId, positionSec: failure.positionSec };
  }

  retry(context: RecoveryContext): PlaybackRecoveryTicket | null {
    if (!this.failure || !this.waiting) return null;
    if (!context.background || context.remote || !context.isPlaying || context.songId !== this.failure.songId) {
      this.cancel();
      return null;
    }
    if (++this.failure.rounds > BACKGROUND_RETRY_ROUNDS) {
      this.leaveBackground();
      return null;
    }
    // An older offset-seek query can still be pending when this round starts.
    this.generation++;
    this.recovering = true;
    return this.ticket();
  }

  networkReturned(context: RecoveryContext, now: number): PlaybackRecoveryTicket | null {
    if (!this.failure) return null;
    if (context.remote || context.songId !== this.failure.songId ||
        (context.isPlaying && !this.waiting && !this.recovering) || now - this.failure.at > NETWORK_RESUME_WINDOW_MS) {
      this.cancel();
      return null;
    }
    // Invalidate any older retry still waiting on the native player.
    this.generation++;
    this.waiting = false;
    this.recovering = true;
    return this.ticket();
  }

  observeStatus(songId: string | null, status: PlaybackStatus, positionSec: number): boolean {
    this.trackChanged(songId);
    if (!this.failure || !playbackIsRunning(status)) return false;
    // A reload starts at zero before its saved seek lands. Confirming then
    // would cancel that seek and replay the beginning instead of resuming.
    if (positionSec < this.failure.positionSec - 1) return false;
    this.cancel();
    return true;
  }
}
