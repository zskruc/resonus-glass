import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStore } from 'zustand';
import ts from 'typescript';
import { formatDuration } from '../src/lib/format';
import { episodePlayed, episodeResumeAt } from '../src/lib/episodeResume';
import { primuseAlbumLayout } from '../src/lib/primuseAlbumLayout';
import { buildPrimuseAlbumPalette } from '../src/lib/primuseAlbumPalette';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function load(file: string, imports: Record<string, unknown>, values: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, ...values, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } }); return exports;
}
const native = { View: 'View', Text: 'Text', Pressable: 'Button', ScrollView: 'ScrollView', StyleSheet: { create: (value: any) => value, hairlineWidth: .5 } };
const t = (key: string, args: Record<string, unknown> = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(args[name]));
const shared: Record<string, unknown> = { react: React, 'react/jsx-runtime': JSXRuntime, 'react-native': native,
  '@/components/Cover': { Cover: 'Cover' }, '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/i18n': { useT: () => t } };

test('the shared Primuse identity header keeps original album play/shuffle while a podcast supplies its own actions and cover events', async () => {
  const displays: string[] = [], calls: string[] = [];
  const Header = load('../src/components/primuse/PrimuseAlbumHeader.tsx', { ...shared,
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' } }, 'expo-router': { Link: 'Link' },
    '@/components/ExplicitBadge': { ExplicitBadge: 'ExplicitBadge' }, './PrimuseAlbumScene': { usePrimuseAlbumScene: () => ({ coverDisplayed: () => calls.push('display') }) },
  }).PrimuseAlbumHeader;
  const props = { title: 'Podcast', subtitle: 'Author', coverUri: 'file:///show.jpg', description: 'Long description',
    layout: primuseAlbumLayout(400, 900, 24, 20), palette: buildPrimuseAlbumPalette('#4466aa', false), disabled: false,
    showPause: false, shuffleActive: false, onPlay: () => calls.push('play'), onShuffle: () => calls.push('shuffle'),
    onArtworkLoad: (uri: string) => displays.push(uri), onArtworkError() {}, onTitleLayout() {}, onLayout() {}, nameStyle: {} };
  let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(Header, props)); });
    await act(async () => { root.root.findByProps({ accessibilityLabel: 'Play' }).props.onPress(); root.root.findByProps({ accessibilityLabel: 'Shuffle' }).props.onPress(); });
    assert.deepEqual(calls, ['play', 'shuffle']);
    await act(async () => { root.update(React.createElement(Header, { ...props, actions: React.createElement('PodcastActions') })); });
    assert.equal(root.root.findAllByProps({ accessibilityLabel: 'Shuffle' }).length, 0);
    assert.equal(root.root.findAllByType('PodcastActions' as any).length, 1);
    assert.equal(root.root.findByType('Cover' as any).props.size, 190);
    await act(async () => { root.root.findByType('Cover' as any).props.onImageDisplay('file:///show.jpg'); });
    assert.deepEqual(displays, ['file:///show.jpg']); assert.equal(calls.at(-1), 'display');
    const description = root.root.findByProps({ accessibilityLabel: 'Show more' });
    await act(async () => { description.props.onPress(); });
    assert.ok(root.root.findByProps({ accessibilityLabel: 'Show less' }));
  } finally { await act(async () => root?.unmount()); }
});

test('the actual podcast episode row shows saved and live progress with separate play, notes and menu actions', async () => {
  const source = ts.createSourceFile('library.ts', readFileSync(new URL('../src/lib/podcastLibrary.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'podcastListeningState')!;
  const policy: Record<string, any> = {};
  runInNewContext(ts.transpileModule(fn.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: policy, episodePlayed, episodeResumeAt });
  const player = createStore<any>(() => ({ song: null, positionSec: 0 }));
  const Row = load('../src/components/podcast/PodcastEpisodeRow.tsx', { ...shared,
    '@/api/podcasts': { podcastCover: (channel: any) => channel.imageUrl },
    '@/components/primuse/PrimuseTrackPanelRow': { PrimuseTrackPanelRow: 'Panel' }, '@/lib/format': { formatDuration },
    '@/lib/podcastLibrary': policy, '@/store/player': { usePlayerStore: player, currentSong: (state: any) => state.song },
  }).PodcastEpisodeRow;
  const calls: string[] = []; let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(Row, { episode: { id: 'rss/id', title: 'Episode', duration: 600 },
      palette: buildPrimuseAlbumPalette('#4466aa', true), saved: { positionSec: 200, durationSec: 600 }, first: true, last: true, language: 'en',
      downloaded: true, unavailable: false, onPlay: () => calls.push('play'), onDetails: () => calls.push('notes'), onMenu: () => calls.push('menu') })); });
    assert.match(JSON.stringify(root.toJSON()), /6:40 left/);
    assert.equal(root.root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityValue.now, 33);
    await act(async () => { player.setState({ song: { id: 'rss/id' }, positionSec: 300 }); });
    assert.match(JSON.stringify(root.toJSON()), /5:00 left/);
    assert.equal(root.root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityValue.now, 50);
    await act(async () => {
      root.root.findByProps({ accessibilityLabel: 'Continue playing' }).props.onPress();
      root.root.findByProps({ accessibilityLabel: 'Episode details' }).props.onPress(); root.root.findByProps({ accessibilityLabel: 'More' }).props.onPress();
    });
    assert.deepEqual(calls, ['play', 'notes', 'menu']);
  } finally { await act(async () => root?.unmount()); }
});
