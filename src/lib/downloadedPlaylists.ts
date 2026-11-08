import type { Playlist } from '@/api/subsonic';

/** Only complete, known tracklists count; missing/empty lists never prove a download. */
export function completeDownloadedPlaylists(
  tracklists: ReadonlyMap<string, readonly string[]>,
  files: Readonly<Record<string, unknown>>,
  summaries: readonly Playlist[],
  versions: Readonly<Record<string, string | undefined>>,
  edits: Readonly<Record<string, { songIds?: readonly string[]; deleted?: boolean }>>,
): Set<string> {
  const metadata = new Map(summaries.map((playlist) => [playlist.id, playlist]));
  const lists = new Map(tracklists);
  for (const [id, edit] of Object.entries(edits)) {
    if (edit.deleted) lists.delete(id);
    else if (edit.songIds) lists.set(id, edit.songIds);
  }
  const complete = new Set<string>();
  for (const [id, songIds] of lists) {
    const playlist = metadata.get(id), edit = edits[id];
    if (songIds.length === 0 || edit?.deleted) continue;
    // An online summary knows the list has changed: do not badge the old copy.
    if (!edit?.songIds && playlist && (
      (playlist.songCount != null && playlist.songCount !== songIds.length)
      || (playlist.changed && playlist.changed !== versions[id])
    )) continue;
    if (songIds.every((songId) => !!files[songId])) complete.add(id);
  }
  return complete;
}
