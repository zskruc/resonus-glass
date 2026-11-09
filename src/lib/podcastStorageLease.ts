/** Tiny, synchronous ownership registry shared by routes, feeds and storage.
 * It owns no files or timers and does not import the player/download stores. */
const active = new Map<string, Map<string, number>>();
let revision = 0;

export function protectPodcastStorageChannel(scope: string, channelId: string): () => void {
  if (!scope || !channelId) return () => {};
  let channels = active.get(scope);
  if (!channels) active.set(scope, channels = new Map());
  channels.set(channelId, (channels.get(channelId) ?? 0) + 1); revision++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const count = channels.get(channelId) ?? 0;
    if (count > 1) channels.set(channelId, count - 1);
    else channels.delete(channelId);
    if (!channels.size && active.get(scope) === channels) active.delete(scope);
    revision++;
  };
}

export function protectedPodcastStorageChannels(scope: string): Set<string> {
  return new Set(active.get(scope)?.keys());
}

/** Global monotonic generations also reject acquire→release round trips. */
export function podcastStorageLeaseVersion(_scope?: string): number {
  return revision;
}
