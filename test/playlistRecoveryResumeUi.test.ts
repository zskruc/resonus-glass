import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import * as models from '../src/lib/personalBackupModels';
import * as insert from '../src/lib/playlistRecoveryInsert';
import type { Song } from '../src/api/subsonic';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
test('actual recovery screen journals before insertion and offers resume after a disk failure without sending another insert', async () => {
  const a: Song = { id: 'a', title: 'A' }, recovered: Song = { id: 'new', title: 'Recovered', artist: 'Artist' };
  let songs = [a], records: models.RecoveryPlaylist = { key: 'list', playlistId: 'list', name: 'List', updatedAt: 1, entries: [
    { key: 'a', track: { title: 'A' }, songId: 'a' }, { key: 'lost', track: { title: 'Recovered', artist: 'Artist' } },
  ] }, journal: unknown, fail = false, inserts = 0;
  const owner = { profile: 'A', source: 'server', library: 'test', current: () => true, check() {} };
  const t = (key: string) => key, palette = { text: '#fff', textSecondary: '#ddd', textMuted: '#999', danger: '#f66', border: '#555' };
  const List = ({ data, renderItem, ListHeaderComponent }: any) => React.createElement('List', {}, ListHeaderComponent,
    ...data.map((item: any, index: number) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))));
  const exports: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSXRuntime, 'react-native': { Text: 'Text', TextInput: 'Input', Pressable: 'Button', ActivityIndicator: 'Spinner', FlatList: List },
    'react-native-reanimated': { __esModule: true, default: { createAnimatedComponent: (value: unknown) => value } },
    'expo-router': { useLocalSearchParams: () => ({ playlistId: 'list' }), useRouter: () => ({ push() {} }) },
    '@/api/data': { getPlaylist: async () => ({ playlist: { id: 'list', name: 'List', songCount: songs.length }, songs }), getPlaylistForEditing: async () => ({ playlist: { id: 'list', name: 'List' }, songs }),
      insertRecoveredPlaylistTracks: async (_id: string, _rows: unknown, before: string[]) => {
        assert.ok(journal, 'intent is durably accepted before the playlist mutation'); assert.deepEqual(before, ['a']); inserts++; songs = [a, recovered]; return songs;
      }, star: async () => {}, setRating: async () => {} },
    '@/components/SettingsUI': { SettingsPage: 'Page', SettingRow: 'Row', settingsStyles: { content: {} } },
    '@/components/SheetModal': { SheetModal: () => null }, '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => () => {} },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 0 }, '@/i18n': { useT: () => t },
    '@/lib/musicToolsCatalog': { readMusicCatalog: async () => ({ songs: [a, recovered] }) },
    '@/lib/personalBackupModels': models, '@/lib/playlistRecoveryInsert': insert,
    '@/store/playlistRecovery': { personalOwner: () => owner, readRecoveryPlaylist: async () => records, exportPlaylistRecovery: async () => [records], wholeLibraryReadError: () => undefined,
      saveRecoveryPlaylist: async (next: models.RecoveryPlaylist) => { if (fail) { fail = false; throw new Error('Disk full'); } records = next; } },
    '@/store/playlistRecoveryJournal': { readRecoveryJournal: async () => journal, saveRecoveryJournal: async (_key: string, value: unknown) => { journal = JSON.parse(JSON.stringify(value)); }, deleteRecoveryJournal: async () => { journal = undefined; } },
    '@/lib/query': { queryClient: { invalidateQueries: async () => {} } }, '@/theme': { colors: palette, themed: (fn: any) => fn(palette), useTheme() {} },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/settings/playlist-recovery.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Date, setTimeout, clearTimeout, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(exports.default)); });
    await act(async () => { root.root.findByProps({ label: 'Scan library for missing tracks' }).props.onPress(); });
    assert.equal(root.root.findByProps({ label: 'Restore selected matches in place' }).props.right, '1'); fail = true;
    await act(async () => { root.root.findByProps({ label: 'Restore selected matches in place' }).props.onPress(); });
    assert.equal(inserts, 1); assert.ok(journal); assert.equal(records.entries.find((entry) => entry.key === 'lost')!.songId, undefined);
    await act(async () => { root.root.findByProps({ label: 'Resume interrupted recovery' }).props.onPress(); });
    assert.equal(inserts, 1); assert.equal(journal, undefined); assert.equal(records.entries.find((entry) => entry.key === 'lost')!.songId, 'new');
  } finally { await act(async () => root?.unmount()); }
});
