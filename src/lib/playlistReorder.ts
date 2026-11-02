import type { Song } from '@/api/subsonic';

/** A duplicate song is still a separate playlist entry. Keys travel with the
 * entry rather than being rebuilt from its current position after every drop. */
export interface PlaylistOrderRow {
  readonly key: string;
  readonly song: Song;
}

export function playlistOrderRows(songs: readonly Song[], scope: string): PlaylistOrderRow[] {
  return songs.map((song, index) => ({ key: JSON.stringify([scope, index]), song }));
}

/** Adapted from Resonus #296 (GPL-3.0-or-later), preserving occurrence objects. */
export function applyPlaylistDrag<T>(rows: T[], from: number, to: number): T[];
export function applyPlaylistDrag<T>(rows: readonly T[], from: number, to: number): readonly T[];
export function applyPlaylistDrag<T>(rows: readonly T[], from: number, to: number): readonly T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= rows.length) return rows;
  const target = Math.max(0, Math.min(to, rows.length - 1));
  if (from === target) return rows;
  const next = rows.slice();
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Neither a filtered subset nor a duplicated/mutated row may replace a list. */
export function completePlaylistOrder(source: readonly PlaylistOrderRow[], next: readonly PlaylistOrderRow[]): boolean {
  if (source.length !== next.length) return false;
  const remaining = new Map(source.map((row) => [row.key, row.song.id]));
  if (remaining.size !== source.length) return false;
  for (const row of next) {
    if (!remaining.has(row.key) || remaining.get(row.key) !== row.song.id) return false;
    remaining.delete(row.key);
  }
  return remaining.size === 0;
}

interface OrderWriteOptions {
  current(): boolean;
  /** The predicate also protects asynchronous optimistic cache updates. */
  optimistic(rows: readonly PlaylistOrderRow[], latest: () => boolean): void | Promise<void>;
  write(ids: string[], expectedSongIds: string[]): Promise<void>;
  failed(error: unknown, confirmed: readonly PlaylistOrderRow[]): void | Promise<void>;
  idle?(): void;
  busy?(value: boolean): void;
}

/** One in-flight write and one replaceable pending order. Expected IDs follow
 * the last successful write, not the latest optimistic cache. Disposing drops
 * queued work; an already sent request still belongs to its original account. */
export function createPlaylistOrderWriter(initial: readonly PlaylistOrderRow[], options: OrderWriteOptions) {
  const source = initial.slice();
  let rows: readonly PlaylistOrderRow[] = source, confirmed = source;
  let version = 0, writing = false, disposed = false, failed = false;
  type Prepared = { ok: true } | { ok: false; error: unknown };
  let pending: { rows: readonly PlaylistOrderRow[]; ready: Promise<Prepared> } | undefined;
  const current = () => !disposed && options.current();

  async function drain() {
    if (writing) return;
    writing = true;
    if (current()) options.busy?.(true);
    try {
      while (pending && current()) {
        const next = pending;
        pending = undefined;
        const prepared = await next.ready;
        if (!current()) break;
        // A newer drop arrived while cache cancellation was completing.
        if (pending) continue;
        if (!prepared.ok) throw prepared.error;
        await options.write(next.rows.map((row) => row.song.id), confirmed.map((row) => row.song.id));
        if (!current()) break;
        confirmed = next.rows.slice();
      }
    } catch (error) {
      pending = undefined;
      failed = true;
      if (current()) await options.failed(error, confirmed);
    } finally {
      writing = false;
      if (!current()) { disposed = true; pending = undefined; }
      if (current()) {
        options.busy?.(false);
        if (!failed) options.idle?.();
      }
    }
  }

  return {
    get rows() { return rows; },
    get busy() { return writing || !!pending; },
    get failed() { return failed; },
    get active() { return !failed && current(); },
    enqueue(next: readonly PlaylistOrderRow[]): boolean {
      if (failed || !current() || !completePlaylistOrder(source, next)) return false;
      if (next.every((row, index) => row.key === rows[index].key)) return false;
      rows = next.slice();
      const asked = ++version;
      const rowsForWrite = rows;
      // Observe even superseded rejections immediately: they must not become
      // unhandled promises just because a faster drop replaced their order.
      const latest = () => current() && asked === version;
      const ready = Promise.resolve().then(() => latest() ? options.optimistic(rowsForWrite, latest) : undefined)
        .then<Prepared, Prepared>(() => ({ ok: true }), (error: unknown) => ({ ok: false, error }));
      pending = { rows: rowsForWrite, ready };
      void drain();
      return true;
    },
    dispose() { disposed = true; pending = undefined; version++; },
  };
}
