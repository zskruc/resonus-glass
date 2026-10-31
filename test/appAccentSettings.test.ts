import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

const storage = { profile: 'one', items: new Map<string, string>(), accents: [] as unknown[][] };
Object.assign(globalThis, { __appAccentSettingsStorage: storage });
const stubs = new Map([
  ['react-native', "export const Platform = { OS: 'android', select: values => values.android ?? values.default }"],
  ['@/i18n/languages', "export const LANGUAGE_NAMES = { en: 'English', 'zh-CN': '简体中文' }; export const isLanguage = value => value === 'en' || value === 'zh-CN'"],
  ['@/lib/localLibrary', 'export const hashKey = value => value'],
  ['@/lib/perfLog', 'export const setPerfEnabled = () => {}'],
  ['@/lib/query', 'export const queryClient = { invalidateQueries() {} }'],
  ['@/lib/storage', `export const getItem = async key => globalThis.__appAccentSettingsStorage.items.get(key) ?? null;
    export const setItem = async (key, value) => { globalThis.__appAccentSettingsStorage.items.set(key, value) }`],
  ['@/theme', `export const DEFAULT_ACCENT = '#1DB954'; export const BACKGROUND_TINTS = { blue: {}, neutral: {} };
    export const applyAccents = (...args) => globalThis.__appAccentSettingsStorage.accents.push(args);
    export const applyBackgroundTint = () => {}; export const applyPureBlack = () => {};
    export const applyThemePreference = () => {}; export const applyThemeSchedule = () => {};
    export const isThemePreference = value => ['system','dark','light','schedule'].includes(value)`],
]);
const auth = 'export const profileScopeId = () => globalThis.__appAccentSettingsStorage.profile; export const useAuthStore = { getState: () => ({ offline: false }) }';
const hook = registerHooks({ resolve(specifier, context, next) {
  const stub = specifier === './auth' && context.parentURL?.endsWith('/store/settings.ts') ? auth : stubs.get(specifier);
  return stub ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true } : next(specifier, context);
} });
const { useSettings, exportedSettings } = await import('@/store/settings');
hook.deregister();

beforeEach(async () => {
  storage.items.clear(); storage.profile = 'one';
  await useSettings.getState().hydrate(); storage.accents.length = 0;
});

test('legacy and invalid source settings retain their own manual colors', async () => {
  for (const value of [undefined, null, 'automatic', ['artwork'], true]) {
    storage.items.set('resonus.settings.one', JSON.stringify({ accentColor: '#aabbcc', accentSource: value }));
    await useSettings.getState().hydrate();
    assert.equal(useSettings.getState().accentSource, 'manual');
    assert.equal(useSettings.getState().accentColor, '#aabbcc');
    assert.equal(useSettings.getState().accentColorLight, '#aabbcc');
    assert.deepEqual(storage.accents.at(-1), ['#aabbcc', '#aabbcc', 'manual']);
  }
});

test('selecting automatic only changes source, exports both manual choices and restores them after import', async () => {
  const state = useSettings.getState();
  state.setAccentColor('#aabbcc', 'dark'); state.setAccentColor('#bb4466', 'light');
  const before = exportedSettings();
  state.setAccentSource('artwork');
  const saved = exportedSettings();
  assert.deepEqual(saved, { ...before, accentSource: 'artwork' });
  assert.equal(JSON.parse(storage.items.get('resonus.settings.one')!).accentSource, 'artwork');
  assert.equal('artworkAccent' in saved, false, 'runtime cover colors and URLs never enter the exported file');
  state.resetToDefaults(); assert.equal(useSettings.getState().accentSource, 'manual');
  state.importSettings(saved);
  assert.equal(useSettings.getState().accentSource, 'artwork');
  assert.equal(useSettings.getState().accentColor, '#aabbcc');
  assert.equal(useSettings.getState().accentColorLight, '#bb4466');
  assert.deepEqual(storage.accents.at(-1), ['#aabbcc', '#bb4466', 'artwork']);
});

test('manually picking a color exits artwork mode without overwriting the other appearance or accepting malformed colors', () => {
  const state = useSettings.getState();
  state.setAccentColor('#aa3366', 'light'); state.setAccentSource('artwork');
  state.setAccentColor('#3344aa', 'dark');
  assert.equal(useSettings.getState().accentSource, 'manual');
  assert.equal(useSettings.getState().accentColorLight, '#aa3366');
  assert.equal(useSettings.getState().accentColor, '#3344aa');
  const before = exportedSettings();
  state.setAccentColor('not a color', 'dark');
  assert.deepEqual(exportedSettings(), before);
  assert.equal(JSON.parse(storage.items.get('resonus.settings.one')!).accentSource, 'manual');
});

test('source and manual palettes remain per-profile; hydration clears any session artwork at the theme boundary', async () => {
  useSettings.getState().setAccentColor('#ee9944', 'dark');
  useSettings.getState().setAccentSource('artwork');
  storage.profile = 'two'; await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().accentSource, 'manual');
  assert.equal(useSettings.getState().accentColor, '#1DB954');
  assert.deepEqual(storage.accents.at(-1), ['#1DB954', '#1DB954', 'manual', true]);
  useSettings.getState().setAccentColor('#4455dd', 'dark');
  storage.profile = 'one'; await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().accentSource, 'artwork');
  assert.equal(useSettings.getState().accentColor, '#ee9944');
  assert.ok(storage.accents.some((args) => args[3] === true));
});
