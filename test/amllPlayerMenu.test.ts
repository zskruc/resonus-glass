import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Song } from '@/api/subsonic';
import { useSongMenu } from '@/store/songMenu';

test('AMLL playback-mode menu actions remain opt-in and do not leak into later song-row or legacy-player sessions', () => {
  const song = { id: 'one', title: 'One' } as Song;
  const menu = useSongMenu.getState();
  menu.open(song, undefined, { playbackModes: true, queue: true });
  assert.equal(useSongMenu.getState().extras.playbackModes, true);
  menu.open({ ...song, id: 'row' });
  assert.equal(useSongMenu.getState().extras.playbackModes, false);
  menu.open(song, undefined, { playbackModes: true });
  menu.close();
  assert.ok(!useSongMenu.getState().extras.playbackModes);
  menu.open(song, undefined, { queue: true, devices: () => {} });
  assert.equal(useSongMenu.getState().extras.playbackModes, false);
  menu.close();
});

test('inline lyric callbacks belong only to the opening player and preserve the existing visibility flag', () => {
  const song = { id: 'one', title: 'One' } as Song;
  const menu = useSongMenu.getState();
  const inlineLyrics = () => {};
  menu.open(song, undefined, { showLyrics: true, lyrics: inlineLyrics });
  assert.equal(useSongMenu.getState().extras.lyrics, inlineLyrics);
  assert.equal(useSongMenu.getState().showLyrics, true);
  menu.open(song, undefined, { showLyrics: true });
  assert.equal(useSongMenu.getState().extras.lyrics, undefined, 'legacy player keeps its existing lyrics route');
  assert.equal(useSongMenu.getState().showLyrics, true);
  menu.open(song, undefined, { lyrics: inlineLyrics });
  assert.equal(useSongMenu.getState().showLyrics, false, 'a callback does not reveal lyrics for song-row menus');
  menu.close();
  assert.equal(useSongMenu.getState().extras.lyrics, undefined);
  assert.equal(useSongMenu.getState().showLyrics, false);
});
