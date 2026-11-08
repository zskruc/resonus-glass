export interface SettingsSearchEntry {
  id: string;
  route: string;
  title: string;
  chinese: string;
  section: string;
  anchor?: string;
  aliases?: string[];
}

/** Tone marks, full-width letters and spaced pinyin resolve to the same term. */
export function normalizeSettingsQuery(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}
export function searchSettings(entries: readonly SettingsSearchEntry[], text: string): SettingsSearchEntry[] {
  const query = normalizeSettingsQuery(text);
  const tokens = text.trim().split(/\s+/).map(normalizeSettingsQuery).filter(Boolean);
  if (!query) return [];
  return entries.map((entry, order) => {
    const names = [entry.title, entry.chinese].map(normalizeSettingsQuery);
    const other = [entry.section, ...(entry.aliases ?? [])].map(normalizeSettingsQuery);
    const score = names.includes(query) ? 0 : names.some((name) => name.startsWith(query)) ? 1
      : names.some((name) => name.includes(query)) ? 2 : other.some((name) => name.includes(query)) ? 3
      : tokens.length > 1 && tokens.every((token) => [...names, ...other].some((name) => name.includes(token))) ? 4 : 99;
    return { entry, score, order };
  }).filter((item) => item.score < 99).sort((a, b) => a.score - b.score || a.order - b.order).map((item) => item.entry);
}

export function settingsRecentIds(value: unknown, valid: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && valid.has(id)))].slice(0, 5);
}
/** Serialized per account; a late save always writes the account which clicked it. */
export function createSettingsSearchHistory(io: { read: (key: string) => Promise<string | null>; write: (key: string, text: string) => Promise<void> }, valid: ReadonlySet<string>) {
  const writes = new Map<string, Promise<unknown>>();
  const load = async (key: string) => {
    await writes.get(key)?.catch(() => {});
    const raw = await io.read(key);
    if (!raw) return [];
    try { return settingsRecentIds(JSON.parse(raw), valid); } catch { return []; }
  };
  return { load,
    add(key: string, id: string) {
      if (!valid.has(id)) return Promise.reject(new Error('Unknown settings search result'));
      const before = writes.get(key) ?? Promise.resolve();
      const work = before.catch(() => {}).then(async () => {
        const raw = await io.read(key);
        let saved: unknown = [];
        if (raw) try { saved = JSON.parse(raw); } catch { /* Corrupt history is replaceable; settings themselves are untouched. */ }
        await io.write(key, JSON.stringify([id, ...settingsRecentIds(saved, valid).filter((item) => item !== id)].slice(0, 5)));
      });
      writes.set(key, work);
      void work.finally(() => { if (writes.get(key) === work) writes.delete(key); }).catch(() => {});
      return work;
    },
    clear(key: string) {
      const before = writes.get(key) ?? Promise.resolve();
      const work = before.catch(() => {}).then(() => io.write(key, '[]'));
      writes.set(key, work);
      void work.finally(() => { if (writes.get(key) === work) writes.delete(key); }).catch(() => {});
      return work;
    },
  };
}

export function settingScrollOffset(contentY: number): number { return Number.isFinite(contentY) ? Math.max(0, contentY - 18) : 0; }
