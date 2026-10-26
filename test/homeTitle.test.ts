import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';
import { HOME_TITLE_MAX, normalizeHomeTitle, resolveHomeTitle } from '@/lib/homeTitle';

// Exercise real profile hydration/persistence, replacing only platform boundaries.
const storage = { profile: 'one', items: new Map<string, string>() };
Object.assign(globalThis, { __homeTitleStorage: storage });
const stubs = new Map([
  ['react-native', "export const Platform = { OS: 'android', select: values => values.android ?? values.default }"],
  ['@/i18n/languages', "export const LANGUAGE_NAMES = { en: 'English', 'zh-CN': '简体中文' }; export const isLanguage = value => value === 'en' || value === 'zh-CN'"],
  ['@/lib/localLibrary', 'export const hashKey = value => value'],
  ['@/lib/perfLog', 'export const setPerfEnabled = () => {}'],
  ['@/lib/query', 'export const queryClient = { invalidateQueries() {} }'],
  ['@/lib/storage', `export const getItem = async key => globalThis.__homeTitleStorage.items.get(key) ?? null;
    export const setItem = async (key, value) => { globalThis.__homeTitleStorage.items.set(key, value) }`],
  ['@/theme', `export const DEFAULT_ACCENT = '#1DB954'; export const BACKGROUND_TINTS = { blue: {}, neutral: {} };
    export const applyAccents = () => {}; export const applyBackgroundTint = () => {}; export const applyPureBlack = () => {};
    export const applyThemePreference = () => {}; export const applyThemeSchedule = () => {}; export const isThemePreference = value => ['system','dark','light','schedule'].includes(value)`],
]);
const auth = 'export const profileScopeId = () => globalThis.__homeTitleStorage.profile; export const useAuthStore = { getState: () => ({ offline: false }) }';
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
});

test('normalization trims committed Unicode titles without splitting surrogate pairs', () => {
  assert.equal(normalizeHomeTitle(' \t我的音乐 🎵\n '), '我的音乐 🎵');
  assert.equal(normalizeHomeTitle(' \n\t '), '');
  assert.equal(normalizeHomeTitle(null), '');
  assert.equal(normalizeHomeTitle(123), '');
  assert.equal(normalizeHomeTitle('😀'.repeat(40)), '😀'.repeat(HOME_TITLE_MAX / 2));
  assert.equal(normalizeHomeTitle('a'.repeat(HOME_TITLE_MAX - 1) + '😀'), 'a'.repeat(HOME_TITLE_MAX - 1));
});

test('empty titles retain language and greeting behavior, while a chosen title has clear priority', () => {
  assert.equal(resolveHomeTitle('', false, '早上好', '首页'), '首页');
  assert.equal(resolveHomeTitle('', false, 'Good morning', 'Home'), 'Home');
  assert.equal(resolveHomeTitle(' ', true, '自定义问候', '首页'), '自定义问候');
  assert.equal(resolveHomeTitle(' 我的音乐 ', true, '自定义问候', '首页'), '我的音乐');
});

test('saved and imported title values pass through the same hydration validation', async () => {
  storage.items.set('resonus.settings.one', JSON.stringify({ customHomeTitle: ' \n歌单世界 🎶 ', showGreeting: true, customGreeting: '早上好' }));
  await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().customHomeTitle, '歌单世界 🎶');
  assert.equal(useSettings.getState().showGreeting, true);
  assert.equal(useSettings.getState().customGreeting, '早上好');
  useSettings.getState().importSettings({ customHomeTitle: 'x'.repeat(100) });
  assert.equal(useSettings.getState().customHomeTitle.length, HOME_TITLE_MAX);
  storage.items.set('resonus.settings.one', JSON.stringify({ customHomeTitle: ['not', 'text'] }));
  await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().customHomeTitle, '');
});

test('committing or clearing a title persists without changing the greeting or navigation preferences', async () => {
  const settings = useSettings.getState();
  settings.setShowGreeting(true);
  settings.setCustomGreeting('Hello');
  const tabs = JSON.stringify(useSettings.getState().bottomTabs);
  settings.setCustomHomeTitle('  我的主页  ');
  assert.equal(JSON.parse(storage.items.get('resonus.settings.one')!).customHomeTitle, '我的主页');
  assert.equal(exportedSettings().customHomeTitle, '我的主页');
  await settings.hydrate();
  assert.equal(useSettings.getState().customHomeTitle, '我的主页');
  settings.setCustomHomeTitle('   ');
  assert.equal(useSettings.getState().customHomeTitle, '');
  assert.equal(JSON.parse(storage.items.get('resonus.settings.one')!).customHomeTitle, '');
  assert.equal(useSettings.getState().showGreeting, true);
  assert.equal(useSettings.getState().customGreeting, 'Hello');
  assert.equal(JSON.stringify(useSettings.getState().bottomTabs), tabs);
});

test('title hydration remains isolated between profiles', async () => {
  useSettings.getState().setCustomHomeTitle('Profile one');
  storage.profile = 'two';
  await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().customHomeTitle, '');
  useSettings.getState().setCustomHomeTitle('Profile two');
  storage.profile = 'one';
  await useSettings.getState().hydrate();
  assert.equal(useSettings.getState().customHomeTitle, 'Profile one');
});
