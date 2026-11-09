import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { DiscoveryRepository, defaultDiscoveryPreferences } from '../src/lib/discoveryPreferences';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function load(source: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { exports, console, Math, Date, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return exports;
}
const flatten = (node: unknown): string => Array.isArray(node) ? node.map(flatten).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' && 'props' in node ? flatten((node as any).props.children) : '';
test('real organiser UI batch moves, tags, renames and deletes folders without changing subscription or station data; stale owner actions are rejected', async () => {
  let epoch = 0;
  const initial = defaultDiscoveryPreferences(); initial.folders = [{ id: 'one', name: 'Morning' }]; initial.tags = ['News'];
  initial.stations = [{ id: 'localradio:one', name: 'Radio one', streamUrl: 'https://radio.test/live' }, { id: 'localradio:two', name: 'Radio two', streamUrl: 'https://radio.test/other' }];
  const repository = new DiscoveryRepository({ current: () => 'A', owner: () => { const token = epoch; return () => token === epoch; }, read: async () => JSON.stringify(initial), write: async () => {}, remove: async () => {} });
  await repository.load();
  const List = ({ data, renderItem, ...props }: any) => React.createElement('List', props, data.map((item: any) => React.cloneElement(renderItem({ item }), { key: item.id })));
  const usePrefs = () => { const state = React.useSyncExternalStore(repository.subscribe, repository.getSnapshot); return { profile: 'A', loaded: state.loaded, data: state.data, change: (update: any) => repository.change('A', update) }; };
  const screen = load(readFileSync(new URL('../src/app/media-collections.tsx', import.meta.url), 'utf8'), {
    react: React, 'react/jsx-runtime': await import('react/jsx-runtime'), '@tanstack/react-query': { useQuery: () => ({ data: [] }) },
    'expo-router': { useLocalSearchParams: () => ({ kind: 'radio' }) }, 'react-native': { ActivityIndicator: 'Spinner', ScrollView: 'Scroll', Text: 'Text', TextInput: 'Input', View: 'View' },
    'react-native-reanimated': { __esModule: true, default: { FlatList: List } }, '@/api/backend': { getRadioStations: async () => [] }, '@/api/podcasts': { listAddedChannels: async () => [] },
    '@/components/SettingsUI': { SettingsPage: 'Page', settingsStyles: { sectionDescription: {} } }, '@/components/glass': { GlassPressable: 'Button' }, '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/store/discoveryPreferences': { useDiscoveryPreferences: usePrefs }, '@/store/auth': { useAuthStore: (select: any) => select({ auth: null, offline: true }) },
    '@/lib/lyricOwner': { captureLyricOwner: () => { const token = epoch; return () => token === epoch; } }, '@/i18n': { useT: () => (key: string) => key },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => () => {} }, '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 100 },
    '@/theme': { colors: { text: '#fff', surfaceHighlight: '#333', textSecondary: '#aaa', accent: '#0f0', textMuted: '#888' }, spacing: { lg: 20 } }, '@/lib/listPerf': { listPerf: {} },
  });
  let tree!: TestRenderer.ReactTestRenderer; await act(async () => { tree = TestRenderer.create(React.createElement(screen.default)); });
  const button = (name: string) => tree.root.findAllByType('Button' as any).find((node) => flatten(node.props.children) === name)!;
  await act(async () => { button('Select all').props.onPress(); });
  await act(async () => { button('Move to: Morning').props.onPress(); });
  await act(async () => { button('+ #News').props.onPress(); });
  assert.deepEqual(repository.getSnapshot().data.assignments['radio:localradio:one'], { folder: 'one', tags: ['News'] });
  assert.deepEqual(repository.getSnapshot().data.assignments['radio:localradio:two'], { folder: 'one', tags: ['News'] });
  await act(async () => { tree.root.findAllByType('Button' as any).find((node) => node.props.accessibilityLabel === 'Rename folder: Morning')!.props.onPress(); });
  await act(async () => { tree.root.findAllByType('Input' as any)[0].props.onChangeText('Evening'); });
  await act(async () => { button('Rename folder').props.onPress(); });
  assert.equal(repository.getSnapshot().data.folders[0].name, 'Evening');
  const stale = button('− #News').props.onPress; epoch += 2;
  await act(async () => { stale(); }); assert.deepEqual(repository.getSnapshot().data.assignments['radio:localradio:one'].tags, ['News']);
  await act(async () => { button('Select all').props.onPress(); });
  // A fresh render acquires the new epoch; stale callbacks above could not mutate it.
  await act(async () => { tree.root.findAllByType('Button' as any).find((node) => node.props.accessibilityLabel === 'Delete folder: Evening')!.props.onPress(); });
  assert.equal(repository.getSnapshot().data.folders.length, 0); assert.equal(repository.getSnapshot().data.assignments['radio:localradio:one'].folder, undefined);
  assert.equal(repository.getSnapshot().data.stations.length, 2); await act(async () => { tree.unmount(); });
});
