/** Conservative, absolute-time boundary rules for optional local-file edge trimming. */
export interface SilenceTrimPreferences {
  enabled: boolean;
  thresholdDb: number;
  minimumSilenceMs: number;
  scanSeconds: number;
}

export const SILENCE_TRIM_DEFAULTS: SilenceTrimPreferences = {
  enabled: false,
  thresholdDb: -60,
  minimumSilenceMs: 500,
  scanSeconds: 12,
};

export function normalizeSilenceTrimPreferences(raw: unknown): SilenceTrimPreferences {
  const saved = raw && typeof raw === 'object' ? raw as Partial<SilenceTrimPreferences> : {};
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return {
    enabled: saved.enabled === true,
    thresholdDb: number(saved.thresholdDb, SILENCE_TRIM_DEFAULTS.thresholdDb, -80, -35),
    minimumSilenceMs: number(saved.minimumSilenceMs, SILENCE_TRIM_DEFAULTS.minimumSilenceMs, 250, 2000),
    scanSeconds: number(saved.scanSeconds, SILENCE_TRIM_DEFAULTS.scanSeconds, 3, 20),
  };
}

/** No HTTP input: inspection must never start a hidden full-song download. */
export function isLocalSilenceUri(uri: string | undefined): uri is string {
  return !!uri && (/^file:\/\//i.test(uri) || /^content:\/\/media(?:\/|$)/i.test(uri));
}

export interface SilenceBounds {
  fingerprint: string;
  durationSec: number;
  startSec: number;
  endSec: number;
  complete: boolean;
  cached?: boolean;
}

export function normalizeSilenceBounds(raw: unknown): SilenceBounds | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<SilenceBounds>;
  const { durationSec, startSec, endSec, fingerprint } = value;
  if (typeof fingerprint !== 'string' || !fingerprint || typeof durationSec !== 'number'
    || typeof startSec !== 'number' || typeof endSec !== 'number'
    || ![durationSec, startSec, endSec].every(Number.isFinite) || durationSec <= 0
    || startSec < 0 || endSec > durationSec + 0.05 || endSec - startSec < 1) return null;
  return { fingerprint, durationSec, startSec, endSec: Math.min(durationSec, endSec),
    complete: value.complete === true, cached: value.cached === true };
}

export interface SilenceClock {
  positionSec: number;
  durationSec: number;
  playing: boolean;
  loaded: boolean;
  buffering: boolean;
}

/** The player still reports the original file clock; nothing retimes lyrics. */
export class SilenceTrimSession {
  private identity = '';
  private bounds: SilenceBounds | null = null;
  private leadingAllowed = false;
  private leadingDone = false;
  private tailDone = false;
  private manual = false;

  begin(identity: string, allowLeading: boolean) {
    this.identity = identity;
    this.bounds = null;
    this.leadingAllowed = allowLeading;
    this.leadingDone = false;
    this.tailDone = false;
    this.manual = false;
  }

  clear() { this.begin('', false); }

  accept(identity: string, raw: unknown): boolean {
    if (!this.identity || identity !== this.identity) return false;
    const bounds = normalizeSilenceBounds(raw);
    if (!bounds || this.bounds?.complete && !bounds.complete) return false;
    this.bounds = bounds;
    return true;
  }

  /** Resume/recovery positions must not be pulled back to the leading boundary. */
  cancelLeading() { this.leadingAllowed = false; }

  /** A deliberate scrub wins for the remainder of this play-through. */
  manualSeek() { this.leadingAllowed = false; this.manual = true; }

  effectiveEnd(durationSec: number): number {
    const bounds = this.validBounds(durationSec);
    return bounds?.complete && !this.manual ? Math.min(durationSec, bounds.endSec) : durationSec;
  }

  managesLoop(durationSec: number): boolean {
    const bounds = this.validBounds(durationSec);
    return !!bounds && !this.manual && (bounds.startSec > 0.05
      || bounds.complete && bounds.endSec < durationSec - 0.05);
  }

  action(clock: SilenceClock, allowTail = true): { kind: 'head'; positionSec: number } | { kind: 'tail' } | null {
    const bounds = this.validBounds(clock.durationSec);
    if (!bounds || this.manual || !clock.loaded || clock.buffering || !clock.playing
      || !Number.isFinite(clock.positionSec) || clock.positionSec < 0) return null;
    if (!this.leadingDone && this.leadingAllowed) {
      this.leadingDone = true;
      if (bounds.startSec > clock.positionSec + 0.03) return { kind: 'head', positionSec: bounds.startSec };
    }
    if (allowTail && !this.tailDone && bounds.complete && bounds.endSec < clock.durationSec - 0.1
      && clock.positionSec >= bounds.endSec) {
      this.tailDone = true;
      return { kind: 'tail' };
    }
    return null;
  }

  private validBounds(durationSec: number): SilenceBounds | null {
    if (!this.bounds || !Number.isFinite(durationSec) || durationSec <= 0) return null;
    // The analyzed file must agree with the live native source, not only a
    // server's tag duration or a stale event from the preceding item.
    if (Math.abs(durationSec - this.bounds.durationSec) > Math.max(0.5, durationSec * 0.005)) return null;
    return this.bounds;
  }
}
