import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Song } from '../src/api/subsonic';
import { matchPlaylist, matchPlaylistAsync, parsePlaylistFile, playlistJson, playlistM3u, unmatchedReport } from '../src/lib/playlistExchange';
const one: Song = { id: 'one', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269, suffix: 'flac' };
test('JSON and extended UTF-8 M3U round trip metadata, order and repeated tracks without credentials', () => {
  for (const text of [playlistJson('测试', [one, one]), playlistM3u('测试', [one, one])]) {
    const result = parsePlaylistFile('\uFEFF' + text, 'test.m3u8');
    assert.equal(result.name, '测试'); assert.equal(result.tracks.length, 2);
    assert.equal(result.tracks[0].title, one.title); assert.equal(result.tracks[0].artist, one.artist);
    const matched = matchPlaylist(result, [one]); assert.deepEqual(matched.map((row) => row.selected?.id), ['one', 'one']);
  }
  const value = { ...one, localUri: 'file:///private/track.flac', url: 'https://secret.test/stream?password=secret', path: 'https://host/track?token=secret' };
  assert.doesNotMatch(playlistJson('x', [value]) + playlistM3u('x', [value]), /secret|file:\/\/|https:\/\//);
});
test('matching refuses ambiguous editions, wrong artist, album and duration; candidates remain selectable', () => {
  const duplicate = { ...one, id: 'two' };
  assert.equal(matchPlaylist({ name: 'x', tracks: [one] }, [one, duplicate])[0].selected, undefined);
  for (const track of [{ ...one, artist: 'other' }, { ...one, album: 'live' }, { ...one, duration: 500 }]) {
    const row = matchPlaylist({ name: 'x', tracks: [track] }, [one])[0]; assert.equal(row.selected, undefined); assert.equal(row.candidates.length, 1);
  }
});
test('plain relative paths and remote URLs are labels only; parsed lists never fetch or retain URL credentials', () => {
  const result = parsePlaylistFile('https://user:password@untrusted.test/Hello.mp3?token=secret\nArtist/Next%20Song.flac', 'plain.m3u');
  assert.deepEqual(result.tracks.map((track) => track.title), ['Hello', 'Next Song']);
  assert.doesNotMatch(JSON.stringify(result), /password|secret|untrusted/);
});
test('invalid and excessive files fail explicitly, and line injection cannot add M3U entries', () => {
  assert.throws(() => parsePlaylistFile('x'.repeat(5_000_001), 'x'), /too large/);
  assert.throws(() => parsePlaylistFile('{}', 'x'), /Unsupported/);
  assert.throws(() => parsePlaylistFile('#EXTM3U', 'x'), /no valid/);
  assert.throws(() => parsePlaylistFile(playlistJson('x', Array.from({ length: 10001 }, () => one)), 'x'), /too many/);
  const result = parsePlaylistFile(playlistM3u('x\n#EXTINF:0,evil', [{ ...one, title: 'title\n#EXTINF:0,evil' }]), 'x');
  assert.equal(result.tracks.length, 1);
});
test('unmatched report is itself re-importable and keeps only unresolved metadata', () => {
  const matched = matchPlaylist({ name: 'x', tracks: [one, { title: 'missing' }] }, [one]);
  const report = parsePlaylistFile(unmatchedReport(matched), 'unmatched.json');
  assert.deepEqual(report.tracks.map((track) => track.title), ['missing']);
});
test('large matching indexes the catalogue once and retains playlist occurrence order', () => {
  const songs = Array.from({ length: 20000 }, (_, index) => ({ ...one, id: String(index), title: `Song ${index}` }));
  const tracks = [songs[19999], songs[0], songs[100], songs[0]];
  assert.deepEqual(matchPlaylist({ name: 'x', tracks }, songs).map((row) => row.selected?.id), ['19999', '0', '100', '0']);
});
test('extended M3U preserves artist and title containing the display separator and resets explicit metadata per track', () => {
  const special = { ...one, title: 'Song - Part II', artist: 'Artist - Solo', album: 'Album - Deluxe' };
  const parsed = parsePlaylistFile(playlistM3u('Mix', [special, one]), 'x.m3u8');
  assert.deepEqual(parsed.tracks.map(({ title, artist, album }) => ({ title, artist, album })), [special, one].map(({ title, artist, album }) => ({ title, artist, album })));
  const external = parsePlaylistFile('#EXTM3U\n#EXTINF:20,Artist - Regular title\ntrack.flac', 'x.m3u');
  assert.equal(external.tracks[0].title, 'Regular title');
  assert.equal(external.tracks[0].artist, 'Artist');
  const explicit = parsePlaylistFile('#EXTTITLE:Explicit title\n#EXTART:Artist - With separator\n#EXTINF:20,Ambiguous - Label\nfirst.flac\nsecond.flac', 'x.m3u');
  assert.deepEqual(explicit.tracks.map((track) => track.title), ['Explicit title', 'second']);
});
test('candidate samples are capped without ever turning a large ambiguous group into an automatic match', () => {
  const songs = Array.from({ length: 2000 }, (_, index) => ({ ...one, id: String(index) }));
  const rows = matchPlaylist({ name: 'x', tracks: [one, { title: one.title }] }, songs);
  for (const row of rows) { assert.equal(row.candidates.length, 50); assert.equal(row.selected, undefined); }
  const final = { ...one, id: 'final', artist: 'Different artist', album: 'Different edition', duration: 400 };
  assert.equal(matchPlaylist({ name: 'x', tracks: [final] }, [...songs, final])[0].selected?.id, 'final');
  assert.equal(matchPlaylist({ name: 'x', tracks: [{ ...one, duration: 400 }] }, [...songs, { ...one, id: 'different-time', duration: 400 }])[0].selected?.id, 'different-time');
});
test('duration windows count every known recording and retain unknown durations only as manual candidates', () => {
  const unknown = Array.from({ length: 500 }, (_, index) => ({ ...one, id: `unknown-${index}`, duration: undefined }));
  let row = matchPlaylist({ name: 'x', tracks: [one] }, [...unknown, one])[0];
  assert.equal(row.selected?.id, one.id); assert.equal(row.candidates.length, 50);
  row = matchPlaylist({ name: 'x', tracks: [one] }, unknown)[0];
  assert.equal(row.selected, undefined); assert.equal(row.candidates.length, 50);
  const durations = [265.9, 266, 269, 272, 272.1].map((duration, index) => ({ ...one, id: String(index), duration }));
  row = matchPlaylist({ name: 'x', tracks: [one] }, durations)[0];
  assert.deepEqual(row.candidates.map((song) => song.duration), [266, 269, 272]); assert.equal(row.selected, undefined);
  const noArtist = { title: one.title, album: 'Rare album', duration: 300 };
  const rare = { ...one, id: 'rare', artist: 'Another artist', album: noArtist.album, duration: noArtist.duration };
  assert.equal(matchPlaylist({ name: 'x', tracks: [noArtist] }, [...unknown, rare])[0].selected?.id, rare.id);
});
test('normalization that erases title, artist or album cannot authorize an automatic match', () => {
  assert.equal(matchPlaylist({ name: 'x', tracks: [{ title: '!!!' }] }, [{ ...one, title: '???' }])[0].selected, undefined);
  assert.equal(matchPlaylist({ name: 'x', tracks: [{ ...one, artist: '!!!' }] }, [{ ...one, artist: '???' }])[0].selected, undefined);
  assert.equal(matchPlaylist({ name: 'x', tracks: [{ ...one, album: '!!!' }] }, [{ ...one, album: '???' }])[0].selected, undefined);
});
test('10,000 repeated occurrences reuse indexed metadata and decisions instead of repeatedly scanning a shared title', () => {
  const reads = { title: 0, artist: 0, album: 0, duration: 0 };
  const songs = Array.from({ length: 20000 }, (_, index) => ({
    id: String(index),
    get title() { reads.title++; return one.title; },
    get artist() { reads.artist++; return `Artist ${index % 100}`; },
    get album() { reads.album++; return `Album ${index % 1000}`; },
    get duration() { reads.duration++; return index % 500; },
  }));
  const track = { title: one.title, artist: 'Artist 1', album: 'Album 1', duration: 1 };
  const rows = matchPlaylist({ name: 'x', tracks: Array.from({ length: 10000 }, () => track) }, songs);
  assert.equal(rows.length, 10000); assert.equal(rows[0].selected, undefined); assert.equal(rows[0].candidates.length, 20);
  assert.equal(rows[0].candidates, rows[9999].candidates);
  assert.deepEqual(reads, { title: songs.length, artist: songs.length, album: songs.length, duration: songs.length });
});
test('asynchronous matching yields to the event loop, reports completed occurrences and equals synchronous results', async () => {
  const songs = Array.from({ length: 5000 }, (_, index) => ({ ...one, id: String(index), duration: index / 100 }));
  const playlist = { name: 'x', tracks: [{ ...one, duration: 20 }, { ...one, duration: 40 }] };
  let eventLoopRan = false;
  const timer = setTimeout(() => { eventLoopRan = true; }, 0);
  const progress: number[] = [];
  const result = await matchPlaylistAsync(playlist, songs, { onProgress: (processed, total) => { assert.equal(total, 2); progress.push(processed); } });
  clearTimeout(timer);
  assert.equal(eventLoopRan, true); assert.deepEqual(result, matchPlaylist(playlist, songs));
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 2);
});
test('asynchronous matching cancels while indexing, during a large duration sort and before publishing the final result', async () => {
  let reads = 0, current = true;
  const songs = Array.from({ length: 5000 }, (_, index) => ({ ...one, id: String(index), get title() { reads++; return one.title; } }));
  const playlist = { name: 'x', tracks: [one] };
  const indexing = matchPlaylistAsync(playlist, songs, { isCurrent: () => current });
  setTimeout(() => { current = false; }, 0);
  await assert.rejects(indexing, /matching cancelled/);
  assert.ok(reads < songs.length, 'cancellation must stop reading the remaining catalogue');

  current = true;
  const sortable = Array.from({ length: 5000 }, (_, index) => ({ ...one, id: String(index), duration: 5000 - index }));
  Object.defineProperty(sortable.at(-1)!, 'duration', { get() {
    setTimeout(() => { current = false; }, 0); return 1;
  } });
  await assert.rejects(matchPlaylistAsync(playlist, sortable, { isCurrent: () => current }), /matching cancelled/);

  current = true;
  await assert.rejects(matchPlaylistAsync(playlist, [one], { isCurrent: () => current,
    onProgress: (processed) => { if (processed) current = false; } }), /matching cancelled/);
  await assert.rejects(matchPlaylistAsync(playlist, [one], { isCurrent: () => false }), /matching cancelled/);
});
