import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

import { isAppleMusicStyle, normalizeAlbumStyle, normalizeUiStyle } from '@/lib/uiStyle';

// Exercise the real settings store, replacing platform I/O and theme effects.
const storage = { profile: 'one', items: new Map<string, string>(), lookCalls: [] as string[] };
Object.assign(globalThis, { __uiStyleStorage: storage });
const stubs = new Map([
  ['react-native', "export const Platform = { OS: 'android', select: values => values.android ?? values.default }"],
  ['@/i18n/languages', "export const LANGUAGE_NAMES = { en: 'English', 'zh-CN': '简体中文' }; export const isLanguage = value => value === 'en' || value === 'zh-CN'"],
  ['@/lib/localLibrary', 'export const hashKey = value => value'],
  ['@/lib/perfLog', 'export const setPerfEnabled = () => {}'],
  ['@/lib/query', 'export const queryClient = { invalidateQueries() {} }'],
  ['@/lib/storage', `export const getItem = async key => globalThis.__uiStyleStorage.items.get(key) ?? null;
    export const setItem = async (key, value) => { globalThis.__uiStyleStorage.items.set(key, value) }`],
  ['@/theme', `export const DEFAULT_ACCENT = '#1DB954'; export const BACKGROUND_TINTS = { blue: {}, neutral: {} };
    const effect = name => () => globalThis.__uiStyleStorage.lookCalls.push(name);
    export const applyAccents = effect('accent'); export const applyBackgroundTint = effect('tint');
    export const applyPureBlack = effect('black'); export const applyThemePreference = effect('theme');
    export const applyThemeSchedule = effect('schedule');
    export const isThemePreference = value => ['system','dark','light','schedule'].includes(value)`],
]);
const auth = 'export const profileScopeId = () => globalThis.__uiStyleStorage.profile; export const useAuthStore = { getState: () => ({ offline: false }) }';
const hook = registerHooks({ resolve(specifier, context, next) {
  const stub = specifier === './auth' && context.parentURL?.endsWith('/store/settings.ts') ? auth : stubs.get(specifier);
  return stub ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true } : next(specifier, context);
} });
const { useSettings, exportedSettings } = await import('@/store/settings');
hook.deregister();

beforeEach(async () => {
  storage.items.clear();
  storage.profile = 'one';
  await useSettings.getState().hydrate();
  storage.lookCalls.length = 0;
});

test('old profiles and unknown style values keep the original Spotify layout', async () => {
  assert.equal(useSettings.getState().uiStyle, 'spotify');
  assert.equal(normalizeUiStyle('appleMusic'), 'appleMusic');
  assert.equal(isAppleMusicStyle('appleMusic'), true);
  for (const value of [undefined, null, 'apple', 'AppleMusic', 'future-style', 1, true, {}, ['appleMusic']]) {
    assert.equal(normalizeUiStyle(value), 'spotify');
    assert.equal(isAppleMusicStyle(value), false);
    storage.items.set('resonus.settings.one', JSON.stringify({ uiStyle: value }));
    await useSettings.getState().hydrate();
    assert.equal(useSettings.getState().uiStyle, 'spotify');
    useSettings.getState().importSettings({ uiStyle: value });
    assert.equal(useSettings.getState().uiStyle, 'spotify');
  }
});

test('old, invalid and imported album preferences retain Volta without changing UI or glass', async () => {
  assert.equal(useSettings.getState().albumStyle, 'volta');
  for (const value of [undefined, null, 'Volta', 'Minidisc', 'future', 1, true, {}, ['minidisc']]) {
    assert.equal(normalizeAlbumStyle(value), 'volta');
    storage.items.set('resonus.settings.one', JSON.stringify({ uiStyle: 'appleMusic', albumStyle: value }));
    await useSettings.getState().hydrate();
    assert.equal(useSettings.getState().albumStyle, 'volta');
    useSettings.getState().importSettings({ uiStyle: 'appleMusic', albumStyle: value });
    assert.equal(useSettings.getState().albumStyle, 'volta');
    assert.equal(useSettings.getState().uiStyle, 'appleMusic');
  }
});

test('album style persists per profile, exports and imports independently, and resets to Volta', async () => {
  useSettings.getState().setUiStyle('appleMusic');
  useSettings.getState().setBlurMiniPlayer(false);
  const before = exportedSettings();
  useSettings.getState().setAlbumStyle('minidisc');
  assert.deepEqual(exportedSettings(), { ...before, albumStyle: 'minidisc' });
  assert.equal(JSON.parse(storage.items.get('resonus.settings.one')!).albumStyle, 'minidisc');
  await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().albumStyle, 'minidisc');
  storage.profile = 'two';
  await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().albumStyle, 'volta');
  useSettings.getState().importSettings({ ...before, albumStyle: 'minidisc' });
  assert.equal(useSettings.getState().albumStyle, 'minidisc');
  assert.equal(useSettings.getState().blurMiniPlayer, false);
  useSettings.getState().resetToDefaults();
  assert.equal(useSettings.getState().albumStyle, 'volta');
  storage.profile = 'one';
  await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().albumStyle, 'minidisc');
});

test('switching styles persists and survives hydration without changing other preferences', async () => {
  const settings = useSettings.getState();
  settings.setAccentColor('#A66CFF', 'dark');
  settings.setThemeMode('light');
  settings.setPlayerPresentation('resonus');
  settings.setBlurMiniPlayer(false);
  settings.setShowTabLabels(false);
  settings.setCustomHomeTitle('我的音乐');
  const before = exportedSettings();
  storage.lookCalls.length = 0;

  settings.setUiStyle('appleMusic');
  assert.equal(useSettings.getState().uiStyle, 'appleMusic');
  assert.equal(JSON.parse(storage.items.get('resonus.settings.one')!).uiStyle, 'appleMusic');
  assert.deepEqual(exportedSettings(), { ...before, uiStyle: 'appleMusic' });
  assert.deepEqual(storage.lookCalls, []);
  await settings.hydrate();
  assert.deepEqual(exportedSettings(), { ...before, uiStyle: 'appleMusic' });

  settings.setUiStyle('spotify');
  assert.deepEqual(exportedSettings(), before);
});

test('export, import and factory reset include the selected layout', () => {
  useSettings.getState().setUiStyle('appleMusic');
  const exported = exportedSettings();
  useSettings.getState().resetToDefaults();
  assert.equal(useSettings.getState().uiStyle, 'spotify');
  useSettings.getState().importSettings(exported);
  assert.equal(useSettings.getState().uiStyle, 'appleMusic');
  assert.equal(JSON.parse(storage.items.get('resonus.settings.one')!).uiStyle, 'appleMusic');
});

test('each server profile retains its own UI selection', async () => {
  useSettings.getState().setUiStyle('appleMusic');
  storage.profile = 'two';
  await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().uiStyle, 'spotify');
  useSettings.getState().setUiStyle('spotify');
  storage.profile = 'one';
  await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().uiStyle, 'appleMusic');
});
