/**
 * Podcasts, kept on the phone and read from their own feeds.
 *
 * Navidrome answers the Subsonic podcast endpoints with 501, and Jellyfin and
 * Ampache have none, so no server is asked. Subscriptions are filed per
 * profile (`profileScopeId()`) and `lib/profileData.ts` deletes them with it.
 * An episode plays as a `Song` whose `url` is the enclosure, like radio.
 */
import { fetch } from 'expo/fetch';

import { assertCanRequest, isManualOffline, OfflineError } from './netGate';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { usePodcastDownloads } from '@/store/podcastDownloads';
import { usePlayerStore } from '@/store/player';
import { markPodcastPlayed } from '@/lib/podcastProgress';

import { episodePlayed } from '@/lib/episodeResume';
import { hashKey } from '@/lib/localLibrary';
import { queryClient } from '@/lib/query';
import * as Db from '@/lib/podcastDb';
import type { RecentEpisode } from '@/lib/podcastDb';
import { parseFeedAsync, sortEpisodes, type ParsedItem } from '@/lib/podcastFeed';
import { decodePodcastDirectoryChart, decodePodcastDirectorySearch, podcastAppleDirectoryId,
  podcastDirectoryChartUrl, podcastDirectoryLookupUrl, podcastDirectorySearchUrl,
  PodcastDirectoryError, type PodcastDirectoryShow } from '@/lib/podcastDirectory';
import type { PodcastChannel, PodcastEpisode, Song } from './subsonic';

export type { PodcastChannel, PodcastEpisode } from './subsonic';
export type { RecentEpisode } from '@/lib/podcastDb';
export type { PodcastEpisodePage, PodcastEpisodePageOptions } from '@/lib/podcastDb';
export type { PodcastDirectoryShow } from '@/lib/podcastDirectory';

/**
 * Why a feed read failed, as a stable code rather than a message. It is what
 * gets filed on the channel row, so the reason survives to be read back offline,
 * and so the surfaces that show it can split "you're offline" from "the feed
 * itself was bad" without sniffing at somebody's error text.
 */
type FeedCode = 'offline' | 'notFeed' | 'http' | 'stopped';

class FeedError extends Error {
  code: FeedCode;
  constructor(code: FeedCode) {
    super();
    this.code = code;
  }
}

/** Legacy add-sheet limits, retained for callers that need ready-to-subscribe feeds. */
const SEARCH_LIMIT = 25;
const CHART_LIMIT = 100;

/** Wide on purpose: a pasted address is often the show's HTML page. */
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, text/xml, */*';

export interface PodcastSearchResult {
  feedUrl: string;
  title: string;
  author?: string;
  imageUrl?: string;
}

const TIMEOUT_MS = 20_000;
const AUTO_DOWNLOAD_EPISODES = 3;
const AUTO_DOWNLOAD_READ_MS = 1000 * 60 * 60 * 6;

function scope(): string {
  return hashKey(profileScopeId());
}

type RequestOwner = ReturnType<typeof requestOwner>;
export interface PodcastOperationOptions {
  signal?: AbortSignal;
  current?: () => boolean;
  expectedProfile?: string;
}
const pendingReads = new Set<{ auth: unknown; profile: string; controller: AbortController }>();
let accountEpoch = 0;
function requestOwner(options: PodcastOperationOptions = {}) {
  const auth = useAuthStore.getState().auth, profile = profileScopeId();
  const epoch = accountEpoch;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const ticket = { auth, profile, controller }; pendingReads.add(ticket);
  const current = () => !controller.signal.aborted && epoch === accountEpoch
    && auth === useAuthStore.getState().auth && profile === profileScopeId()
    && (options.expectedProfile === undefined || profile === options.expectedProfile)
    && (!options.current || options.current());
  return { scope: hashKey(profile), epoch, signal: controller.signal, current,
    check() { if (!current()) throw new FeedError('stopped'); },
    dispose() { pendingReads.delete(ticket); options.signal?.removeEventListener('abort', abort); },
  };
}
useAuthStore.subscribe((state, previous) => {
  if (state.auth !== previous.auth || !state.auth && state.offline !== previous.offline) accountEpoch++;
  if (state.auth === previous.auth && state.offline === previous.offline && state.autoOffline === previous.autoOffline) return;
  for (const read of pendingReads) if (read.auth !== state.auth || read.profile !== profileScopeId() || isManualOffline()) read.controller.abort();
});

/**
 * A read of one address: the text that landed, the address it landed on (a page
 * hops), and the validators the publisher offered to make the next read cheap.
 * `notModified` says the publisher answered "unchanged" — there is no body, and
 * what is stored is still what it lists.
 */
interface FeedRead {
  url: string;
  body: string;
  etag?: string;
  lastModified?: string;
  notModified?: boolean;
}

/** The validators of the row under this exact address, sent back as they came. */
interface FeedValidators {
  etag?: string;
  lastModified?: string;
}

async function get(url: string, accept: string, since?: FeedValidators, existingOwner?: RequestOwner): Promise<FeedRead> {
  if (!/^https?:\/\//i.test(url)) throw new FeedError('notFeed');
  // Podcast hosts are nobody's server: the publisher's feed and the iTunes
  // directory are as reachable when the app fell offline because the server
  // stopped answering as when it did not. Only a manual "use no network" says
  // no — the same split `netGate` draws for LRCLIB.
  const ctl = new AbortController();
  const owner = existingOwner ?? requestOwner();
  const abort = () => ctl.abort(); owner.signal.addEventListener('abort', abort, { once: true });
  const check = () => { owner.check(); if (ctl.signal.aborted) throw new FeedError('http'); };
  let rejectStop!: (error: FeedError) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const stop = () => rejectStop(new FeedError(owner.current() ? 'http' : 'stopped'));
  ctl.signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const work = async (): Promise<FeedRead> => {
    check();
    assertCanRequest(!isManualOffline());
    const res = await fetch(url, {
      headers: {
        accept,
        'user-agent': 'Resonus',
        // One validator only: a server handed both would answer 412 to a feed
        // whose etag moved but whose date did not, and that is a lost show.
        ...(since?.etag ? { 'if-none-match': since.etag } : {}),
        ...(since && !since.etag && since.lastModified ? { 'if-modified-since': since.lastModified } : {}),
      },
      signal: ctl.signal,
    });
    check();
    // Before `ok`: 304 is not a success code, and it is exactly the cheap
    // answer a conditional read exists to get — no body, nothing to parse.
    if (res.status === 304) return { url, body: '', notModified: true };
    if (!res.ok) throw new FeedError('http');
    const etag = res.headers.get('etag');
    const modified = res.headers.get('last-modified');
    const body = await res.text(); check();
    return {
      url,
      body,
      ...(etag ? { etag } : {}),
      ...(modified ? { lastModified: modified } : {}),
    };
  };
  try {
    // Native response-body reads may ignore AbortSignal. The caller still
    // settles on time/cancel; the late work checks its ticket before returning.
    return await Promise.race([work(), stopped]);
  } catch (e) {
    owner.check();
    if (e instanceof OfflineError) throw new FeedError('offline');
    if (e instanceof FeedError) throw e;
    throw new FeedError('http');
  } finally {
    clearTimeout(timer);
    ctl.signal.removeEventListener('abort', stop);
    owner.signal.removeEventListener('abort', abort);
    if (!existingOwner) owner.dispose();
  }
}

/** The scheme is left alone: some feeds only work over http. */
function feedId(feedUrl: string): string {
  return hashKey(feedUrl.trim());
}

function normalized(feedUrl: string): string {
  const trimmed = feedUrl.trim();
  if (!trimmed) throw new FeedError('notFeed');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * The feed behind a read: the read itself when its text is a feed, otherwise the
 * `rel="alternate"` RSS/Atom link of the page it points at, followed up to two
 * times so pages linking pages end. The text comes back with the address it was
 * read from: the read that found the feed already holds it, and fetching that
 * address again would ask a publisher for its whole feed twice.
 */
const MAX_FEED_HOPS = 2;

async function resolveFeed(read: FeedRead, hops = 0, owner?: RequestOwner): Promise<FeedRead> {
  if (read.notModified || looksLikeFeed(read.body)) return read;
  if (hops >= MAX_FEED_HOPS) throw new FeedError('notFeed');

  for (const m of read.body.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1];
    const type = attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? '';
    if (!/rss|atom|xml/i.test(type)) continue;
    if (!/(^|\s)rel\s*=\s*["']?alternate/i.test(attrs)) continue;
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const next = new URL(href, read.url).toString();
    return resolveFeed(await get(next, FEED_ACCEPT, undefined, owner), hops + 1, owner);
  }

  throw new FeedError('notFeed');
}

function looksLikeFeed(body: string): boolean {
  return /<(rss|feed|channel)\b/i.test(body);
}

function toEpisode(channelId: string, item: ParsedItem): PodcastEpisode {
  const episode: PodcastEpisode = { id: item.id, channelId, title: item.title };
  if (item.description) episode.description = item.description;
  if (item.descriptionHtml) episode.descriptionHtml = item.descriptionHtml;
  if (item.publishedAt !== undefined) episode.publishedAt = item.publishedAt;
  if (item.episode !== undefined) episode.episode = item.episode;
  if (item.season !== undefined) episode.season = item.season;
  if (item.episodeType) episode.episodeType = item.episodeType;
  if (item.chapters?.length) episode.chapters = item.chapters;
  if (item.chaptersUrl) episode.chaptersUrl = item.chaptersUrl;
  if (item.transcripts?.length) episode.transcripts = item.transcripts;
  if (item.duration !== undefined) episode.duration = item.duration;
  if (item.url && /^https?:\/\//i.test(item.url)) episode.url = item.url;
  if (item.mimeType) episode.mimeType = item.mimeType;
  if (item.size !== undefined) episode.size = item.size;
  if (item.imageUrl && /^https?:\/\//i.test(item.imageUrl)) episode.imageUrl = item.imageUrl;
  return episode;
}

/**
 * Reads one feed and stores it, episodes replaced by what it lists now. This is
 * how a show is opened: the first read files it in SQLite, a later read only
 * updates it. There is no subscribe — opening a show lands it.
 *
 * A new show is only kept once its feed has been read. An existing one that
 * fails stays, with the error on its channel row, so it can still be seen and
 * removed.
 *
 * A read carries the validators the last one got back, so a publisher answering
 * "unchanged" costs a header instead of its whole feed — an old feed body is
 * 5 MB for a show like Radiolab, and it is re-read on opening past three days.
 */
const feedReads = new Map<string, { owner: RequestOwner; work: Promise<PodcastChannel> }>();
export async function refreshChannel(input: string, options: PodcastOperationOptions = {}): Promise<PodcastChannel> {
  // A route's abort belongs to that consumer, not another screen sharing a
  // legacy refresh. Caller-owned reads carry their cancellation to disk.
  if (options.signal || options.current || options.expectedProfile !== undefined) {
    const owner = requestOwner(options);
    try { owner.check(); return await refreshChannelOwned(input, owner); }
    finally { owner.dispose(); }
  }
  const url = normalized(input), key = `${scope()}|${url}`;
  const existing = feedReads.get(key);
  if (existing?.owner.current()) return existing.work;
  const owner = requestOwner();
  const ticket = { owner, work: Promise.resolve(null as unknown as PodcastChannel) };
  feedReads.set(key, ticket);
  ticket.work = refreshChannelOwned(url, owner).finally(() => {
    owner.dispose(); if (feedReads.get(key) === ticket) feedReads.delete(key);
  });
  return ticket.work;
}
async function refreshChannelOwned(input: string, owner: RequestOwner): Promise<PodcastChannel> {
  const url = normalized(input);
  const s = owner.scope;

  // The row under this exact address. Its validators are the only ones safe to
  // send back — a row whose feed moved answers another address — and its title
  // is the fallback when the feed has none.
  const stored = await Db.getChannel(s, feedId(url));
  owner.check();
  const since = stored && stored.feedUrl === url
    ? { etag: stored.etag, lastModified: stored.lastModified }
    : undefined;

  let read: FeedRead;
  try {
    read = await resolveFeed(await get(url, FEED_ACCEPT, since, owner), 0, owner);
  } catch (e) {
    owner.check();
    // Keyed by the stored feed, or a refresh would file the show twice.
    if (!stored) throw e;
    await Db.saveChannel(s, {
      ...stored,
      feedUrl: url,
      error: e instanceof FeedError ? e.code : 'http',
      refreshedAt: Date.now(),
    }, owner.current);
    // The lists show the error a feed read wrote down, so they ask again —
    // the show's own screen is the query that is running and answers itself.
    invalidatePodcastLists();
    throw e;
  }

  // The publisher answered "unchanged": what is stored is what it lists now, so
  // the episodes, the downloads and the picture stay and only the clock moves.
  // Only reachable when a row under this address was read conditionally.
  if (read.notModified && stored) {
    const kept: PodcastChannel = { ...stored, refreshedAt: Date.now() };
    delete kept.error;
    owner.check();
    await Db.saveChannel(s, kept, owner.current);
    invalidatePodcastLists();
    return kept;
  }

  // The feed found is what gets stored, so the next refresh skips the page.
  const id = feedId(read.url);
  const existing = read.url === url ? stored : await Db.getChannel(s, id);
  owner.check();
  const feed = await parseFeedAsync(read.body, id, read.url, { check: owner.check, signal: owner.signal });
  owner.check();
  // Which of these the device already had: an episode that was there keeps the
  // moment it first came over, one that was not gets this read's. A feed's `pubDate`
  // cannot carry that: a publisher re-dates an old item, back-catalogs a season
  // or ships no date at all, and the row then prints a date that says nothing
  // about when the episode appeared. Read here and once — `replaceEpisodes`
  // below throws the old rows out, and an episode filed before this field
  // existed answers 0, which is as old as the device and never new.
  const had = new Map<string, number>(
    (await Db.listAllEpisodes(s, id)).map((e) => [e.id, e.firstSeenAt ?? 0]),
  );
  owner.check();
  let landedAt = Date.now();
  for (const seenAt of had.values()) landedAt = Math.max(landedAt, seenAt + 1);
  const identities = new Set<string>();
  const episodes = sortEpisodes(feed.items).filter((item) => !identities.has(item.id) && !!identities.add(item.id)).map((item) => {
    const episode = toEpisode(id, item);
    episode.firstSeenAt = had.get(episode.id) ?? landedAt;
    return episode;
  });
  const dates = episodes
    .map((e) => e.publishedAt)
    .filter((d): d is number => d !== undefined);

  const channel: PodcastChannel = {
    id,
    title: feed.title?.trim() || existing?.title || read.url,
    feedUrl: read.url,
    refreshedAt: Date.now(),
    episodeCount: episodes.length,
    lastPublishedAt: dates.length > 0 ? Math.max(...dates) : existing?.lastPublishedAt,
  };
  // The episodes that came over with this read, and only when a read had
  // something to land: the read that files a show for the first time brings its
  // whole feed at once, and a badge under every title of a 66-episode show says
  // nothing — the same for a feed that moved address, which reads as a first
  // time. The mark stays until the next read that lands something.
  const landed = episodes.filter((e) => !had.has(e.id)).length;
  if (landed > 0 && had.size > 0) channel.newSinceAt = landedAt;
  else if (existing?.newSinceAt) channel.newSinceAt = existing.newSinceAt;
  if (feed.description) channel.description = feed.description;
  if (feed.descriptionHtml) channel.descriptionHtml = feed.descriptionHtml;
  if (feed.showType) channel.showType = feed.showType;
  if (feed.author) channel.author = feed.author;
  if (feed.imageUrl) channel.imageUrl = feed.imageUrl;
  if (feed.siteUrl) channel.siteUrl = feed.siteUrl;
  // The next read asks with these, and gets a header back instead of the body.
  if (read.etag) channel.etag = read.etag;
  if (read.lastModified) channel.lastModified = read.lastModified;

  // The picture belongs to the read that just happened: filing it here is what
  // keeps a kept show's art drawable when manual offline says no to fetching and
  // expo-image's cache has evicted the address. An earlier read that already
  // filed this one is not asked for its bytes again.
  if (channel.imageUrl) channel.artFile = await Db.savePodcastArt(s, id, channel.imageUrl, existing?.artFile, owner.current, owner.signal);

  owner.check();
  await Db.saveChannel(s, channel, owner.current);
  await Db.replaceEpisodes(s, id, episodes, owner.current);
  owner.check();
  const automatic = landed > 0 && had.size > 0 ? await Db.autoDownloadIds(s) : NO_FAVORITES;
  owner.check();
  if (landed > 0 && had.size > 0 && automatic.has(id)) {
    const newest = episodes.filter((e) => !had.has(e.id) && e.url).slice(0, AUTO_DOWNLOAD_EPISODES);
    void usePodcastDownloads.getState().download(channel, newest, true).catch(() => {});
  }
  // A show that was never on the device is in the lists now, and one that was
  // may have a new episode count or a new picture: the browser, Home's shelf
  // and the favorite lists ask again. The show's own screen is the query that
  // called this, and it answers itself.
  invalidatePodcastLists();
  return channel;
}

/** The show's picture: the file the read filed for it, else the feed's address.
 * Synchronous because whoever draws a cover asks while rendering. */
export function podcastCover(channel: PodcastChannel): string | undefined {
  return channel.artFile ?? channel.imageUrl;
}

/** The stored channel by its feed address, before it is opened. */
export async function getStoredChannel(feedUrl: string, options: PodcastOperationOptions = {}): Promise<PodcastChannel | undefined> {
  const owner = requestOwner(options);
  try {
    owner.check();
    const channel = await Db.getChannel(owner.scope, feedId(normalized(feedUrl)));
    owner.check(); return channel;
  } finally { owner.dispose(); }
}

export async function getChannel(id: string): Promise<PodcastChannel | undefined> {
  return Db.getChannel(scope(), id);
}

export async function getPodcastEpisode(id: string): Promise<PodcastEpisode | undefined> {
  return Db.getEpisode(scope(), id);
}

/** Takes a show off the device, with its episodes and hearts. */
export async function removeChannel(id: string): Promise<void> {
  const s = scope(), owner = profileScopeId();
  await usePodcastDownloads.getState().deleteShow(id);
  if (owner !== profileScopeId()) throw new FeedError('stopped');
  await Db.removeChannel(s, id);
  invalidatePodcastFavorites();
}

/** Every channel kept on the device, most recently published first. */
export async function listChannels(): Promise<PodcastChannel[]> {
  return Db.listChannels(scope());
}

export async function listAddedChannels(): Promise<PodcastChannel[]> {
  const owner = profileScopeId(), s = hashKey(owner);
  const [channels, ids] = await Promise.all([Db.listChannels(s), Db.addedIds(s)]);
  if (owner !== profileScopeId()) throw new FeedError('stopped');
  return channels.filter((channel) => ids.has(channel.id));
}

/** Keeps a show in Explore's list. */
export async function addChannel(id: string, options: PodcastOperationOptions = {}): Promise<void> {
  const owner = requestOwner(options);
  try {
    owner.check(); await Db.addChannel(owner.scope, id, owner.current); owner.check();
    invalidatePodcastLists();
  } finally { owner.dispose(); }
}

export async function addedChannelIds(): Promise<Set<string>> {
  return Db.addedIds(scope());
}

export async function autoDownloadChannelIds(): Promise<Set<string>> {
  return Db.autoDownloadIds(scope());
}

/** Turning it on also keeps the show, or its downloads would have no list to be in. */
export async function setChannelAutoDownload(id: string, on: boolean): Promise<void> {
  const s = scope();
  await Db.setAutoDownload(s, id, on);
  if (on) await Db.addChannel(s, id);
  invalidatePodcastLists();
}

/** The route id is either a stored channel id or a percent-encoded feed URL. */
export function isFeedUrl(id: string): boolean {
  return /^https?:\/\//i.test(decodeURIComponent(id));
}

/** Every episode of a channel, pages read to the end. */
export async function listAllEpisodes(channelId: string): Promise<PodcastEpisode[]> {
  return Db.listAllEpisodes(scope(), channelId);
}

/** Detail pages read bounded summaries; full queues and bulk operations keep
 * using listAllEpisodes and retain their complete episode data. */
export async function listEpisodePage(
  channelId: string, page: Db.PodcastEpisodePageOptions = {}, options: PodcastOperationOptions = {},
): Promise<Db.PodcastEpisodePage> {
  const owner = requestOwner(options);
  try {
    owner.check();
    const result = await Db.listEpisodePage(owner.scope, channelId, page, owner.current);
    owner.check(); return result;
  } finally { owner.dispose(); }
}

/** How many of a show's episodes are downloaded, and their ids. */
export async function downloadedForChannel(
  channelId: string,
): Promise<{ ids: string[]; count: number }> {
  return Db.downloadedForChannel(scope(), channelId);
}

/** The newest playable episodes across every show you keep, for Home. */
export async function listRecentEpisodes(limit = 20): Promise<RecentEpisode[]> {
  return Db.listRecentEpisodes(scope(), limit);
}

/** Hearts. The user's own, kept on the device like the shows themselves: one
 *  entry point that files the SQLite row and invalidates the hearted lists
 *  together, so no surface can forget the pairing. */
export async function togglePodcastHeart(
  id: string,
  kind: 'channel' | 'episode',
  channelId: string,
): Promise<boolean> {
  const s = scope();
  const added = await Db.toggleFavorite(s, id, kind, channelId);
  // A favorite show is also one you keep.
  if (added && kind === 'channel') await Db.addChannel(s, id);
  invalidatePodcastFavorites();
  return added;
}

/** The one answer to a feed that would not load: offline says so,
 *  otherwise it is the publisher's side. One message, one locale key. */
export function feedErrorMessage(translate: (key: string) => string, e: unknown): string {
  return e instanceof FeedError && e.code === 'offline'
    ? translate("You're offline")
    : translate("Couldn't read this feed");
}

/** The hearted ids, so a row can light its heart without asking per row. */
export async function favoriteIds(): Promise<Set<string>> {
  return Db.favoriteIds(scope());
}

/** Stand-in for a heart set that hasn't loaded yet. One instance, so a row's
 * `favSet` prop keeps its identity across renders instead of churning. */
export const NO_FAVORITES: Set<string> = new Set();

export async function listFavoriteChannels(): Promise<(PodcastChannel & Db.FavoriteTimes)[]> {
  return Db.listFavoriteChannels(scope());
}

export async function listFavoriteEpisodes(limit = 100): Promise<(RecentEpisode & Db.FavoriteTimes)[]> {
  return Db.listFavoriteEpisodes(scope(), limit);
}

/**
 * Reads every show you keep again, one at a time so no host sees a burst.
 * Failures are counted, not thrown: one dead feed must not stall the rest.
 * `shouldCancel` is checked before each feed, so a Stop part way through
 * leaves the feeds already read in place and returns without touching the rest.
 */
export async function refreshAll(
  shouldCancel?: () => boolean,
): Promise<{ failed: number; total: number; stopped: boolean }> {
  const owner = requestOwner({ current: () => !shouldCancel?.() });
  try {
    owner.check();
    const feeds = await Db.listFeeds(owner.scope);
    let failed = 0;
    for (const feed of feeds) {
      if (!owner.current()) return { failed, total: feeds.length, stopped: true };
      try {
        await refreshChannel(feed, { signal: owner.signal, current: owner.current });
      } catch {
        if (!owner.current()) return { failed, total: feeds.length, stopped: true };
        failed++;
      }
    }
    return { failed, total: feeds.length, stopped: !owner.current() };
  } finally { owner.dispose(); }
}

/** Re-reads auto-download shows gone stale, which is how they see new episodes:
 *  nothing else reads a feed until its show is opened. */
let automaticRefresh: { owner: string; work: Promise<void> } | undefined;
export function refreshAutoDownloadShows(): Promise<void> {
  const owner = profileScopeId();
  if (automaticRefresh?.owner === owner) return automaticRefresh.work;
  const ticket = { owner, work: Promise.resolve() as Promise<void> };
  automaticRefresh = ticket;
  ticket.work = refreshAutoDownloadShowsOwned(owner).finally(() => { if (automaticRefresh === ticket) automaticRefresh = undefined; });
  return ticket.work;
}
async function refreshAutoDownloadShowsOwned(owner: string): Promise<void> {
  if (isManualOffline()) return;
  const ids = await autoDownloadChannelIds();
  if (ids.size === 0) return;
  for (const channel of await listChannels()) {
    if (owner !== profileScopeId() || isManualOffline()) return;
    if (!ids.has(channel.id)) continue;
    if (!channel.feedUrl) continue;
    if (Date.now() - (channel.refreshedAt ?? 0) < AUTO_DOWNLOAD_READ_MS) continue;
    await refreshChannel(channel.feedUrl).catch(() => {});
  }
}

/** The ids of a show's episodes that count as played. */
export async function playedEpisodeIds(channelId: string): Promise<Set<string>> {
  const rows = await Db.listEpisodeProgress(scope(), channelId);
  return new Set(rows.filter((r) => episodePlayed(r.positionSec, r.durationSec)).map((r) => r.id));
}

/** Played is progress at the end, so unplayed is no progress: it starts over. */
export async function setEpisodePlayed(song: Song, played: boolean): Promise<void> {
  await markPodcastPlayed(song, played);
}

const SUFFIXES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** An episode as a queue entry; `coverArtUrl` passes the artwork URL through. */
export function episodeToSong(episode: PodcastEpisode, channel: PodcastChannel): Song {
  const song: Song = {
    id: episode.id,
    title: episode.title,
    // The show stands in for both, so an episode reads like a track off a record
    // named after the show. Nothing navigates these as a real artist/album: every
    // consumer (rows, player, the song menu) gates on `podcastChannelId` first, and
    // the album/artist nav and "More from artist" are unreachable from an episode.
    artist: channel.title,
    album: channel.title,
    url: episode.url,
    // A file, not a station: it can play at another speed.
    vod: true,
    // The show it belongs to: the episode's menu offers "Go to Podcast".
    podcastChannelId: channel.id,
  };
  // The picture the read filed, when it filed one: the player draws this
  // address, and offline only the file is still there.
  const cover = podcastCover(channel);
  if (cover) song.coverArt = cover;
  if (episode.duration !== undefined) song.duration = episode.duration;
  if (episode.publishedAt !== undefined) song.addedAt = episode.publishedAt;
  // The feed's own episode number, kept for the song's info sheet: the show's
  // screen leaves its rows unnumbered, since a place in the list is not something
  // a feed promises, but a number the publisher did give is still worth having.
  if (episode.episode !== undefined) song.track = episode.episode;
  const suffix = episode.mimeType ? SUFFIXES[episode.mimeType.toLowerCase()] : undefined;
  if (suffix) song.suffix = suffix;
  return song;
}

/** Plays one episode as its show's, from wherever it was reached: the queue
 *  gets the song, the show's name as its source, and the show's own address
 *  as where it came from — that address is what makes "Go to Podcast" from
 *  the now-playing header land on this show instead of a search. One call,
 *  so a card, a list row and the Library's two tabs queue it the same way. */
export function queueEpisode(episode: PodcastEpisode, channel: PodcastChannel): void {
  void usePlayerStore.getState().playQueue(
    [episodeToSong(episode, channel)],
    0,
    channel.title,
    `/podcast/${channel.id}`,
  );
}

/** The heart a FavoriteButton writes for an episode: the device's own SQLite
 *  favorite, filed under the show it belongs to. */
export function episodeHeart(song: Song): { kind: 'episode'; channelId: string } | undefined {
  return song.podcastChannelId ? { kind: 'episode', channelId: song.podcastChannelId } : undefined;
}

/** Which heart is lit: an episode's is the device's own SQLite set, a server
 *  song's is the server's list, and what the song carries is the fallback
 *  while that list is still loading. One rule, so the rows, the mini player
 *  and the now-playing header cannot drift apart. */
export function heartedSong(
  song: Song,
  podcastFavIds: Set<string>,
  favIds: Set<string> | undefined,
): boolean {
  return song.podcastChannelId
    ? podcastFavIds.has(song.id)
    : favIds ? favIds.has(song.id) : !!song.starred;
}

export interface PodcastDirectoryRequestOptions {
  country?: string;
  signal?: AbortSignal;
}
export interface PodcastDirectoryChartOptions extends PodcastDirectoryRequestOptions { genreId?: number }

const DIRECTORY_MAX_BYTES = 2 * 1024 * 1024;

/** Public Apple requests are separate from the media-server transport and never carry its credentials. */
async function directoryRead(url: string, options: PodcastDirectoryRequestOptions): Promise<unknown> {
  const owner = requestOwner(), controller = new AbortController();
  let rejectStop!: (error: PodcastDirectoryError) => void;
  let failure: PodcastDirectoryError | undefined;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const stop = (code: 'stopped' | 'timeout') => {
    if (failure) return;
    failure = new PodcastDirectoryError(code);
    controller.abort(); rejectStop(failure);
  };
  const abort = () => stop('stopped');
  owner.signal.addEventListener('abort', abort, { once: true });
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => stop('timeout'), TIMEOUT_MS);
  const check = () => { if (failure) throw failure; owner.check(); };
  const work = async () => {
    if (options.signal?.aborted || owner.signal.aborted) throw new PodcastDirectoryError('stopped');
    check(); assertCanRequest(!isManualOffline());
    const response = await fetch(url, {
      credentials: 'omit', signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    check();
    if (!response.ok) throw new PodcastDirectoryError('http');
    const announced = Number(response.headers.get('content-length'));
    if (Number.isFinite(announced) && announced > DIRECTORY_MAX_BYTES) throw new PodcastDirectoryError('tooLarge');
    let body = '';
    if (response.body) {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let bytes = 0;
      try {
        while (true) {
          const next = await reader.read(); check();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > DIRECTORY_MAX_BYTES) throw new PodcastDirectoryError('tooLarge');
          body += decoder.decode(next.value, { stream: true });
        }
        body += decoder.decode();
      } finally { reader.releaseLock(); }
    } else {
      body = await response.text(); check();
      if (body.length > DIRECTORY_MAX_BYTES || new TextEncoder().encode(body).byteLength > DIRECTORY_MAX_BYTES) {
        throw new PodcastDirectoryError('tooLarge');
      }
    }
    check();
    try { return JSON.parse(body) as unknown; } catch { throw new PodcastDirectoryError('response'); }
  };
  try { return await Promise.race([work(), stopped]); }
  catch (error) {
    controller.abort();
    if (error instanceof PodcastDirectoryError) throw error;
    if (!owner.current()) throw new PodcastDirectoryError('stopped');
    if (error instanceof OfflineError || isManualOffline()) throw new PodcastDirectoryError('offline');
    throw new PodcastDirectoryError('http');
  } finally {
    clearTimeout(timer); owner.dispose();
    owner.signal.removeEventListener('abort', abort);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** One chart request; IDs are resolved to publisher feeds only when a row is opened. */
export async function directoryCharts(options: PodcastDirectoryChartOptions = {}): Promise<PodcastDirectoryShow[]> {
  return decodePodcastDirectoryChart(await directoryRead(podcastDirectoryChartUrl(options.country, options.genreId), options));
}

async function directorySearchLimit(term: string, options: PodcastDirectoryRequestOptions, limit: number): Promise<PodcastDirectoryShow[]> {
  const query = term.trim(); if (!query) return [];
  const id = podcastAppleDirectoryId(query);
  if (id) { const show = await directoryLookup(id, options); return show ? [show] : []; }
  return decodePodcastDirectorySearch(await directoryRead(podcastDirectorySearchUrl(query, options.country, limit), options));
}

export async function directorySearch(term: string, options: PodcastDirectoryRequestOptions = {}): Promise<PodcastDirectoryShow[]> {
  return directorySearchLimit(term, options, 40);
}

export async function directoryLookup(id: number, options: PodcastDirectoryRequestOptions = {}): Promise<PodcastDirectoryShow | undefined> {
  return decodePodcastDirectorySearch(await directoryRead(podcastDirectoryLookupUrl([id], options.country), options))
    .find((show) => show.id === id);
}

/** Preserve the existing add-sheet contract: only rows with a publisher feed can be subscribed to. */
function directoryFeeds(shows: PodcastDirectoryShow[]): PodcastSearchResult[] {
  const seen = new Set<string>(), results: PodcastSearchResult[] = [];
  for (const show of shows) {
    if (!show.feedUrl || seen.has(show.feedUrl)) continue;
    seen.add(show.feedUrl);
    results.push({ feedUrl: show.feedUrl, title: show.title,
      ...(show.author ? { author: show.author } : {}), ...(show.imageUrl ? { imageUrl: show.imageUrl } : {}) });
  }
  return results;
}

export async function search(term: string, options: PodcastDirectoryRequestOptions = {}): Promise<PodcastSearchResult[]> {
  return directoryFeeds(await directorySearchLimit(term, options, SEARCH_LIMIT));
}

/** Legacy eager feed lookup, with chart order retained even when Apple returns lookup rows in another order. */
export async function charts(options: PodcastDirectoryChartOptions = {}): Promise<PodcastSearchResult[]> {
  const owner = requestOwner();
  const abort = () => owner.check();
  try {
    const chart = decodePodcastDirectoryChart(await directoryRead(podcastDirectoryChartUrl(options.country, options.genreId, CHART_LIMIT), options));
    abort(); if (!chart.length) return [];
    const shows = decodePodcastDirectorySearch(await directoryRead(podcastDirectoryLookupUrl(chart.map((show) => show.id), options.country), options));
    abort();
    const byId = new Map(shows.map((show) => [show.id, show]));
    return directoryFeeds(chart.flatMap((show) => { const resolved = byId.get(show.id); return resolved ? [resolved] : []; }));
  } finally { owner.dispose(); }
}

/** Existing Glass explicit subscription API: previewing/refreshing is not adding. */
const subscriptions = new Map<string, Promise<unknown>>();
export async function subscribe(input: string, options: PodcastOperationOptions = {}): Promise<PodcastChannel> {
  const owner = requestOwner(options);
  let url: string;
  try { owner.check(); url = normalized(input); } catch (error) { owner.dispose(); throw error; }
  const key = `${owner.scope}|${owner.epoch}|${url}`;
  const previous = subscriptions.get(key) ?? Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    owner.check();
    const stored = await Db.getChannel(owner.scope, feedId(url)); owner.check();
    const added = stored ? await Db.addedIds(owner.scope) : undefined; owner.check();
    // Repeated/concurrent taps are idempotent. Offline, only a fully stored
    // preview can be kept; a directory row alone never invents a subscription.
    const channel = stored && (added?.has(stored.id) || isManualOffline()) ? stored
      : await refreshChannelOwned(url, owner);
    owner.check();
    await Db.addChannel(owner.scope, channel.id, owner.current);
    owner.check(); invalidatePodcastLists(); return channel;
  });
  subscriptions.set(key, work);
  try { return await work; }
  finally { owner.dispose(); if (subscriptions.get(key) === work) subscriptions.delete(key); }
}
export const unsubscribe = removeChannel;
export const listEpisodes = listAllEpisodes;

export function invalidatePodcastLists(): void {
  for (const name of ['podcastChannels', 'podcastRecentEpisodes', 'podcastFavoriteChannels', 'podcastFavoriteEpisodes', 'podcastLibrary']) {
    void queryClient.invalidateQueries({ queryKey: [name] });
  }
}
export function invalidatePodcastFavorites(): void {
  void queryClient.invalidateQueries({ queryKey: ['podcastFavorites'] });
  invalidatePodcastLists();
}
