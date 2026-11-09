import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import * as editing from '../src/lib/lyricEditing';
import * as exporting from '../src/lib/lyricsExport';
import * as fonts from '../src/lib/lyricFonts';
import { lyricRecordingKey } from '../src/lib/lyricDocuments';

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
  const Screen = load('../src/app/lyric-editor.tsx', { ...shared,
    'react-native-reanimated': { __esModule: true, default: { FlatList: ({ data, renderItem, ListHeaderComponent }: any) => React.createElement('List', {}, ListHeaderComponent, ...data.map((item: any, index: number) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index })))) } },
    'expo-file-system/legacy': { cacheDirectory: 'file:///cache/', makeDirectoryAsync: async () => {}, writeAsStringAsync: async (uri: string, body: string) => { files.push({ uri, body }); }, deleteAsync: async () => {} },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (uri: string) => { shares.push(uri); } },
    '@/hooks/useLyricToolSong': { useLyricToolSong: () => ({ song, profile: 'A' }) },
    '@/hooks/useLyrics': { useLyrics: () => ({ sourceLyrics: source, unshiftedLyrics: source, localEdit: { base: source }, localEditPending: false, customizationScope: scope }) },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => () => {} },
    '@/lib/lyricDocuments': { lyricRecordingKey }, '@/lib/lyricEditing': editing, '@/lib/lyricsExport': exporting,
    '@/lib/localCustomizations': { captureCustomizationOwner: (_scope: unknown, extra: () => boolean) => () => current && extra(), writeLocalCustomization: async (...args: any[]) => { if (args.at(-1)()) writes.push(args); } },
    '@/store/lyricOffsets': { useLyricOffsets: { getState: () => ({ offsets: { s: 500 } }) } }, '@/store/toast': { useToast: { getState: () => ({ show() {} }) } },
  }).default;
  return { Screen, song, source, writes, files, shares, leave: () => { current = false; } };
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
