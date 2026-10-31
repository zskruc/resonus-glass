import type { Song, SubsonicAuth } from '@/api/subsonic';

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
export interface DownloadQueueItem {
  key: string; song: Song; status: DownloadStatus; bytesWritten: number; bytesTotal: number; error?: string; groups: string[];
}
export type DownloadOutcome = 'completed' | 'failed' | 'cancelled';
export class DownloadInterrupted extends Error {}
interface Transfer { pause: () => Promise<unknown>; cancel: () => Promise<unknown> }
export interface DownloadContext {
  auth: SubsonicAuth; current: () => boolean; cancelled: () => boolean; check: () => void;
  progress: (written: number, total: number) => void;
  transfer: (value: Transfer) => () => void;
}
interface Entry {
  item: DownloadQueueItem; profile: string; run: (context: DownloadContext) => Promise<void>;
  promise: Promise<DownloadOutcome>; resolve: (outcome: DownloadOutcome) => void;
  running?: Promise<void>; transfer?: Transfer; interrupting?: Promise<void>; snapshot?: DownloadQueueItem;
  cleanup?: () => Promise<void>;
  token?: object; blocked?: Promise<void>; hidden?: boolean;
}
interface Options {
  owner: () => SubsonicAuth | null; profile: (auth: SubsonicAuth) => string; allowed: () => boolean;
  limit: () => number; update: (items: DownloadQueueItem[], paused: boolean) => void;
}
const terminal = (state: DownloadStatus) => state === 'completed' || state === 'failed' || state === 'cancelled';

/** A session queue, partitioned by account. Completed audio stays in the
 * existing catalog; pending tasks never silently restart after app launch. */
export function createDownloadQueue(options: Options) {
  const entries = new Map<string, Entry>(), paused = new Set<string>();
  // Replaced/hidden entries can still own an unabortable file commit. Keep
  // their leases until settled, independent of the visible queue generation.
  const leases = new Map<Promise<void>, string>();
  const hold = (scope: string, work: Promise<void>) => {
    leases.set(work, scope);
    void work.then(() => leases.delete(work), () => leases.delete(work));
    return work;
  };
  const settle = async (scope?: string) => {
    for (;;) {
      const pending = [...leases].filter(([, profile]) => scope === undefined || profile === scope).map(([work]) => work);
      if (!pending.length) return;
      await Promise.all(pending);
    }
  };
  let owner = options.owner(), active = 0, draining = false, timer: ReturnType<typeof setTimeout> | undefined;
  const profile = () => { const auth = options.owner(); return auth ? options.profile(auth) : ''; };
  const publish = (immediate = true) => {
    const flush = () => { timer = undefined; const scope = profile();
      options.update([...entries.values()].filter((entry) => entry.profile === scope && !entry.hidden).map((entry) => {
        const item = entry.item, old = entry.snapshot;
        if (old && old.status === item.status && old.bytesWritten === item.bytesWritten && old.bytesTotal === item.bytesTotal
          && old.error === item.error && old.groups.length === item.groups.length && old.groups.every((group, index) => group === item.groups[index])) return old;
        return entry.snapshot = { ...item, groups: [...item.groups] };
      }), paused.has(scope)); };
    if (immediate) { if (timer) clearTimeout(timer); flush(); }
    else if (!timer) timer = setTimeout(flush, 150);
  };
  const interrupt = (entry: Entry, cancel: boolean) => {
    if (terminal(entry.item.status)) return Promise.resolve();
    entry.item.status = cancel ? 'cancelled' : 'paused';
    if (cancel) entry.resolve('cancelled');
    if (cancel) {
      const previous = entry.interrupting ?? Promise.resolve();
      entry.interrupting = hold(entry.profile, previous.catch(() => {}).then(async () => {
        await entry.transfer?.cancel().catch(() => {});
        await entry.cleanup?.().catch(() => {});
      }).finally(() => { entry.interrupting = undefined; kick(); }));
      return entry.interrupting;
    }
    if (entry.interrupting) return entry.interrupting;
    if (!entry.transfer) return Promise.resolve();
    const work = cancel ? entry.transfer?.cancel() : entry.transfer?.pause();
    entry.interrupting = hold(entry.profile, Promise.resolve(work).then(() => {}, () => {}).finally(() => { entry.interrupting = undefined; kick(); }));
    return entry.interrupting;
  };
  const pauseProfile = (scope: string) => {
    paused.add(scope);
    return Promise.all([...entries.values()].filter((entry) => entry.profile === scope).map((entry) => interrupt(entry, false)));
  };
  const sync = () => {
    const next = options.owner();
    if (next !== owner) {
      if (owner) void pauseProfile(options.profile(owner));
      owner = next;
    }
    if (next && !options.allowed()) void pauseProfile(options.profile(next));
  };
  const kick = () => {
    if (draining) return;
    sync(); const auth = options.owner();
    if (!auth || !options.allowed()) { publish(); return; }
    const scope = options.profile(auth);
    if (paused.has(scope)) { publish(); return; }
    const limit = Math.max(1, Math.min(20, Math.round(options.limit()) || 1));
    for (const entry of entries.values()) {
      if (active >= limit) break;
      if (entry.profile !== scope || entry.item.status !== 'queued' || entry.running || entry.interrupting || entry.blocked) continue;
      active++; entry.item.status = 'downloading'; entry.item.error = undefined;
      const token = {}; entry.token = token;
      const current = () => entries.get(entry.item.key) === entry && options.owner() === auth
        && entry.token === token && options.allowed() && !paused.has(scope) && entry.item.status === 'downloading';
      const check = () => { if (!current()) throw new DownloadInterrupted('Download interrupted'); };
      const context: DownloadContext = { auth, current, check, cancelled: () => entry.item.status === 'cancelled' || entries.get(entry.item.key) !== entry,
        progress: (written, total) => {
          if (!current()) return;
          entry.item.bytesWritten = Math.max(0, written);
          entry.item.bytesTotal = Math.max(0, total); publish(false);
        },
        transfer: (value) => { entry.transfer = value; return () => { if (entry.transfer === value) entry.transfer = undefined; }; },
      };
      entry.running = hold(entry.profile, Promise.resolve().then(() => { check(); return entry.run(context); }).then(() => {
        check(); entry.item.status = 'completed';
        if (entry.item.bytesTotal > 0) entry.item.bytesWritten = entry.item.bytesTotal;
        entry.resolve('completed');
      }).catch((error: unknown) => {
        if (!current() || error instanceof DownloadInterrupted) {
          if (entry.item.status === 'downloading') entry.item.status = 'paused';
          return;
        }
        entry.item.status = 'failed'; entry.item.error = 'Download failed'; entry.resolve('failed');
      }).finally(() => {
        active--; entry.running = undefined; entry.transfer = undefined;
        publish(); kick();
      }));
    }
    publish();
  };
  return {
    sync: kick,
    add(song: Song, group: string, run: Entry['run'], defer = false, cleanup?: Entry['cleanup']): Promise<DownloadOutcome> {
      sync(); const auth = options.owner();
      if (draining || !auth || !options.allowed()) return Promise.resolve('cancelled');
      const scope = options.profile(auth), key = `${scope}|${song.id}`;
      // Offline/policy sync can mark an empty profile paused. A later explicit
      // online download starts a new batch; only unfinished tasks carry a
      // real pause intent that the person must explicitly resume.
      if (paused.has(scope)) {
        let unfinished = false;
        for (const entry of entries.values()) if (entry.profile === scope && !terminal(entry.item.status)) { unfinished = true; break; }
        if (!unfinished) paused.delete(scope);
      }
      const old = entries.get(key);
      if (old && old.item.status !== 'failed' && old.item.status !== 'cancelled') {
        if (!old.item.groups.includes(group)) old.item.groups.push(group);
        if (!defer) publish(); return old.promise;
      }
      let resolve!: Entry['resolve'];
      const promise = new Promise<DownloadOutcome>((yes) => { resolve = yes; });
      const entry: Entry = { profile: scope, run, promise, resolve, cleanup,
        item: { key, song, status: paused.has(scope) ? 'paused' : 'queued', bytesWritten: 0, bytesTotal: 0, groups: [group] } };
      if (old?.running || old?.interrupting || old?.blocked) {
        const blocked = hold(scope, Promise.all([old.running, old.interrupting, old.blocked]).then(() => {}));
        entry.blocked = blocked;
        void blocked.finally(() => { if (entry.blocked === blocked) entry.blocked = undefined; kick(); });
      }
      entries.set(key, entry); if (!defer) kick(); return promise;
    },
    async pauseAll() { const work = pauseProfile(profile()); publish(); await work; },
    async resumeAll() {
      sync(); const scope = profile();
      if (!scope || !options.allowed()) { publish(); return; }
      paused.delete(scope);
      for (const entry of entries.values()) if (entry.profile === scope) {
        if (entry.item.status === 'failed') {
          entry.promise = new Promise<DownloadOutcome>((resolve) => { entry.resolve = resolve; });
          entry.item.error = undefined; entry.item.status = 'queued'; entry.item.bytesWritten = 0;
        } else if (entry.item.status === 'paused') entry.item.status = 'queued';
      }
      kick();
    },
    async cancelAll() {
      const scope = profile();
      const work = [...entries.values()].filter((entry) => entry.profile === scope).map((entry) => interrupt(entry, true));
      paused.delete(scope); publish(); await Promise.all(work);
    },
    cancelGroup(group: string) {
      const scope = profile();
      for (const entry of entries.values()) if (entry.profile === scope && entry.item.groups.includes(group)) {
        entry.item.groups = entry.item.groups.filter((value) => value !== group);
        if (!entry.item.groups.length) void interrupt(entry, true);
      }
      publish(); kick();
    },
    forget(ids: string[]) {
      const scope = profile();
      for (const id of ids) {
        const key = `${scope}|${id}`, entry = entries.get(key);
        if (entry) {
          const stopping = interrupt(entry, true);
          entry.item.status = 'cancelled'; entry.hidden = true;
          // Keep a non-visible file lease until old commit/cleanup ends. A
          // new download of this ID must wait even after Delete hides its row.
          void Promise.all([entry.running, entry.blocked, stopping]).finally(() => { if (entries.get(key) === entry) entries.delete(key); });
        }
      }
      publish();
    },
    async removeProfile(scope: string) {
      const own = [...entries.values()].filter((entry) => entry.profile === scope);
      await Promise.all(own.map((entry) => interrupt(entry, true)));
      await settle(scope);
      for (const entry of own) if (entries.get(entry.item.key) === entry) entries.delete(entry.item.key);
      paused.delete(scope); publish();
    },
    async drainAndClear(work?: () => Promise<void>) {
      draining = true;
      try {
        const current = [...entries.values()];
        await Promise.all(current.map((entry) => interrupt(entry, true)));
        await settle();
        entries.clear(); paused.clear(); publish();
        await work?.();
      } finally { draining = false; publish(); kick(); }
    },
  };
}
