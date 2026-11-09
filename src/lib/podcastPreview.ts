/** Short-lived public directory handoff. Never persists feeds, account data or subscriptions. */
import { normalizePodcastDirectoryCountry, type PodcastDirectoryShow } from '@/lib/podcastDirectory';
import { profileScopeId, useAuthStore } from '@/store/auth';

const CAPACITY = 8;
const TTL_MS = 10 * 60_000;
let sequence = 0, epoch = 0, subscribed = false;
const entries = new Map<string, { seed: PodcastPreviewSeed; createdAt: number }>();

export interface PodcastPreviewHandle { readonly id: string; readonly token: string }
export interface PodcastPreviewSeed extends PodcastPreviewHandle {
  readonly show: Readonly<PodcastDirectoryShow>;
  readonly country: string;
  readonly profile: string;
  /** The same handoff, account generation and bounded lifetime must still own work. */
  current(): boolean;
}

function watchOwner() {
  if (subscribed) return;
  subscribed = true;
  let scope = profileScopeId();
  useAuthStore.subscribe((next, before) => {
    const nextScope = profileScopeId();
    if (next.auth !== before.auth || nextScope !== scope
      || !next.auth && next.offlineSource !== before.offlineSource) {
      epoch++;
      entries.clear();
    }
    scope = nextScope;
  });
}
function expired(createdAt: number, now: number) { return now < createdAt || now - createdAt >= TTL_MS; }
function prune(now: number) {
  for (const [token, value] of entries) if (expired(value.createdAt, now)) entries.delete(token);
}
function text(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' ? value.trim().slice(0, limit) || undefined : undefined;
}
function publicUrl(value: unknown): string | undefined {
  const candidate = text(value, 4096);
  if (!candidate) return;
  try {
    const url = new URL(candidate);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return candidate;
  } catch { /* Directory metadata is optional; invalid URLs do not enter the handoff. */ }
}
function snapshot(show: PodcastDirectoryShow): Readonly<PodcastDirectoryShow> {
  if (!Number.isSafeInteger(show.id) || show.id <= 0) throw new Error('Invalid podcast preview ID');
  const clean: PodcastDirectoryShow = { id: show.id, title: text(show.title, 500) ?? '' };
  const author = text(show.author, 250), summary = text(show.summary, 4000), genre = text(show.genre, 100);
  const imageUrl = publicUrl(show.imageUrl), feedUrl = publicUrl(show.feedUrl);
  if (author) clean.author = author;
  if (summary) clean.summary = summary;
  if (genre) clean.genre = genre;
  if (imageUrl) clean.imageUrl = imageUrl;
  if (feedUrl) clean.feedUrl = feedUrl;
  if (typeof show.episodeCount === 'number' && Number.isSafeInteger(show.episodeCount) && show.episodeCount >= 0) clean.episodeCount = show.episodeCount;
  if (typeof show.latestReleaseAt === 'number' && Number.isFinite(show.latestReleaseAt) && show.latestReleaseAt >= 0 && show.latestReleaseAt <= 8.64e15) clean.latestReleaseAt = show.latestReleaseAt;
  if (typeof show.rank === 'number' && Number.isSafeInteger(show.rank) && show.rank > 0) clean.rank = show.rank;
  return Object.freeze(clean);
}

/** Synchronous: navigation never waits for lookup, SQLite, RSS, artwork or subscription. */
export function beginPodcastPreview(show: PodcastDirectoryShow, country = 'us'): PodcastPreviewHandle {
  watchOwner();
  const metadata = snapshot(show), now = Date.now();
  prune(now);
  const profile = profileScopeId(), auth = useAuthStore.getState().auth, ownerEpoch = epoch;
  const id = `preview-${metadata.id}`, token = `podcast-preview-${now.toString(36)}-${(++sequence).toString(36)}`;
  const seed: PodcastPreviewSeed = Object.freeze({ id, token, profile, show: metadata,
    country: normalizePodcastDirectoryCountry(country),
    current: () => epoch === ownerEpoch && profileScopeId() === profile && useAuthStore.getState().auth === auth
      && entries.get(token)?.seed === seed && !expired(now, Date.now()),
  });
  entries.set(token, { seed, createdAt: now });
  while (entries.size > CAPACITY) entries.delete(entries.keys().next().value!);
  return { id, token };
}

/** Repeated reads survive StrictMode effect cleanup; expiration is not extended. */
export function readPodcastPreview(token: unknown): PodcastPreviewSeed | undefined {
  watchOwner();
  prune(Date.now());
  if (typeof token !== 'string') return;
  const value = entries.get(token);
  if (!value?.seed.current()) return;
  entries.delete(token); entries.set(token, value);
  return value.seed;
}

/** Explicit dismissal/navigation failure only; do not call from the first effect cleanup. */
export function disposePodcastPreview(token: unknown): void {
  if (typeof token === 'string') entries.delete(token);
}
