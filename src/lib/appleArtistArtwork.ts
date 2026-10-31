/**
 * Optional metadata from Apple's public artist pages. No MusicKit token,
 * account API, script evaluation or change to the displayed photograph.
 * A name finds candidates; only the current photograph's asset UUID verifies
 * a result. Opaque server/local image URLs deliberately keep the local palette.
 */
export interface AppleArtistNameArtwork {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface AppleArtistArtwork {
  readonly artistId: string;
  readonly artistName: string;
  readonly assetKey: string;
  /** Raw Apple Artwork.bgColor, before the artist page's contrast treatment. */
  readonly backgroundColor: string;
  readonly heroUrl: string;
  readonly heroUrlTemplate: string;
  readonly width: number;
  readonly height: number;
  readonly cropStyle?: string;
  readonly recommendedCropCodes: readonly string[];
  readonly wideCropStyle?: string;
  /** Only the verified artist header's optional official title graphic. */
  readonly nameArtwork?: AppleArtistNameArtwork;
}

type JsonRecord = Record<string, unknown>;
type Fetcher = (url: string, options: RequestInit) => Promise<Response>;
interface ResolverOptions {
  fetch?: Fetcher;
  now?: () => number;
  timeoutMs?: number;
  capacity?: number;
  maxPending?: number;
}
export interface AppleArtistPhotoCandidate {
  readonly uri: string;
  readonly assetKey: string;
  readonly width: number;
  readonly height: number;
}
export interface AppleArtistPhotoVerification {
  readonly sourceFingerprint: string;
  readonly verify: (candidate: AppleArtistPhotoCandidate, mayContinue: () => boolean) => Promise<boolean>;
}
interface RequestKey { name: string; asset: string | null; key: string; cacheOnly: boolean }
const MAX_BODY = 1_000_000;
const SUCCESS_TTL = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL = 5 * 60 * 1000;
const CACHE_ONLY = 'cached-cover:';

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function imageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && /(?:^|\.)mzstatic\.com$/i.test(url.hostname) ? url : null;
  } catch { return null; }
}

/** Resize/crop filenames and query parameters do not identify a photograph. */
export function appleArtworkAssetKey(uri?: string): string | null {
  if (!uri || uri.length > 8192) return null;
  const source = uri.startsWith(CACHE_ONLY) ? uri.slice(CACHE_ONLY.length) : uri;
  const url = imageUrl(source);
  if (!url || !url.pathname.startsWith('/image/')) return null;
  return url.pathname.match(/(?:^|\/)([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:\/|$)/i)?.[1].toLowerCase() ?? null;
}

function requestKey(uri?: string, artistName?: string, sourceFingerprint?: string): RequestKey | null {
  const name = artistName?.normalize('NFKC').trim();
  const asset = appleArtworkAssetKey(uri);
  const fingerprint = typeof sourceFingerprint === 'string' && /^[\da-f]{1536}$/i.test(sourceFingerprint)
    ? sourceFingerprint.toLowerCase() : undefined;
  if (!uri || !name || name.length > 160 || !asset && !fingerprint) return null;
  return { name, asset, key: JSON.stringify([name.toLowerCase(), asset ?? `fingerprint:${fingerprint}`]), cacheOnly: uri.startsWith(CACHE_ONLY) };
}

function artwork(value: unknown): { dictionary: JsonRecord; cropStyle?: string } | null {
  const source = record(value);
  const dictionary = record(source?.dictionary);
  if (!dictionary) return null;
  const cropStyle = typeof source?.cropStyle === 'string' && /^[a-z]{2}$/i.test(source.cropStyle)
    ? source.cropStyle : undefined;
  return { dictionary, cropStyle };
}

function assetFromTemplate(template: unknown): string | null {
  if (typeof template !== 'string') return null;
  return appleArtworkAssetKey(template.replaceAll('{w}', '600').replaceAll('{h}', '600')
    .replaceAll('{c}', 'bb').replaceAll('{f}', 'jpg'));
}

function artistNameArtwork(value: unknown): AppleArtistNameArtwork | undefined {
  const dictionary = artwork(value)?.dictionary;
  if (!dictionary || typeof dictionary.url !== 'string' || dictionary.url.length > 4096
    || typeof dictionary.width !== 'number' || typeof dictionary.height !== 'number'
    || !Number.isInteger(dictionary.width) || !Number.isInteger(dictionary.height)
    || dictionary.width <= 0 || dictionary.height <= 0 || dictionary.width > 30_000 || dictionary.height > 30_000) return;
  const { width, height } = dictionary;
  const ratio = Math.min(1, 1000 / width, 400 / height);
  const uri = dictionary.url.replaceAll('{w}', String(Math.max(1, Math.round(width * ratio))))
    .replaceAll('{h}', String(Math.max(1, Math.round(height * ratio))))
    .replaceAll('{c}', 'bb').replaceAll('{f}', 'png');
  if (!imageUrl(uri) || /[{}]/.test(uri) || new URL(uri).hash || !new URL(uri).pathname.endsWith('.png')) return;
  return Object.freeze({ uri, width, height });
}

/** Unverified candidates stay private until URL identity or local-photo comparison accepts them. */
function artistArtworkCandidates(html: string, artistId: string, currentAsset?: string): AppleArtistArtwork[] {
  if (!/^\d{1,20}$/.test(artistId) || html.length > MAX_BODY) return [];
  const body = html.match(/<script\b(?=[^>]*\bid\s*=\s*["']serialized-server-data["'])[^>]*>([\s\S]*?)<\/script\s*>/i)?.[1];
  if (!body) return [];
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return []; }
  const packages = record(payload)?.data;
  if (!Array.isArray(packages)) return [];
  for (const entry of packages.slice(0, 4)) {
    const sections = record(record(entry)?.data)?.sections;
    if (!Array.isArray(sections)) continue;
    for (const section of sections.slice(0, 64)) {
      const shelf = record(section);
      if (typeof shelf?.id !== 'string' || !shelf.id.includes('ArtistDetailHeader') || !Array.isArray(shelf.items)) continue;
      for (const value of shelf.items.slice(0, 8)) {
        const item = record(value);
        const descriptor = record(item?.contentDescriptor);
        if (item?.id !== artistId || descriptor?.kind !== 'artist'
          || String(record(descriptor.identifiers)?.storeAdamID) !== artistId) continue;
        const primary = artwork(item.artwork);
        const backdrop = artwork(item.colorBackdropArtwork);
        const candidates: AppleArtistArtwork[] = [];
        // The backdrop can be absent or have another asset. Only use a color
        // whose own dictionary matches the exact displayed image.
        for (const candidate of [backdrop, primary]) {
          if (!candidate) continue;
          const { dictionary, cropStyle } = candidate;
          const template = dictionary.url;
          const raw = dictionary.bgColor;
          const width = dictionary.width;
          const height = dictionary.height;
          const asset = assetFromTemplate(template);
          if (!asset || currentAsset && asset !== currentAsset || candidates.some((art) => art.assetKey === asset) || typeof template !== 'string'
            || typeof raw !== 'string' || !/^[\da-f]{6}$/i.test(raw)
            || typeof width !== 'number' || typeof height !== 'number'
            || !Number.isInteger(width) || !Number.isInteger(height)
            || width <= 0 || height <= 0 || width > 30_000 || height > 30_000) continue;
          // The two verified public artist headers request square `sr` art.
          // Keep other crop codes conservative; a wide hero is not a portrait.
          const heroCrop = cropStyle === 'sr' ? 'sr' : 'bb';
          const ratio = Math.min(1, 1080 / Math.max(width, height));
          const heroUrl = template.replaceAll('{w}', String(Math.max(1, Math.round(width * ratio))))
            .replaceAll('{h}', String(Math.max(1, Math.round(height * ratio))))
            .replaceAll('{c}', heroCrop).replaceAll('{f}', 'jpg');
          if (!imageUrl(heroUrl) || /[{}]/.test(heroUrl)) continue;
          const wide = artwork(item.wideArtwork);
          const codes = Array.isArray(dictionary.recommendedCropCodes)
            ? dictionary.recommendedCropCodes.filter((code): code is string => typeof code === 'string' && /^[a-z]{2}$/i.test(code)).slice(0, 12) : [];
          candidates.push(Object.freeze({ artistId, artistName: typeof item.title === 'string' ? item.title : '',
            assetKey: asset, backgroundColor: `#${raw.toLowerCase()}`, heroUrl, heroUrlTemplate: template,
            width, height, cropStyle, recommendedCropCodes: Object.freeze(codes),
            wideCropStyle: wide && assetFromTemplate(wide.dictionary.url) === currentAsset ? wide.cropStyle : undefined,
            nameArtwork: artistNameArtwork(item.artistLogo) }));
        }
        return candidates;
      }
    }
  }
  return [];
}

/** Parse only the artist detail header, never an album's or related artist's color. */
export function parseAppleArtistArtwork(html: string, artistId: string, currentImageUri: string): AppleArtistArtwork | null {
  const asset = appleArtworkAssetKey(currentImageUri);
  return asset ? artistArtworkCandidates(html, artistId, asset)[0] ?? null : null;
}

export function createAppleArtistArtworkResolver(options: ResolverOptions = {}) {
  const fetcher: Fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const limit = (value: number | undefined, maximum: number) =>
    value !== undefined && Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value))) : maximum;
  const capacity = limit(options.capacity, 64);
  const maxPending = limit(options.maxPending, 4);
  const timeoutMs = limit(options.timeoutMs, 6000);
  const cache = new Map<string, { value: AppleArtistArtwork | null; expires: number }>();
  const pending = new Map<string, Promise<AppleArtistArtwork | null>>();

  function cached(key: string) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    cache.delete(key);
    if (entry.expires <= now()) return undefined;
    cache.set(key, entry);
    return entry;
  }
  function remember(key: string, value: AppleArtistArtwork | null) {
    cache.delete(key);
    cache.set(key, { value, expires: now() + (value ? SUCCESS_TTL : FAILURE_TTL) });
    while (cache.size > capacity) cache.delete(cache.keys().next().value!);
  }
  function peek(uri?: string, artistName?: string, sourceFingerprint?: string): AppleArtistArtwork | null {
    const key = requestKey(uri, artistName, sourceFingerprint);
    return key ? cached(key.key)?.value ?? null : null;
  }
  async function resolve(uri?: string, artistName?: string, offline = false, allowNetwork: () => boolean = () => true,
    verification?: AppleArtistPhotoVerification): Promise<AppleArtistArtwork | null> {
    const key = requestKey(uri, artistName, verification?.sourceFingerprint);
    if (!key) return null;
    const previous = cached(key.key);
    if (previous) return previous.value;
    const permitted = () => {
      try { return !offline && !key.cacheOnly && allowNetwork(); } catch { return false; }
    };
    if (!permitted()) return null;
    const existing = pending.get(key.key);
    if (existing) return existing.then((value) => permitted() ? value : null);
    if (pending.size >= maxPending) return null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function text(url: string, kind: 'json' | 'html'): Promise<string | null> {
      if (!permitted() || controller.signal.aborted) return null;
      const response = await fetcher(url, { method: 'GET', credentials: 'omit', signal: controller.signal,
        headers: { Accept: kind === 'json' ? 'application/json' : 'text/html' } });
      if (!permitted() || controller.signal.aborted || !response.ok) return null;
      if (response.url && new URL(response.url).hostname !== new URL(url).hostname) return null;
      const length = Number(response.headers?.get('content-length'));
      if (Number.isFinite(length) && length > MAX_BODY) return null;
      const body = await response.text();
      return permitted() && !controller.signal.aborted && body.length <= MAX_BODY ? body : null;
    }
    async function load(): Promise<AppleArtistArtwork | null> {
      const search = await text(`https://itunes.apple.com/search?term=${encodeURIComponent(key!.name)}&entity=musicArtist&country=CN&limit=5`, 'json');
      if (!search) return null;
      let parsed: unknown;
      try { parsed = JSON.parse(search); } catch { return null; }
      const results = record(parsed)?.results;
      if (!Array.isArray(results)) return null;
      const seen = new Set<number>();
      const candidates = results.slice(0, 5).filter((value) => {
        const item = record(value);
        if (item?.wrapperType !== 'artist' || item.artistType !== 'Artist'
          || typeof item.artistId !== 'number' || !Number.isSafeInteger(item.artistId) || item.artistId <= 0
          || seen.has(item.artistId)) return false;
        seen.add(item.artistId);
        return true;
      }).slice(0, 3);
      let photoChecks = 0;
      for (const candidate of candidates) {
        const id = String(record(candidate)!.artistId);
        const html = await text(`https://music.apple.com/cn/artist/${id}`, 'html');
        if (!html) { if (!permitted() || controller.signal.aborted) return null; continue; }
        if (key!.asset) {
          const result = parseAppleArtistArtwork(html, id, uri!);
          if (result) return result;
        } else if (verification) {
          // A name discovers candidates only. Opaque server photos require a
          // successful comparison of the exact locally displayed photograph.
          for (const art of artistArtworkCandidates(html, id)) {
            if (!permitted() || controller.signal.aborted || photoChecks++ >= 3) return null;
            const ratio = Math.min(1, 600 / Math.max(art.width, art.height));
            const width = Math.max(1, Math.round(art.width * ratio));
            const height = Math.max(1, Math.round(art.height * ratio));
            const uri = art.heroUrlTemplate.replaceAll('{w}', String(width)).replaceAll('{h}', String(height))
              .replaceAll('{c}', 'bb').replaceAll('{f}', 'jpg');
            if (await verification.verify({ uri, assetKey: art.assetKey, width, height },
              () => permitted() && !controller.signal.aborted)) {
              if (permitted() && !controller.signal.aborted) return art;
              return null;
            }
          }
        }
      }
      return null;
    }
    const timeout = new Promise<null>((done) => {
      timer = setTimeout(() => { controller.abort(); done(null); }, timeoutMs);
    });
    const request = Promise.race([load().catch(() => null), timeout]).then((value) => {
      // Going offline during a lookup must not create a cached failed match.
      if (!permitted()) return null;
      remember(key.key, value);
      return value;
    }).finally(() => {
      clearTimeout(timer);
      if (pending.get(key.key) === request) pending.delete(key.key);
    });
    pending.set(key.key, request);
    return request;
  }
  return { resolve, peek, get cacheSize() { return cache.size; }, get pendingCount() { return pending.size; } };
}

const publicArtistArtwork = createAppleArtistArtworkResolver();
export const getCachedAppleArtistArtwork = publicArtistArtwork.peek;
export const resolveAppleArtistArtwork = publicArtistArtwork.resolve;
