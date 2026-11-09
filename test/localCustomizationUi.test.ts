import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import * as editing from '../src/lib/lyricEditing';
import * as exporting from '../src/lib/lyricsExport';
import * as fonts from '../src/lib/lyricFonts';
import { lyricRecordingKey } from '../src/lib/lyricDocuments';
import * as metadata from '../src/lib/localMetadata';
import * as models from '../src/lib/localCustomizationModels';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function load(file: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, Math, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } }); return exports;
}
const t = (key: string, args: Record<string, unknown> = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(args[name]));
const palette = { text: '#fff', textSecondary: '#ddd', textMuted: '#aaa', surface: '#222', surfaceHighlight: '#333', accent: '#f05' };
const theme = { colors: palette, fontSize: { md: 16, sm: 12, lg: 22 }, spacing: { sm: 4, md: 8, lg: 16 }, themed: (fn: any) => fn(palette), useTheme() {} };
const native = { Text: 'Text', TextInput: 'Input', View: 'View' };
const shared = { react: React, 'react/jsx-runtime': JSXRuntime, 'react-native': native, '@/theme': theme,
  '@/components/SettingsUI': { SettingRow: 'Row', SettingsGroup: 'Group', SettingsPage: 'Page', SelectList: 'Select', settingsStyles: { content: {} } },
  '@/components/glass': { GlassPressable: 'Button' }, '@/i18n': { useT: () => t } };
function editorHarness() {
  const song = { id: 's', title: 'Song', artist: 'Artist', duration: 30 };
  const source = { synced: true, lines: [{ start: 1000, value: 'Hello', translation: '你好', words: [{ start: 1000, end: 2000, value: 'Hello' }] }, { start: 3000, value: 'Next' }] };
  const scope = { profile: 'A', source: 'server' }, writes: any[] = [], files: { uri: string; body: string }[] = [], shares: string[] = [];
  let current = true;
  let target: typeof song | null = song;
  const Screen = load('../src/app/lyric-editor.tsx', { ...shared,
    'react-native-reanimated': { __esModule: true, default: { FlatList: ({ data, renderItem, ListHeaderComponent, ...props }: any) => React.createElement('List', props, ListHeaderComponent, ...data.map((item: any, index: number) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index })))) } },
    'expo-file-system/legacy': { cacheDirectory: 'file:///cache/', makeDirectoryAsync: async () => {}, writeAsStringAsync: async (uri: string, body: string) => { files.push({ uri, body }); }, deleteAsync: async () => {} },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (uri: string) => { shares.push(uri); } },
    '@/hooks/useLyricToolSong': { useLyricToolSong: () => ({ song: target, profile: 'A' }) },
    '@/hooks/useLyrics': { useLyrics: () => ({ sourceLyrics: source, unshiftedLyrics: source, localEdit: { base: source }, localEditPending: false, customizationScope: scope }) },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => () => {} },
    '@/lib/lyricDocuments': { lyricRecordingKey }, '@/lib/lyricEditing': editing, '@/lib/lyricsExport': exporting,
    '@/lib/localCustomizations': { captureCustomizationOwner: (_scope: unknown, extra: () => boolean) => () => current && extra(), writeLocalCustomization: async (...args: any[]) => { if (args.at(-1)()) writes.push(args); } },
    '@/store/lyricOffsets': { useLyricOffsets: { getState: () => ({ offsets: { s: 500 } }) } }, '@/store/toast': { useToast: { getState: () => ({ show() {} }) } },
  }).default;
  return { Screen, song, source, writes, files, shares, leave: () => { current = false; }, invalidateTarget: () => { target = null; } };
}
function input(root: ReactTestRenderer, label: string) {
  const text = root.root.findAllByType('Text' as any).find((node) => node.props.children === label)!;
  return text.parent!.findByType('Input' as any);
}
function button(root: ReactTestRenderer, label: string) {
  const text = root.root.findAllByType('Text' as any).find((node) => node.props.children === label)!;
  return text.parent!;
}

test('the actual editor applies translation and timed-word changes, persists a reversible full document and exports only the explicit timeline', async () => {
  const h = editorHarness(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    assert.equal(input(root, 'Original text').props.editable, false);
    await act(async () => { input(root, 'Translation').props.onChangeText('译文修正'); });
    await act(async () => { button(root, 'Apply line').props.onPress(); });
    await act(async () => { input(root, 'Word text').props.onChangeText('Hi'); });
    await act(async () => { button(root, 'Apply word').props.onPress(); });
    await act(async () => { root.root.findByProps({ label: 'Save local lyrics' }).props.onPress(); });
    assert.equal(h.writes.length, 1); const edit = h.writes[0][3];
    assert.equal(edit.lyrics.lines[0].translation, '译文修正'); assert.equal(edit.lyrics.lines[0].value, 'Hi');
    assert.deepEqual(JSON.parse(JSON.stringify(edit.lyrics.lines[0].words)), [{ start: 1000, end: 2000, value: 'Hi' }]);
    assert.equal(h.source.lines[0].value, 'Hello'); assert.equal(edit.base, h.source);
    await act(async () => { root.root.findByProps({ label: 'Export lyrics' }).props.onPress(); });
    assert.equal(h.shares.length, 1); assert.match(h.files[0].body, /\[00:01\.000\]/);
    await act(async () => { root.root.findByProps({ label: 'Export timeline' }).props.onChange('display'); });
    await act(async () => { root.root.findByProps({ label: 'Export lyrics' }).props.onPress(); });
    assert.match(h.files[1].body, /\[00:01\.500\]/);
    await act(async () => { root.root.findByProps({ label: 'Restore original source' }).props.onPress(); });
    assert.equal(h.writes.at(-1)[3], undefined);
  } finally { await act(async () => root?.unmount()); }
});

test('the actual editor will not write or share through a stale owner callback after an account change', async () => {
  const h = editorHarness(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    const save = root.root.findByProps({ label: 'Save local lyrics' }).props.onPress, share = root.root.findByProps({ label: 'Export lyrics' }).props.onPress;
    h.leave(); await act(async () => { save(); }); await act(async () => { share(); });
    assert.equal(h.writes.length, 0); assert.equal(h.files.length, 0); assert.equal(h.shares.length, 0);
  } finally { await act(async () => root?.unmount()); }
});

test('actual lyric typography creates only nested native text runs and preserves a parent weight/size for mixed scripts', async () => {
  const typography = load('../src/components/LyricsTypography.tsx', { ...shared,
    react: { ...React, useContext: () => ({ preferences: { version: 1, fonts: { japanese: 'serif', latin: 'monospace' } }, custom: null }) },
    '@tanstack/react-query': {}, 'expo-font': {}, '@/lib/lyricFonts': fonts,
    '@/lib/localCustomizations': {}, '@/lib/localCustomizationModels': {}, '@/store/auth': {}, '@/store/settings': {}, '@/hooks/useLocalMetadata': {},
  });
  let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement('Text', { style: { fontSize: 28, fontWeight: '600' } },
      React.createElement(typography.LyricFontText, { text: 'Hello 世界', context: 'Hello 世界 こんにちは' }))); });
    const text = root.root.findAllByType('Text' as any);
    assert.equal(text[0].props.style.fontWeight, '600'); assert.equal(text[0].props.style.fontSize, 28);
    assert.equal(text[1].props.style.fontFamily, 'monospace'); assert.equal(text[2].props.style.fontFamily, 'serif');
    assert.ok(text.slice(1).every((node) => !('fontWeight' in node.props.style) && !('fontSize' in node.props.style)));
    assert.equal(JSON.stringify(root.toJSON()).includes('世界'), true);
  } finally { await act(async () => root?.unmount()); }
});

test('the actual lyric editor retains the same input while typing and does not expose an invalidated target draft', async () => {
  const h = editorHarness(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    const original = input(root, 'Translation');
    assert.equal(root.root.findByType('List' as any).props.keyboardShouldPersistTaps, 'handled');
    for (const value of ['修', '修正', '修正译文']) {
      await act(async () => { input(root, 'Translation').props.onChangeText(value); });
      assert.equal(input(root, 'Translation'), original, 'the header input is reconciled, not remounted per character');
      assert.equal(original.props.value, value);
    }
    h.invalidateTarget(); await act(async () => { root.update(React.createElement(h.Screen)); });
    assert.equal(root.root.findAllByType('Input' as any).length, 0);
    assert.equal(root.root.findAllByProps({ label: 'Save local lyrics' }).length, 0);
  } finally { await act(async () => root?.unmount()); }
});

function metadataHarness() {
  const song = { id: 's', title: 'Source title', artist: 'Source artist', album: 'Source album', year: 2000 };
  const scope = { profile: 'A', source: 'server' }, writes: any[] = [], notices: string[] = [];
  const store = createStore<any>(() => ({ scope: 'A|server', ready: true, songs: {}, aliases: [], error: false, hydrate: async () => {} }));
  const useStore = Object.assign(() => React.useSyncExternalStore(store.subscribe, store.getState), { getState: store.getState });
  let epoch = 0, pause: (() => Promise<void>) | undefined;
  const Screen = load('../src/app/song-metadata.tsx', { ...shared,
    '@/components/DockScrollView': { DockScrollView: 'Scroll' }, '@/hooks/useLyricToolSong': { useLyricToolSong: () => ({ song }) },
    '@/hooks/useLocalMetadata': { useDisplaySong: (value: typeof song) => metadata.applySongDisplay(value, useStore().songs, []) },
    '@/lib/localCustomizationModels': models, '@/lib/localMetadata': metadata,
    '@/lib/localCustomizations': { customizationScope: () => scope,
      captureCustomizationOwner: (_scope: unknown, extra: () => boolean) => { const at = epoch; return () => at === epoch && extra(); },
      writeLocalCustomization: async (...args: any[]) => {
        if (pause) { const pending = pause; pause = undefined; await pending(); }
        if (!args.at(-1)()) throw new Error('Owner changed');
        writes.push(args); store.setState({ songs: args[3] ? { [song.id]: args[3] } : {} });
      } },
    '@/store/localMetadata': { useLocalMetadata: useStore, scopeKey: () => 'A|server' },
    '@/store/toast': { useToast: { getState: () => ({ show: (value: string) => { notices.push(value); } }) } },
  }).default;
  return { Screen, song, writes, notices, store, changeOwner: () => { epoch++; }, gate: (work: () => Promise<void>) => { pause = work; } };
}
test('the actual metadata editor retains focused input identity, saves a display-only patch, and restores the source', async () => {
  const h = metadataHarness(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    const original = input(root, 'Title');
    assert.equal(root.root.findByType('Scroll' as any).props.keyboardShouldPersistTaps, 'handled');
    for (const value of ['N', 'Ne', 'New title']) {
      await act(async () => { input(root, 'Title').props.onChangeText(value); }); assert.equal(input(root, 'Title'), original);
    }
    await act(async () => { root.root.findByProps({ label: 'Save local corrections' }).props.onPress(); });
    assert.equal(h.writes[0][3].patch.title, 'New title'); assert.equal(h.writes[0][3].original.title, 'Source title');
    assert.equal(h.song.title, 'Source title'); assert.equal(h.writes[0][2], h.song.id);
    await act(async () => { root.root.findByProps({ label: 'Restore original metadata' }).props.onPress(); });
    assert.equal(h.writes.at(-1)[3], undefined); assert.equal(input(root, 'Title').props.value, 'Source title');
  } finally { await act(async () => root?.unmount()); }
});
test('a metadata save invalidated while waiting releases busy without writing or toasting for the old owner', async () => {
  const h = metadataHarness(); let root!: ReactTestRenderer, release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; }); h.gate(() => waiting);
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    await act(async () => { input(root, 'Title').props.onChangeText('Local title'); });
    await act(async () => { root.root.findByProps({ label: 'Save local corrections' }).props.onPress(); });
    assert.equal(input(root, 'Title').props.editable, false);
    h.changeOwner(); await act(async () => { release(); });
    assert.equal(input(root, 'Title').props.editable, true, 'an obsolete operation must not leave the still-mounted page locked');
    assert.equal(h.writes.length, 0); assert.equal(h.notices.length, 0);
    await act(async () => { root.root.findByProps({ label: 'Save local corrections' }).props.onPress(); });
    assert.equal(h.writes.length, 1); assert.equal(h.notices.length, 1);
  } finally { await act(async () => root?.unmount()); }
});

test('the actual lyric-tool hook rejects a different local source while preserving server online/offline ownership', async () => {
  const song = { id: 's', title: 'Song' }, auth = createStore<any>(() => ({ auth: null, offline: true, offlineSource: { mode: 'folder', uris: ['one'] } }));
  const bound = Object.assign((selector: (value: any) => unknown) => selector(React.useSyncExternalStore(auth.subscribe, auth.getState)), { getState: auth.getState });
  const hook = load('../src/hooks/useLyricToolSong.ts', { react: React, '@/store/auth': { useAuthStore: bound, profileScopeId: () => auth.getState().auth ? 'server-A' : 'local' },
    '@/store/player': { currentSong: () => song, usePlayerStore: { getState: () => ({}) } },
    '@/store/lyricToolTarget': { useLyricToolTarget: { getState: () => ({ profile: auth.getState().auth ? 'server-A' : 'local', song, session: 1, clear() {} }) } },
  });
  let selected: typeof song | null = null, root!: ReactTestRenderer;
  function Probe() { selected = hook.useLyricToolSong().song; return null; }
  try {
    await act(async () => { root = create(React.createElement(Probe)); }); assert.equal(selected, song);
    await act(async () => { auth.setState({ offlineSource: { mode: 'folder', uris: ['two'] } }); }); assert.equal(selected, null);
    await act(async () => root.unmount());
    auth.setState({ auth: {}, offline: false, offlineSource: { mode: 'folder', uris: ['old-local'] } });
    await act(async () => { root = create(React.createElement(Probe)); }); assert.equal(selected, song);
    await act(async () => { auth.setState({ offline: true, offlineSource: { mode: 'device' } }); }); assert.equal(selected, song);
  } finally { await act(async () => root?.unmount()); }
});
