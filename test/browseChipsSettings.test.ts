import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { DEFAULT_EXPLORE_SECTIONS, DEFAULT_LIBRARY_CHIPS, canDownloadFilter,
  normalizeExploreSections, normalizeLibraryChips } from '../src/lib/browseChips';

const disk = { profile: 'one', items: new Map<string, string>(), writes: [] as [string, string][],
  waits: new Map<string, Promise<void>>() };
Object.assign(globalThis, { __browseChipsSettingsDisk: disk });
const stubs = new Map([
  ['react-native', "export const Platform = { OS: 'android', select: values => values.android ?? values.default }"],
  ['@/i18n/languages', "export const LANGUAGE_NAMES = { en: 'English', 'zh-CN': '简体中文' }; export const isLanguage = value => value === 'en' || value === 'zh-CN'"],
  ['@/lib/localLibrary', 'export const hashKey = value => value'],
  ['@/lib/perfLog', 'export const setPerfEnabled = () => {}'],
  ['@/lib/query', 'export const queryClient = { invalidateQueries() {} }'],
  ['@/lib/storage', `export const getItem = async key => {
      const disk = globalThis.__browseChipsSettingsDisk;
      const wait = disk.waits.get(key); if (wait) await wait;
      return disk.items.get(key) ?? null;
    };
    export const setItem = async (key, value) => {
      const disk = globalThis.__browseChipsSettingsDisk;
      disk.writes.push([key, value]); disk.items.set(key, value);
    }`],
  ['@/theme', `export const DEFAULT_ACCENT = '#1DB954'; export const BACKGROUND_TINTS = { blue: {}, neutral: {} };
    export const applyAccents = () => {}; export const applyBackgroundTint = () => {}; export const applyPureBlack = () => {};
    export const applyThemePreference = () => {}; export const applyThemeSchedule = () => {};
    export const isThemePreference = value => ['system','dark','light','schedule'].includes(value)`],
]);
const auth = 'export const profileScopeId = () => globalThis.__browseChipsSettingsDisk.profile; export const useAuthStore = { getState: () => ({ offline: false }) }';
const hook = registerHooks({ resolve(specifier, context, next) {
  const stub = specifier === './auth' && context.parentURL?.endsWith('/store/settings.ts') ? auth : stubs.get(specifier);
  return stub ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true } : next(specifier, context);
} });
const { useSettings, exportedSettings } = await import('@/store/settings');
hook.deregister();

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const keys = (items: readonly { key: string }[]) => items.map((item) => item.key);
const state = () => useSettings.getState();
const chipPreferences = () => plain({ exploreSections: state().exploreSections, libraryChips: state().libraryChips });
const readSaved = (profile = disk.profile) => JSON.parse(disk.items.get(`resonus.settings.${profile}`)!);
const defer = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

beforeEach(async () => {
  disk.items.clear(); disk.waits.clear(); disk.writes.length = 0; disk.profile = 'one';
  disk.items.set('resonus.language', 'zh-CN');
  await state().hydrate(); disk.writes.length = 0;
});

test('legacy Downloads retains its saved slot and hidden state, and aliases cannot create duplicate chips', () => {
  const normalized = normalizeExploreSections([
    { key: 'artists', enabled: false }, { key: 'downloads', enabled: false }, 'albums',
    { key: 'downloaded', enabled: true }, null, false, 7, {}, { key: 'not-a-section', enabled: true },
    { key: 'artists', enabled: true }, { key: 'songs', enabled: 'false' },
  ]);
  assert.deepEqual(keys(normalized), ['artists', 'downloaded', 'albums', 'songs', 'playlists', 'genres', 'radio', 'podcasts', 'folders']);
  assert.equal(normalized[0].enabled, false);
  assert.equal(normalized[1].enabled, false);
  assert.equal(normalized[3].enabled, true, 'only an actual boolean is a saved switch value');
  assert.equal(new Set(keys(normalized)).size, DEFAULT_EXPLORE_SECTIONS.length);
  assert.deepEqual(normalizeExploreSections(normalized), normalized, 'migration is idempotent');
});

test('older lists without Downloads receive the filter once, while defaults and input remain unmodified', () => {
  const input = [{ key: 'albums', enabled: false }, { key: 'songs', enabled: true }];
  const before = plain(input), normalized = normalizeExploreSections(input);
  assert.deepEqual(keys(normalized).slice(0, 3), ['downloaded', 'albums', 'songs']);
  assert.equal(normalized.filter((item) => item.key === 'downloaded').length, 1);
  normalized[1].enabled = true;
  assert.deepEqual(input, before);
  const defaults = normalizeExploreSections(null); defaults[0].enabled = false;
  assert.equal(DEFAULT_EXPLORE_SECTIONS[0].enabled, true);
});

test('library chip normalization preserves the first valid choice and all-hidden is allowed', () => {
  const normalized = normalizeLibraryChips([
    { key: 'podcasts', enabled: false }, { key: 'albums', enabled: false }, { key: 'albums', enabled: true },
    null, 'invalid', { key: 'artists', enabled: false }, { key: 'playlists', enabled: false },
  ]);
  assert.deepEqual(keys(normalized), ['podcasts', 'albums', 'artists', 'playlists']);
  assert.equal(normalized.every((item) => !item.enabled), true);
  assert.deepEqual(normalizeLibraryChips(normalized), normalized);
  const defaults = normalizeLibraryChips('invalid'); defaults[0].enabled = false;
  assert.equal(DEFAULT_LIBRARY_CHIPS[0].enabled, true);
  assert.deepEqual(['playlists', 'albums', 'artists', 'songs', 'downloaded', 'radio', 'podcasts', 'folders']
    .map(canDownloadFilter), [true, true, true, true, false, false, false, false]);
});

test('the actual settings hydration migrates legacy controls and subsequent export/save contains only the new key', async () => {
  disk.items.set('resonus.settings.one', JSON.stringify({
    uiStyle: 'spotify', albumStyle: 'minidisc', playerPresentation: 'amll', blurMiniPlayer: false,
    exploreSections: ['songs', { key: 'downloads', enabled: false }, 'albums'],
    libraryChips: [{ key: 'artists', enabled: false }, 'albums', 'artists', 'invalid'],
  }));
  await state().hydrate();
  assert.deepEqual(keys(state().exploreSections).slice(0, 3), ['songs', 'downloaded', 'albums']);
  assert.equal(state().exploreSections[1].enabled, false);
  assert.deepEqual(keys(state().libraryChips), ['artists', 'albums', 'playlists', 'podcasts']);
  assert.equal(state().libraryChips[0].enabled, false);
  assert.equal(state().uiStyle, 'spotify'); assert.equal(state().albumStyle, 'minidisc');
  assert.equal(state().playerPresentation, 'amll'); assert.equal(state().blurMiniPlayer, false);
  state().setLibraryChip('podcasts', false);
  const saved = readSaved(), exported = exportedSettings();
  assert.deepEqual(saved.libraryChips, exported.libraryChips);
  assert.deepEqual(saved.exploreSections, exported.exploreSections);
  assert.equal(saved.exploreSections.some((item: { key: string }) => item.key === 'downloads'), false);
  assert.equal(saved.exploreSections.find((item: { key: string }) => item.key === 'downloaded').enabled, false);
  assert.equal(saved.albumStyle, 'minidisc'); assert.equal(saved.blurMiniPlayer, false);
});

test('import normalizes the same controls, old blobs keep the library defaults, and reset preserves language', async () => {
  state().importSettings({ exploreSections: [{ key: 'downloads', enabled: false }, 'songs'],
    libraryChips: [{ key: 'podcasts', enabled: false }, { key: 'podcasts', enabled: true }] });
  assert.equal(state().exploreSections[0].key, 'downloaded'); assert.equal(state().exploreSections[0].enabled, false);
  assert.deepEqual(keys(state().libraryChips), ['podcasts', 'playlists', 'albums', 'artists']);
  assert.equal(readSaved().libraryChips[0].enabled, false);
  state().resetToDefaults();
  assert.deepEqual(state().exploreSections, DEFAULT_EXPLORE_SECTIONS);
  assert.deepEqual(state().libraryChips, DEFAULT_LIBRARY_CHIPS);
  assert.equal(state().language, 'zh-CN');
  disk.items.set('resonus.settings.one', JSON.stringify({ exploreSections: ['albums', 'songs'] }));
  await state().hydrate();
  assert.deepEqual(state().libraryChips, DEFAULT_LIBRARY_CHIPS);
});

test('profile switches never persist the previous profile controls into the next profile or overwrite an in-flight read', async () => {
  state().setLibraryChip('artists', false); state().setExploreSection('downloaded', false);
  const original = disk.items.get('resonus.settings.one');
  disk.profile = 'two';
  state().setLibraryChip('albums', false);
  assert.equal(disk.items.has('resonus.settings.two'), false, 'no write before this profile owns hydrated settings');
  disk.items.set('resonus.settings.two', JSON.stringify({ libraryChips: [{ key: 'podcasts', enabled: false }], exploreSections: ['artists', 'albums'] }));
  const gate = defer(); disk.waits.set('resonus.settings.two', gate.promise);
  const pending = state().hydrate();
  state().setExploreSection('songs', false);
  assert.equal(JSON.parse(disk.items.get('resonus.settings.two')!).exploreSections[0], 'artists');
  gate.resolve(); await pending; disk.waits.delete('resonus.settings.two');
  assert.equal(state().libraryChips[0].key, 'podcasts'); assert.equal(state().libraryChips[0].enabled, false);
  state().setLibraryChip('artists', false);
  assert.equal(disk.items.get('resonus.settings.one'), original);
  const second = disk.items.get('resonus.settings.two');
  disk.profile = 'one'; await state().hydrate();
  assert.equal(state().libraryChips.find((item) => item.key === 'artists')!.enabled, false);
  assert.equal(state().exploreSections.find((item) => item.key === 'downloaded')!.enabled, false);
  assert.equal(disk.items.get('resonus.settings.two'), second);
});

test('a slower hydration from the old profile cannot replace the current controls or claim their save key', async () => {
  disk.items.set('resonus.settings.one', JSON.stringify({ libraryChips: ['artists'], exploreSections: ['songs'] }));
  disk.items.set('resonus.settings.two', JSON.stringify({ libraryChips: ['podcasts'], exploreSections: ['albums'] }));
  const gate = defer(); disk.waits.set('resonus.settings.one', gate.promise);
  const old = state().hydrate();
  disk.profile = 'two'; await state().hydrate();
  const accepted = chipPreferences();
  gate.resolve(); await old; disk.waits.delete('resonus.settings.one');
  assert.deepEqual(chipPreferences(), accepted); assert.equal(state().hydrated, true);
  state().setLibraryChip('podcasts', false);
  assert.equal(readSaved('two').libraryChips[0].enabled, false);
  assert.equal(JSON.parse(disk.items.get('resonus.settings.one')!).libraryChips[0], 'artists');
});

type Element = { type: any; props: Record<string, any> };
const jsx = (type: any, props: Record<string, unknown>): Element => ({ type, props });
function find(node: Element | Element[], type: string): Element | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
  if (!node?.props) return;
  return node.type === type ? node : find(node.props.children, type);
}
function settingsScreen(name: 'library-chips' | 'explore-sections') {
  const toasts: string[] = [], scroll = {}, dragged: string[] = [];
  const colors = { text: '#fff', textSecondary: '#aaa', accent: '#0f0', control: '#222', knob: '#fff' };
  const dependencies: Record<string, unknown> = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Text: 'Text', Pressable: 'Pressable' },
    'react-native-reorderable-list': { __esModule: true, default: 'ReorderableList', useReorderableDrag: () => () => dragged.push('drag') },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/components/glass': { GlassSurface: 'GlassSurface', GlassSwitch: 'GlassSwitch' },
    '@/components/SettingsUI': { SETTINGS_ROW_LAYOUT: { minHeight: 48 }, ScreenHeader: 'ScreenHeader', SettingsSafeArea: 'SettingsSafeArea' },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => scroll },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 240 },
    '@/hooks/useScreenSize': { centredPadding: () => 24, useScreenSize: () => ({ width: 400 }) },
    '@/i18n': { useT: () => (text: string) => text },
    '@/lib/haptics': { haptic() {} },
    '@/store/settings': { useSettings: (select: (value: ReturnType<typeof useSettings.getState>) => unknown) => select(state()) },
    '@/store/toast': { useToast: (select: (value: unknown) => unknown) => select({ show: (text: string) => toasts.push(text) }) },
    '@/theme': { colors, fontSize: {}, radius: {}, spacing: {}, SCREEN_BOTTOM_PADDING: 0,
      themed: (factory: (value: typeof colors) => unknown) => factory(colors), useTheme: () => colors },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/app/settings/${name}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(id: string) { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; } });
  const render = () => find(exports.default(), 'ReorderableList')!;
  return { render, toasts, scroll, dragged };
}

test('the actual library settings applies drag order and switches to this profile using the existing dock scroll path', () => {
  const h = settingsScreen('library-chips'), list = h.render();
  assert.equal(list.props.onScroll, h.scroll);
  assert.equal(list.props.contentContainerStyle.paddingBottom, 240);
  const before = keys(state().libraryChips);
  list.props.onReorder({ from: 0, to: 3 });
  assert.deepEqual(keys(state().libraryChips), [...before.slice(1), before[0]]);
  const fresh = h.render(), last = state().libraryChips.at(-1)!;
  const row = fresh.props.renderItem({ item: last }), body = row.type(row.props);
  find(body, 'GlassSwitch')!.props.onValueChange(false);
  assert.equal(readSaved().libraryChips.at(-1).enabled, false);
  const writes = disk.writes.length;
  for (const [from, to] of [[0, 0], [-1, 0], [0, 4], [4, 0]]) fresh.props.onReorder({ from, to });
  assert.equal(disk.writes.length, writes, 'unchanged and invalid native reorder events do not write');
});

test('the actual Explore settings does not let Downloaded stand in for the last browsable section', () => {
  state().setExploreSections(DEFAULT_EXPLORE_SECTIONS.map((item) => ({ ...item, enabled: ['albums', 'downloaded'].includes(item.key) })));
  const h = settingsScreen('explore-sections');
  const toggle = (key: string, enabled: boolean) => {
    const list = h.render(), item = state().exploreSections.find((section) => section.key === key)!;
    list.props.renderItem({ item }).props.onToggle(enabled);
  };
  toggle('albums', false);
  assert.equal(state().exploreSections.find((item) => item.key === 'albums')!.enabled, true);
  assert.deepEqual(h.toasts, ['Keep at least one section on']);
  toggle('downloaded', false);
  assert.equal(state().exploreSections.find((item) => item.key === 'downloaded')!.enabled, false);
  toggle('artists', true); toggle('albums', false);
  assert.equal(state().exploreSections.find((item) => item.key === 'albums')!.enabled, false);
  assert.equal(state().exploreSections.find((item) => item.key === 'artists')!.enabled, true);
});
