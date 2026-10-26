/** Offline artwork lookups shared by rows. No decoded images are retained here. */
export function createCoverPathCache(
  lookup: (url: string) => Promise<string | undefined>,
  { capacity = 512, missTtl = 60_000, now = Date.now } = {},
): (url: string) => Promise<string | undefined> {
  const limit = Math.max(1, Math.floor(capacity) || 512);
  const entries = new Map<string, { path?: string; at: number }>();
  const pending = new Map<string, Promise<string | undefined>>();

  return (url) => {
    const seen = entries.get(url);
    if (seen && (seen.path || now() - seen.at < missTtl)) {
      entries.delete(url);
      entries.set(url, seen);
      return Promise.resolve(seen.path);
    }
    entries.delete(url);
    const inFlight = pending.get(url);
    if (inFlight) return inFlight;

    // Several tracks can share an album. Mounting them together must not issue
    // the same native cache probe (and all its legacy-size fallbacks) per row.
    const request = Promise.resolve().then(() => lookup(url)).then((path) => {
      entries.set(url, { path, at: now() });
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
      return path;
    }).finally(() => {
      if (pending.get(url) === request) pending.delete(url);
    });
    pending.set(url, request);
    return request;
  };
}
