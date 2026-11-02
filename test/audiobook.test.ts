import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Song } from '../src/api/subsonic';
import { audiobookAlbum, audiobookResumeStart, isAudiobookAlbum, isAudiobookGenre, isAudiobookSong } from '../src/lib/audiobook';
import { AlbumProgressPersistence, parseAlbumProgress } from '../src/lib/albumProgressPersistence';
import { AudiobookProgressTracker } from '../src/lib/audiobookTracking';
const song = (id: string, duration = 100): Song => ({ id, title: id, albumId: 'book', duration, genre: 'Audiobook' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

test('explicit multilingual medium tags identify books without music/story false positives or podcasts', () => {
  for (const label of ['Hörbuch', 'Hörbuch - Thriller', 'Sci-Fi Audio Drama', 'Audiobook / Fantasy', '有声书', 'オーディオブック', 'аудиокнига']) assert.equal(isAudiobookGenre(label), true, label);
  for (const label of ['Thriller', 'History', 'Fantasy', 'Horror', 'Cyberpunk', 'Podcast', 'notanaudiobook', 'Psychothriller']) assert.equal(isAudiobookGenre(label), false, label);
  assert.equal(isAudiobookAlbum({ id: 'b', name: 'book', releaseTypes: ['album', 'audiobook'] }), true);
  assert.equal(isAudiobookSong({ ...song('ep'), url: 'https://episode', vod: true, podcastChannelId: 'show' }), false);
  assert.equal(audiobookAlbum({ id: 'b', name: 'book', releaseTypes: ['audiobook'] }, [{ ...song('ep'), url: 'https://episode', vod: true }]), false);
  assert.equal(audiobookAlbum({ id: 'music', name: 'Mix' }, [song('spoken'), { ...song('music'), genre: 'Pop' }]), false);
});

test('resume rewinds across known chapters and stops at unknown boundaries or the first chapter', () => {
  const chapters = [song('one'), song('two', 200), song('three')];
  const progress = { trackId: 'three', positionSec: 15, updatedAt: 1 };
  assert.deepEqual(audiobookResumeStart(chapters, progress, 250), { index: 0, positionSec: 65 });
  assert.deepEqual(audiobookResumeStart(chapters, progress, 7200), { index: 0, positionSec: 0 });
  assert.deepEqual(audiobookResumeStart([song('one'), { ...song('two'), duration: undefined }, song('three')], progress, 250), { index: 2, positionSec: 0 });
  assert.equal(audiobookResumeStart(chapters, { ...progress, trackId: 'missing' }, 10), null);
});

test('hydration merges in-flight local changes while preserving untouched profiles and books', async () => {
  const read = deferred<string | null>(), writes: string[] = [];
  const saved = { old: { retained: { trackId: 'other', positionSec: 88, updatedAt: 1 } }, user: { book: { trackId: 'one', positionSec: 10, updatedAt: 1 } } };
  const state = new AlbumProgressPersistence({ read: () => read.promise, write: async (value) => { writes.push(value); }, now: () => 40_000 });
  const hydration = state.hydrate();
  state.remember('user', 'book', 'two', 45, true);
  read.resolve(JSON.stringify(saved)); await hydration; await state.flush();
  assert.equal(state.getSnapshot().byProfile.user.book.trackId, 'two');
  assert.deepEqual(state.getSnapshot().byProfile.old.retained, saved.old.retained);
  assert.equal(JSON.parse(writes.at(-1)!).user.book.positionSec, 45);
});

test('read failures never overwrite saved positions, and explicit deletion wins a late hydrate', async () => {
  const writes: string[] = [];
  const failed = new AlbumProgressPersistence({ read: async () => { throw new Error('locked'); }, write: async (value) => { writes.push(value); } });
  failed.remember('a', 'book', 'one', 5, true);
  await assert.rejects(failed.flush()); assert.equal(writes.length, 0); assert.equal(failed.getSnapshot().error, true);
  const read = deferred<string | null>();
  const state = new AlbumProgressPersistence({ read: () => read.promise, write: async (value) => { writes.push(value); } });
  const pending = state.hydrate(); await state.clearAll();
  read.resolve(JSON.stringify({ old: { book: { trackId: 'x', positionSec: 99, updatedAt: 1 } } })); await pending;
  assert.deepEqual(state.getSnapshot().byProfile, {}); assert.equal(writes.at(-1), '{}');
});

test('strict writes serialize, retry dirty state after failure and keep the latest pause position', async () => {
  let count = 0; const written: string[] = [], first = deferred<void>();
  const state = new AlbumProgressPersistence({ read: async () => null, write: async (value) => {
    count++; if (count === 1) { await first.promise; throw new Error('disk full'); } written.push(value);
  }, now: () => 1000 });
  await state.hydrate(); state.remember('profile-A', 'book', 'chapter', 10, true);
  await Promise.resolve(); state.remember('profile-A', 'book', 'chapter', 23, true); first.resolve();
  await state.flush(); assert.equal(JSON.parse(written.at(-1)!)['profile-A'].book.positionSec, 23);
  assert.equal(state.getSnapshot().error, false);
  assert.throws(() => parseAlbumProgress('[]'));
  assert.equal(Object.keys(parseAlbumProgress('{"a":{"b":{"trackId":"x","positionSec":-1,"updatedAt":1}}}').a).length, 0);
});

test('tracker flushes outgoing owner on pause/change/background and completion cannot resurrect', async () => {
  const saved: unknown[][] = [], deleted: unknown[][] = []; let flushes = 0;
  const tracker = new AudiobookProgressTracker({ remember: (...args) => saved.push(args), clearAlbum: (...args) => deleted.push(args), flush: async () => { flushes++; } });
  const a = { scope: 'A', albumId: 'book', trackId: 'last', positionSec: 90, playing: true, enabled: true, audiobook: true };
  tracker.observe(a); tracker.observe({ ...a, positionSec: 95, playing: false });
  assert.equal(saved.at(-1)![0], 'A'); assert.equal(saved.at(-1)![4], true);
  assert.equal(saved.at(-1)![3], 95, 'pause saves the current position, not the previous heartbeat');
  await tracker.flush(); assert.equal(flushes, 1);
  tracker.complete(a); const count = saved.length;
  tracker.observe({ ...a, playing: false }); tracker.begin();
  tracker.observe({ ...a, scope: 'B', albumId: 'other' });
  assert.equal(saved.length, count + 1, 'the completed A position must not be written back');
  assert.deepEqual(deleted, [['A', 'book']]);
});
