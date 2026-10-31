export const MEDIA_CACHE_KINDS = ['lyrics', 'albumCovers', 'artistCovers'] as const;
export type MediaCacheKind = typeof MEDIA_CACHE_KINDS[number];
export type MediaCacheStatus = 'idle' | 'discovering' | 'running' | 'paused' | 'cancelled' | 'completed' | 'error';
export type MediaCacheReason = 'offline' | 'wifi' | 'profile' | 'background' | 'user' | null;
export type MediaCacheOutcome = 'success' | 'cached' | 'missing' | 'failed';
export interface MediaCacheCount {
  total: number; success: number; cached: number; missing: number; failed: number; pending: number;
}
export type MediaCacheStats = Record<MediaCacheKind, MediaCacheCount>;
export interface MediaCacheCursor { offset: number; complete: boolean; pageSignature?: string }
export interface MediaCacheJob {
  selected: MediaCacheKind[];
  status: MediaCacheStatus;
  reason: MediaCacheReason;
  phase: MediaCacheKind | null;
  cursors: Record<MediaCacheKind, MediaCacheCursor>;
  error: string | null;
  lyricsSource?: 'local' | 'online' | 'off';
}
export interface MediaCacheTask {
  kind: MediaCacheKind;
  id: string;
  data: unknown;
}
export function emptyMediaCacheStats(): MediaCacheStats {
  return Object.fromEntries(MEDIA_CACHE_KINDS.map((kind) => [kind,
    { total: 0, success: 0, cached: 0, missing: 0, failed: 0, pending: 0 }])) as MediaCacheStats;
}
export function newMediaCacheJob(selected: MediaCacheKind[] = [...MEDIA_CACHE_KINDS]): MediaCacheJob {
  return { selected, status: 'idle', reason: null, phase: null, error: null,
    cursors: { lyrics: { offset: 0, complete: false }, albumCovers: { offset: 0, complete: false }, artistCovers: { offset: 0, complete: false } } };
}
