/** Profile-owned listening counts; injectable persistence makes account races
 * and failed migrations testable without device data. */
export const MAX_LOCAL_PLAY_COUNTS = 10_000;
const LEGACY = 'resonus.localPlayCounts';
const MIGRATION_OWNER = `${LEGACY}.migrationOwner`;

export function cleanPlayCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(([id, count]) => id.length > 0 && id.length <= 1024
    && !['__proto__', 'prototype', 'constructor'].includes(id)
    && typeof count === 'number' && Number.isSafeInteger(count) && count > 0);
  if (entries.length > MAX_LOCAL_PLAY_COUNTS) entries.sort((a, b) => Number(b[1]) - Number(a[1]));
  return Object.fromEntries(entries.slice(0, MAX_LOCAL_PLAY_COUNTS)) as Record<string, number>;
}
const parse = (raw: string | null) => raw === null ? {} : cleanPlayCounts(JSON.parse(raw));
interface Options {
  read: (key: string) => Promise<string | null>;
  write: (key: string, value: string) => Promise<void>;
  currentProfile: () => string;
  publish: (counts: Record<string, number>, hydrated: boolean) => void;
  delay?: number;
}
export function createProfilePlayCounts(options: Options) {
  let generation = 0;
  let profile: string | null = null;
  let loaded = false;
  let counts: Record<string, number> = {}, deltas: Record<string, number> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  type Save = { counts: Record<string, number>; version: number };
  const pending = new Map<string, Save>();
  const latestVersion = new Map<string, number>();
  let revision = 0;
  const keyOf = (scope: string) => `${LEGACY}.${scope}`;
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const job = tail.then(work); tail = job.catch(() => {}); return job;
  };
  function save() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const snapshots = [...pending]; pending.clear();
    return serialize(async () => {
      for (const [scope, snapshot] of snapshots) {
        try { await options.write(keyOf(scope), JSON.stringify(snapshot.counts)); }
        catch {
          // A newer snapshot may already have been dequeued into a second
          // flush. Map presence alone cannot decide which failure is current.
          if (latestVersion.get(scope) === snapshot.version && !pending.has(scope)) pending.set(scope, snapshot);
        }
      }
    });
  }
  function schedule() {
    if (!loaded || !profile || profile === 'default') return;
    const version = ++revision;
    latestVersion.set(profile, version);
    pending.set(profile, { counts, version });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void save(); }, options.delay ?? 1000);
  }
  async function hydrate(scope: string) {
    const ticket = ++generation;
    profile = scope; loaded = false; counts = {}; deltas = {};
    options.publish(counts, false);
    const current = () => ticket === generation && options.currentProfile() === scope;
    await save();
    return serialize(async () => {
      try {
        const key = keyOf(scope);
        const raw = pending.has(scope) ? JSON.stringify(pending.get(scope)!.counts) : await options.read(key);
        if (!current()) return;
        let saved = parse(raw);
        if (raw === null && scope !== 'default') {
          const inheritedBy = await options.read(MIGRATION_OWNER);
          if (!current()) return;
          if (inheritedBy === null || inheritedBy === scope) {
            const legacyRaw = await options.read(LEGACY);
            if (!current()) return;
            if (legacyRaw !== null) {
              saved = parse(legacyRaw);
              // Claim before copying so overlapping hydrations cannot both
              // inherit the shared history. All writes here must be strict.
              await options.write(MIGRATION_OWNER, scope);
              if (!current()) return;
              await options.write(key, JSON.stringify(saved));
              if (await options.read(key) !== JSON.stringify(saved)) throw new Error('Play count migration was not persisted');
              // Retain the legacy value as a recovery copy, never import it
              // into a second profile after the durable claim above.
            }
          }
        }
        if (!current()) return;
        const merged = { ...saved };
        for (const [id, delta] of Object.entries(deltas)) merged[id] = Math.min(Number.MAX_SAFE_INTEGER, (merged[id] ?? 0) + delta);
        counts = cleanPlayCounts(merged); loaded = true;
        const dirty = Object.keys(deltas).length > 0; deltas = {};
        options.publish(counts, true);
        if (dirty) schedule();
      } catch {
        // A failed read must never produce an empty replacement on next play.
        if (current()) options.publish({}, true);
      }
    });
  }
  function bump(scope: string, id: string) {
    if (scope === 'default' || options.currentProfile() !== scope || profile !== scope
      || !id || id.length > 1024 || ['__proto__', 'prototype', 'constructor'].includes(id)) return;
    if (!loaded) { deltas = cleanPlayCounts({ ...deltas, [id]: (deltas[id] ?? 0) + 1 }); return; }
    counts = cleanPlayCounts({ ...counts, [id]: Math.min(Number.MAX_SAFE_INTEGER, (counts[id] ?? 0) + 1) });
    options.publish(counts, true); schedule();
  }
  return { hydrate, bump, flush: save };
}
