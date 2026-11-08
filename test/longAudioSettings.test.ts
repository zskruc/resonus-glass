import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStore } from 'zustand';
import ts from 'typescript';
import { canRememberLongAudio, longAudioEntry, longAudioResumePosition, LONG_AUDIO_BOOKMARK_LIMIT } from '../src/lib/longAudio';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const source = ts.transpileModule(readFileSync(new URL('../src/app/settings/long-audio.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test('the actual long-audio screen opts in, passes a bookmark note and position, selects saved audio, and hides old-account data', async () => {
  const song = { id: 'A-song', title: 'Current ASMR', artist: 'Voice A', duration: 900 };
  const savedSong = { id: 'saved', title: 'Saved concert', artist: 'Band', duration: 3600 };
  const auth = createStore(() => ({ auth: { id: 'A' }, offlineSource: null }));
  const player = createStore(() => ({ queue: [song], index: 0, positionSec: 123 }));
  const calls: { action: string; scope?: string; songId?: string; enabled?: boolean; seconds?: number; note?: string }[] = [];
  const loaded: string[] = [], cleared: number[] = [], scrolls: unknown[] = [];
  const data = createStore<Record<string, any>>(() => ({ profile: 'A', hydrated: true, error: false,
    entries: { [song.id]: longAudioEntry(song), [savedSong.id]: { ...longAudioEntry(savedSong), positionSec: 420 } },
    load: async (scope: string) => { loaded.push(scope); }, retry: async () => true,
    setEnabled: async (scope: string, value: typeof song, enabled: boolean) => {
      calls.push({ action: 'enabled', scope, songId: value.id, enabled });
      data.setState((state) => ({ entries: { ...state.entries, [value.id]: { ...state.entries[value.id], enabled } } }));
      return true;
    },
    addBookmark: async (scope: string, value: typeof song, seconds: number, note: string) => {
      calls.push({ action: 'bookmark', scope, songId: value.id, seconds, note }); return true;
    },
    removeBookmark: async () => true, resetPosition: async () => true, forget: async () => true,
  }));
  const target = { getState: () => ({ scope: 'A', session: 7, song, clear: (session: number) => cleared.push(session) }) };
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSX, 'react-native': { Text: 'text' },
    '@/components/DockScrollView': { DockScrollView: 'scroll-view' }, '@/components/Dialog': { Dialog: 'dialog' },
    '@/components/SettingsUI': { SettingsPage: 'settings-page', SettingsGroup: 'settings-group', Field: 'field', SettingRow: 'setting-row',
      SwitchList: 'switch-list', TextRow: 'text-row', settingsStyles: { content: {}, sectionDescription: {}, sectionTitle: {} } },
    '@/i18n': { useT: () => (key: string) => key },
    '@/hooks/useLongAudioPlayback': { playLongAudioAt: async () => true },
    '@/lib/format': { formatDuration: (seconds?: number) => String(seconds ?? 0) },
    '@/lib/longAudio': { canRememberLongAudio, longAudioResumePosition, LONG_AUDIO_BOOKMARK_LIMIT },
    '@/store/auth': { useAuthStore: auth }, '@/store/longAudio': { useLongAudio: data, longAudioScope: () => auth.getState().auth.id },
    '@/store/longAudioTarget': { useLongAudioTarget: target },
    '@/store/player': { usePlayerStore: player, currentSong: (state: ReturnType<typeof player.getState>) => state.queue[state.index] },
    '@/store/toast': { useToast: { getState: () => ({ show: () => assert.fail('The successful flow must not display an error') }) } },
    '@/theme': { useTheme: () => ({}) },
  };
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in imports, name); return imports[name]; } });
  let renderer!: ReactTestRenderer;
  const rows = (label: string) => renderer.root.findAll((node) => node.type === 'setting-row' as any && node.props.label === label);
  try {
    await act(async () => { renderer = create(React.createElement(exports.default), {
      createNodeMock: (element) => element.type === 'scroll-view' as any ? { scrollTo: (value: unknown) => scrolls.push(value) } : {},
    }); });
    assert.deepEqual(loaded, ['A']);
    const toggle = renderer.root.findByType('switch-list' as any).props.options[0];
    assert.equal(toggle.value, false);
    await act(async () => { toggle.onChange(true); });
    assert.deepEqual(calls[0], { action: 'enabled', scope: 'A', songId: song.id, enabled: true });
    await act(async () => { renderer.root.findByType('text-row' as any).props.onChange('雨声细节'); });
    await act(async () => { rows('Bookmark current position')[0].props.onPress(); });
    assert.deepEqual(calls[1], { action: 'bookmark', scope: 'A', songId: song.id, seconds: 123, note: '雨声细节' });
    assert.equal(renderer.root.findByType('text-row' as any).props.value, '');
    await act(async () => { rows('Saved concert')[0].props.onPress(); });
    assert.ok(renderer.root.findAll((node) => node.type === 'field' as any && node.props.label === 'Song').some((node) => node.props.value === 'Saved concert'));
    assert.deepEqual(JSON.parse(JSON.stringify(scrolls)), [{ y: 0, animated: true }]);
    assert.equal(rows('Bookmark current position')[0].props.onPress, undefined, 'another playing song must not create this saved recording’s bookmark');
    // B's metadata has not hydrated yet: deliberately leave the repository snapshot on A.
    await act(async () => { auth.setState({ auth: { id: 'B' } }); });
    assert.equal(renderer.root.findAllByType('field' as any).length, 0);
    assert.equal(rows('Current ASMR').length, 0); assert.equal(rows('Saved concert').length, 0);
    assert.equal(renderer.root.findAllByType('switch-list' as any).length, 0);
    assert.ok(loaded.includes('B'));
  } finally { await act(async () => { renderer?.unmount(); }); }
  assert.deepEqual(cleared, [7]);
});
