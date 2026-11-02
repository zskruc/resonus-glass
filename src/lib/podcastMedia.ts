/** Filename extensions are hints, never trusted URL text or path fragments. */
export function podcastUrlExtension(url: string, fallback = 'audio'): string {
  try {
    const extension = new URL(url).pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
    return extension ?? fallback;
  } catch { return fallback; }
}
