type ArtworkAccess = {
  cachePath: (key: string) => Promise<string | null>;
  prefetch: (url: string) => Promise<boolean>;
  allowNetwork: () => boolean;
};

function localPath(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^(file|content):/i.test(value)) return value;
  return value.startsWith('/') ? `file://${value}` : undefined;
}

/** Shares Expo Image's cache and never turns the offline-only marker into a download. */
export async function resolveArtworkLocalUri(
  uri: string | undefined,
  cacheOnlyPrefix: string,
  access: ArtworkAccess,
): Promise<string | undefined> {
  if (!uri) return undefined;
  const cacheOnly = uri.startsWith(cacheOnlyPrefix);
  const source = cacheOnly ? uri.slice(cacheOnlyPrefix.length) : uri;
  const local = localPath(source);
  if (local) return local;
  if (!/^https?:\/\//i.test(source)) return undefined;
  const lookup = async (key: string) => {
    try { return localPath(await access.cachePath(key)); }
    catch { return undefined; }
  };
  const exact = await lookup(source);
  if (exact) return exact;
  // Historic and current Cover sizes share artwork but have different cache keys.
  const variants = [...new Set([600, 1200, 200, 500, 300, 100].map((size) =>
    source.replace(/([?&](?:size|fillWidth|fillHeight)=)\d+/g, `$1${size}`),
  ))].filter((key) => key !== source);
  const alternatives = await Promise.all(variants.map(lookup));
  const otherSize = alternatives.find(Boolean);
  if (otherSize) return otherSize;
  // Re-read policy after asynchronous cache work; entering offline must win.
  if (cacheOnly || !access.allowNetwork()) return undefined;
  try { if (!await access.prefetch(source)) return undefined; }
  catch { return undefined; }
  return lookup(source);
}
