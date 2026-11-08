import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PodcastChannel, PodcastEpisode } from '../src/api/subsonic';
import { createPodcastDownloadConfirmation, podcastDownloadSelection, podcastEpisodeOrder,
  podcastEpisodeSortKey, sortPodcastEpisodes } from '../src/lib/podcastPresentation';

const channel: PodcastChannel = { id: 'show', title: 'Example show' };
const episode = (id: string, fields: Partial<PodcastEpisode> = {}): PodcastEpisode => ({
  id, channelId: channel.id, title: id, url: `https://audio.test/${id}.mp3`, ...fields,
});
const ids = (episodes: PodcastEpisode[]) => episodes.map((item) => item.id);

test('episode dates define newest/oldest order without changing input; unknown dates stay last', () => {
  const source = [episode('middle', { publishedAt: 200 }), episode('unknown'),
    episode('new', { publishedAt: 300 }), episode('old', { publishedAt: 100 }),
    episode('same', { publishedAt: 200 }), episode('invalid', { publishedAt: Number.NaN })];
  assert.deepEqual(ids(sortPodcastEpisodes(source, 'recent')), ['new', 'middle', 'same', 'old', 'unknown', 'invalid']);
  assert.deepEqual(ids(sortPodcastEpisodes(source, 'added')), ['old', 'middle', 'same', 'new', 'unknown', 'invalid']);
  assert.deepEqual(ids(source), ['middle', 'unknown', 'new', 'old', 'same', 'invalid']);
});

test('alphabetical ordering is stable and each show/profile has a distinct saved preference', () => {
  const source = [episode('b', { title: 'Beta' }), episode('a1', { title: 'Alpha' }), episode('a2', { title: 'Alpha' })];
  assert.deepEqual(ids(sortPodcastEpisodes(source, 'alpha', 'en')), ['a1', 'a2', 'b']);
  const keys = [podcastEpisodeSortKey('one', 'a'), podcastEpisodeSortKey('one', 'b'),
    podcastEpisodeSortKey('two', 'a'), podcastEpisodeSortKey('one:a', 'b'), podcastEpisodeSortKey('one', 'a:b')];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(podcastEpisodeSortKey('one', 'a'), podcastEpisodeSortKey('one', 'a'));
  assert.equal(podcastEpisodeOrder('downloaded'), 'recent');
  assert.equal(podcastEpisodeOrder('added'), 'added');
});

test('download confirmation counts only missing unique HTTP audio from this show and only known durations', () => {
  const source = [episode('done', { duration: 999 }), episode('one', { duration: 60 }),
    episode('one', { duration: 60 }), episode('two', { duration: 120 }), episode('unknown'),
    episode('invalid-time', { duration: Number.NaN }), episode('negative-time', { duration: -5 }),
    episode('unavailable', { url: undefined }), episode('foreign', { channelId: 'other' }),
    episode('local', { url: 'file:///audio.mp3' })];
  const selection = podcastDownloadSelection(channel.id, source, { done: 'file:///done.mp3' });
  assert.deepEqual(ids(selection.pending), ['one', 'two', 'unknown', 'invalid-time', 'negative-time']);
  assert.equal(selection.seconds, 180);
  assert.equal(selection.unknownDuration, 3);
  assert.equal(selection.downloadable, 6);
  assert.equal(Object.hasOwn(selection, 'bytes'), false, 'feed audio size is never guessed');
});

function harness() {
  let owner = { account: 'one' }, allowed = true;
  let files: Record<string, string> = {};
  let read = async (_id: string) => [episode('a', { duration: 60 }), episode('b', { duration: 120 })];
  const downloads: { channel: PodcastChannel; episodes: PodcastEpisode[] }[] = [];
  let transferFailure = false;
  const control = createPodcastDownloadConfirmation({
    owner: () => owner, allowed: () => allowed, episodes: (id) => read(id), files: () => files,
    download: async (show, episodes) => {
      downloads.push({ channel: show, episodes });
      if (transferFailure) throw Error('Transfer failed');
    },
  });
  return { control, downloads, complete(id: string) { files = { ...files, [id]: `file:///${id}.mp3` }; },
    setReader(value: typeof read) { read = value; },
    switchOwner() { owner = { account: 'two' }; },
    offline() { allowed = false; }, failTransfer() { transferFailure = true; },
  };
}

test('preparing and cancelling a whole-show confirmation never downloads; confirm rechecks files and is single-use', async () => {
  const h = harness();
  const cancelled = await h.control.prepare(channel); assert.ok(cancelled);
  assert.equal(h.downloads.length, 0);
  h.control.cancel(); assert.equal(await h.control.confirm(cancelled), false);
  const request = await h.control.prepare(channel); assert.ok(request);
  h.complete('a');
  assert.equal(await h.control.confirm(request), true);
  assert.equal(h.downloads[0].channel, channel);
  assert.deepEqual(ids(h.downloads[0].episodes), ['b']);
  assert.equal(await h.control.confirm(request), false);
  assert.equal(h.downloads.length, 1);
});

test('a delayed show lookup cannot replace a newer opening or survive a profile change/cancel', async () => {
  const h = harness();
  let resolve!: (episodes: PodcastEpisode[]) => void;
  h.setReader(() => new Promise((done) => { resolve = done; }));
  const old = h.control.prepare(channel);
  h.setReader(async () => [episode('next', { channelId: 'new-show' })]);
  const nextChannel = { ...channel, id: 'new-show' };
  const next = await h.control.prepare(nextChannel); assert.ok(next);
  resolve([episode('old')]);
  assert.equal(await old, null);
  assert.equal(h.control.owns(next), true);
  h.switchOwner();
  assert.equal(h.control.owns(next), false);
  assert.equal(await h.control.confirm(next), false);
  assert.equal(h.downloads.length, 0);

  let finish!: (episodes: PodcastEpisode[]) => void;
  h.setReader(() => new Promise((done) => { finish = done; }));
  const closed = h.control.prepare(channel); h.control.cancel(); finish([episode('a')]);
  assert.equal(await closed, null);
});

test('confirmation rejects offline changes, all-complete files and read failures without admitting jobs', async () => {
  const offline = harness(), done = harness(), failed = harness();
  const pending = await offline.control.prepare(channel); assert.ok(pending);
  offline.offline(); assert.equal(await offline.control.confirm(pending), false);
  const completed = await done.control.prepare(channel); assert.ok(completed);
  done.complete('a'); done.complete('b'); assert.equal(await done.control.confirm(completed), false);
  failed.setReader(async () => { throw Error('Database unavailable'); });
  await assert.rejects(failed.control.prepare(channel), /Database unavailable/);
  assert.equal([...offline.downloads, ...done.downloads, ...failed.downloads].length, 0);
});

test('a failed accepted transfer reports its rejection and cannot be resubmitted by double-confirm', async () => {
  const h = harness(); h.failTransfer();
  const request = await h.control.prepare(channel); assert.ok(request);
  await assert.rejects(h.control.confirm(request), /Transfer failed/);
  assert.equal(await h.control.confirm(request), false);
  assert.equal(h.downloads.length, 1);
});
