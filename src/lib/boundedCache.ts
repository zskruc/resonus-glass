/** Completed, reconstructible values only; in-flight work keeps separate ownership. */
export class BoundedCache<Key, Value> {
  private readonly entries = new Map<Key, Value>();
  private readonly capacity: number;

  constructor(capacity: number) { this.capacity = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 1; }

  get size(): number { return this.entries.size; }

  get(key: Key): Value | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key)!;
    this.entries.delete(key); this.entries.set(key, value);
    return value;
  }

  set(key: Key, value: Value): void {
    this.entries.delete(key); this.entries.set(key, value);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
}
