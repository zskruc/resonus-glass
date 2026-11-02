/** A reorder is a permutation of occurrences, never an add/remove operation. */
export function samePlaylistSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
export function isPlaylistPermutation(original: readonly string[], next: readonly string[]): boolean {
  if (original.length !== next.length) return false;
  const counts = new Map<string, number>();
  for (const id of original) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of next) {
    const remaining = counts.get(id) ?? 0;
    if (remaining === 0) return false;
    counts.set(id, remaining - 1);
  }
  return true;
}

/** A deletion preserves the relative order and multiplicity of what remains. */
export function isPlaylistRemoval(original: readonly string[], next: readonly string[]): boolean {
  let cursor = 0;
  for (const id of original) if (cursor < next.length && next[cursor] === id) cursor++;
  return cursor === next.length;
}
