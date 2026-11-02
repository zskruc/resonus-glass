/** Local artwork identity and the resolution known to have been saved. */
export function createCoverIndex() {
  const entries = new Map<string, { uri: string; size: number }>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (id: string) => listeners.get(id)?.forEach((listener) => listener());
  const replace = (id: string, uri?: string, size = 0) => {
    if (!uri) return;
    const previous = entries.get(id);
    if (previous?.uri === uri && previous.size === size) return;
    entries.set(id, { uri, size });
    notify(id);
  };
  return {
    register(id: string, uri?: string, size = 0) {
      if (!entries.has(id)) replace(id, uri, size);
    },
    replace,
    forget(id: string) {
      if (entries.delete(id)) notify(id);
    },
    clear() {
      const ids = [...entries.keys()];
      entries.clear();
      for (const id of ids) notify(id);
    },
    uri(id: string | undefined): string | undefined {
      if (!id) return undefined;
      if (/^(file|content):/i.test(id)) return id;
      return entries.get(id)?.uri;
    },
    size(id: string | undefined): number {
      return id ? entries.get(id)?.size ?? 0 : 0;
    },
    subscribe(id: string | undefined, listener: () => void): () => void {
      if (!id) return () => {};
      let group = listeners.get(id);
      if (!group) listeners.set(id, group = new Set());
      group.add(listener);
      return () => {
        group.delete(listener);
        if (!group.size && listeners.get(id) === group) listeners.delete(id);
      };
    },
  };
}
