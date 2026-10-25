/** Pure range and handoff rules for the actual system-media volume controls. */
export type SystemRouteKind = 'speaker' | 'headphones' | 'bluetooth' | 'external' | 'unknown';

export interface MediaControlsState {
  supported: boolean;
  minimum: number;
  maximum: number;
  level: number;
  fixed: boolean;
  muted: boolean;
  routeKind: SystemRouteKind;
  routeName: string;
  routeId: string;
  outputSwitcherSupported: boolean;
}

export function mediaVolumeLevel(value: number, minimum: number, maximum: number): number {
  const lower = Number.isFinite(minimum) ? Math.max(0, Math.round(minimum)) : 0;
  const upper = Number.isFinite(maximum) ? Math.max(lower, Math.round(maximum)) : lower;
  return Math.max(lower, Math.min(upper, Number.isFinite(value) ? Math.round(value) : lower));
}

export function mediaVolumeFraction(level: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(maximum) || !Number.isFinite(minimum) || maximum <= minimum) return 0;
  return (mediaVolumeLevel(level, minimum, maximum) - minimum) / (maximum - minimum);
}

/** A drag belongs to the output that existed at touch-down, never the next one. */
export function canApplyMediaVolumeDrag(startOutput: string, currentOutput: string): boolean {
  return startOutput === currentOutput;
}

/** The active route identity also cancels a drag when headphones are unplugged. */
export function mediaVolumeOutputKey(
  remote: 'upnp' | 'jukebox' | null,
  remoteId: string | null,
  routeKind: string,
  routeName: string,
  routeId = routeName,
): string {
  return remote ? `${remote}:${remoteId ?? ''}` : `local:${routeKind}:${routeId}`;
}
