import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

import type { Song } from '../src/api/subsonic';
import { personalPlayCount, selectFrequentlyPlayedSongs, songMatchesFrequentArtist } from '../src/lib/frequentlyPlayed';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const song = (id: string, playCount?: number): Song => ({ id, title: id, artist: 'Singer', artistId: 'artist', playCount });

test('personal history uses the strongest observed count without double-counting a synchronized offline listen', () => {
  assert.equal(personalPlayCount(song('A', 8), { A: 8 }), 8);
  assert.equal(personalPlayCount(song('A', 8), { A: 10 }), 10);
  assert.equal(personalPlayCount(song('A', 12), { A: 10 }), 12);
  assert.equal(personalPlayCount(song('A', Number.NaN), { A: 2 }), 2);
  assert.equal(personalPlayCount(song('A', -1), { A: Infinity }), 0);
});

test('unplayed, invalid and unavailable tracks never become personal favorites just because the server ranks them first', () => {
  const songs = [song('global-first'), song('zero', 0), song('negative', -3), song('invalid', Infinity),
    { ...song('missing', 100), unavailable: true }, song('offline'), song('played', 2)];
  assert.deepEqual(selectFrequentlyPlayedSongs(songs, { offline: 3 }).map((item) => item.id), ['offline', 'played']);
  assert.deepEqual(selectFrequentlyPlayedSongs(songs.slice(0, 5)), []);
});

test('the bounded list deduplicates identities, uses stable ties and retains the actual playable song records', () => {
  const a = song('A', 5), b = song('B', 5), c = song('C', 9), newerA = { ...a, title: 'Updated A', playCount: 10 };
  const input = Object.freeze([b, a, c, song('D', 4), song('E', 3), song('F', 2), newerA]);
  const result = selectFrequentlyPlayedSongs(input);
  assert.deepEqual(result.map((item) => item.id), ['A', 'C', 'B', 'D', 'E']);
  assert.equal(result[0], newerA);
  assert.equal(result[1], c);
  assert.deepEqual(selectFrequentlyPlayedSongs([b, a]).map((item) => item.id), ['A', 'B']);
  assert.deepEqual(selectFrequentlyPlayedSongs([a, b]).map((item) => item.id), ['A', 'B']);
  assert.equal(selectFrequentlyPlayedSongs(input, {}, 20).length, 5);
  assert.deepEqual(selectFrequentlyPlayedSongs(input, {}, 0), []);
  assert.deepEqual(input.map((item) => item.id), ['B', 'A', 'C', 'D', 'E', 'F', 'A']);
});

test('artist history follows explicit performing identities and does not borrow a namesake or producer history', () => {
  assert.equal(songMatchesFrequentArtist(song('solo', 2), 'artist', 'Singer'), true);
  assert.equal(songMatchesFrequentArtist(song('namesake', 2), 'other', 'Singer'), false);
  assert.equal(songMatchesFrequentArtist({ ...song('duet'), artists: [{ id: 'guest', name: 'Guest' }] }, 'guest', 'Guest'), true);
  assert.equal(songMatchesFrequentArtist({ ...song('album'), albumArtists: [{ id: 'band', name: 'Band' }] }, 'band', 'Band'), true);
  assert.equal(songMatchesFrequentArtist({ ...song('remix'), contributors: [{ role: 'remixer', artist: { id: 'remixer', name: 'Remixer' } }] }, 'remixer', 'Remixer'), true);
  assert.equal(songMatchesFrequentArtist({ ...song('credit'), contributors: [{ role: 'producer', artist: { id: 'producer', name: 'Producer' } }] }, 'producer', 'Producer'), false);
  assert.equal(songMatchesFrequentArtist({ id: 'legacy', title: 'Legacy', artist: '  Ｓｉｎｇｅｒ ' }, 'artist', 'singer'), true);
  assert.equal(songMatchesFrequentArtist({ id: 'no-credit', title: 'No credit' }, 'artist', ''), false);
});

/** Execute the real section and React effects, leaving native row rendering and
 * the stores at explicit boundaries. Retaining an old row callback reproduces
 * TrackRow's memo behavior without replacing the section's queue logic. */
function sectionHarness() {
  const calls: { songs: Song[]; index: number; name: string; href: string }[] = [];
  const playQueue = async (songs: Song[], index: number, name: string, href: string) => {
    calls.push({ songs, index, name, href });
  };
  const palette = { text: '#ffffff' };
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { Text: 'text', View: 'view', StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 } },
    '@/i18n': { useT: () => (key: string) => key },
    '@/lib/frequentlyPlayed': { selectFrequentlyPlayedSongs },
    '@/store/playCounts': { usePlayCounts: (select: (state: unknown) => unknown) => select({ counts: {} }) },
    '@/store/player': {
      currentSong: (state: { current?: Song }) => state.current,
      usePlayerStore: (select: (state: unknown) => unknown) => select({ current: song('A', 10), playQueue }),
    },
    '@/theme': { colors: { text: '#fff', surface: '#222', surfaceHighlight: '#333' }, useTheme() {} },
    './TrackRow': { TrackRow: 'track-row' },
    './volta/ArtistPagePalette': { useArtistPagePalette: () => palette },
  };
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/components/FrequentlyPlayedSection.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected frequently played import ${name}`);
    return imports[name];
  } });
  const render = (songs: Song[], sourceName = 'Singer') => React.createElement(exports.FrequentlyPlayedSection, {
    songs, sourceName, sourceHref: '/artist/artist',
  });
  return { render, calls };
}

test('a retained callback from an unmoved row plays the latest complete queue and current source', async () => {
  const h = sectionHarness(); let renderer!: ReactTestRenderer;
  const a = song('A', 10), b = song('B', 5), c = song('C', 7);
  try {
    await act(async () => { renderer = create(h.render([a, b])); });
    const before = renderer.root.findAll((node) => String(node.type) === 'track-row')[0].props;
    const retainedPress = before.onPress;
    assert.equal(before.song, a); assert.equal(before.serverIndex, 0); assert.equal(before.isCurrent, true);
    await act(async () => { renderer.update(h.render([a, c], 'Updated Singer')); });
    const after = renderer.root.findAll((node) => String(node.type) === 'track-row')[0].props;
    assert.equal(after.song, a); assert.equal(after.serverIndex, before.serverIndex);
    assert.equal(after.rowOccurrenceKey, before.rowOccurrenceKey);
    await act(async () => { retainedPress(); });
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0].songs.map((item) => item.id), ['A', 'C']);
    assert.equal(h.calls[0].songs[0], a);
    assert.equal(h.calls[0].index, 0);
    assert.equal(h.calls[0].name, 'Updated Singer');
    assert.equal(h.calls[0].href, '/artist/artist');
    await act(async () => { renderer.update(h.render([c])); });
    const committedCount = h.calls.length;
    await act(async () => { retainedPress(); });
    assert.equal(h.calls.length, committedCount, 'a row removed from the queue cannot play a different song');
    await act(async () => { renderer.unmount(); });
    await act(async () => { retainedPress(); });
    assert.equal(h.calls.length, committedCount, 'an unmounted section cannot keep playing its old queue');
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('a section with no personal history renders no placeholder list or global-popularity substitutes', async () => {
  const h = sectionHarness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render([song('first'), song('second', 0)])); });
    assert.equal(renderer.toJSON(), null);
    assert.equal(h.calls.length, 0);
  } finally { await act(async () => { renderer?.unmount(); }); }
});
