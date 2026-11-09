import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Song } from '../src/api/subsonic';
import { matchBackupTracks, observedRecoveryEntries, pendingPlaylistEntries, pendingPlaylistRows, portableBackupTrack, validatePersonalBackup } from '../src/lib/personalBackupModels';
const song: Song = { id: 'one', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269 };
const base = () => ({ format: 'resonus-personal-backup', version: 1, createdAt: '2026-11-09T00:00:00Z', library: 'abcd',
  settings: { accentColor: '#ff0000', password: 'private' }, favorites: { songs: [{ ...song }], albums: [{ id: 'album', title: '叶惠美' }], artists: [{ id: 'artist', name: '周杰伦' }] },
  ratings: [{ track: song, value: 4 }], playlists: [{ key: 'list', name: 'Favorites', entries: [{ key: 'first', track: song, songId: 'one' }] }],
  extras: { auth: { password: 'private' }, lyricOffsets: { one: 100 } } });
test('personal backup sanitizes identity metadata/settings/extras and refuses malformed limits', () => {
  const raw = base(); Object.assign(raw.favorites.songs[0], { url: 'https://private/?password=private', localUri: 'file:///private', token: 'private' });
  const parsed = validatePersonalBackup(raw, ['accentColor']);
  assert.doesNotMatch(JSON.stringify(parsed), /password|token|file:\/\/|https:\/\//);
  assert.deepEqual(parsed.settings, { accentColor: '#ff0000' });
  assert.throws(() => validatePersonalBackup({ ...raw, version: 2 }, []));
  assert.throws(() => validatePersonalBackup({ ...raw, ratings: [{ track: song, value: 6 }] }, []));
  assert.throws(() => validatePersonalBackup({ ...raw, font: { name: '../fake.ttf', base64: 'aGVsbG8=' } }, []));
  assert.throws(() => pendingPlaylistEntries([{ key: 'x', track: song }, { key: 'x', track: song }]));
});
test('same-library ID matching is explicit; foreign IDs and ambiguous duplicate editions are not guessed', async () => {
  const one = { ...song, id: 'a' }, two = { ...song, id: 'b' };
  assert.equal((await matchBackupTracks([one], [one, two], false, () => true))[0].selected, undefined);
  assert.equal((await matchBackupTracks([one], [one, two], true, () => true))[0].selected?.id, 'a');
  assert.equal((await matchBackupTracks([one], [{ ...song, id: 'new' }], false, () => true))[0].selected?.id, 'new');
  await assert.rejects(matchBackupTracks([one], [one], true, () => false), /cancelled/);
});
test('missing occurrences retain original positions around repeated anchor tracks', () => {
  const track = portableBackupTrack(song), entries = pendingPlaylistEntries([
    { key: 'a', track, songId: 'one' }, { key: 'lost1', track }, { key: 'b', track, songId: 'one' }, { key: 'lost2', track },
  ]);
  assert.deepEqual(pendingPlaylistRows(entries, [song, song]).map((r) => [r.key, r.before]), [['lost1', 1], ['lost2', 2]]);
  assert.equal(entries[1].songId, undefined);
});
test('observed snapshots preserve missing metadata while respecting current live order and newly added songs', () => {
  const entries = pendingPlaylistEntries([{ key: 'a', track: song, songId: 'one' }, { key: 'lost', track: { ...song, title: 'Missing' } }, { key: 'b', track: { ...song, id: 'two' }, songId: 'two' }]);
  const now = [song, { ...song, id: 'new', title: 'New' }, { ...song, id: 'two' }];
  const observed = observedRecoveryEntries(entries, now);
  assert.deepEqual(observed.filter((e) => e.songId).map((e) => e.songId), ['one', 'new', 'two']);
  assert.deepEqual(pendingPlaylistRows(observed, now).map((r) => [r.key, r.before]), [['lost', 2]]);
  const again = observedRecoveryEntries(observed, now); assert.deepEqual(again, observed);
  const removed = observedRecoveryEntries(observed, [song]);
  // A removed live ID isn't automatically a visible missing placeholder.
  assert.equal(removed.find((e) => e.key === 'b')?.songId, 'two');
});
