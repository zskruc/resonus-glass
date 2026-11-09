import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Element = { type: unknown; props: Record<string, any> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  return [node, ...nodes(node.props.children)];
}
function harness() {
  let cursor = 0, artistScope = 'one';
  const slots: any[] = [], effects: (() => void)[] = [];
  const auth = { auth: {} as object | null, offline: false };
  const calls: { kind: string; value: unknown }[] = [];
  const player = { queue: [] as unknown[], playQueue: async (...args: unknown[]) => { calls.push({ kind: 'play', value: args }); return true; },
    startRadio: async (...args: unknown[]) => { calls.push({ kind: 'mix', value: args }); return true; } };
  let read = async () => [{ id: 'song', title: 'Song', duration: 10 }];
  const store = Object.assign((select: (state: typeof player) => unknown) => select(player), { getState: () => player });
  const authStore = Object.assign((select: (state: typeof auth) => unknown) => select(auth), { getState: () => auth });
  const react = {
    useRef(value: unknown) { return slots[cursor++] ??= { current: value }; },
    useState(value: unknown) { const slot = slots[cursor++] ??= { value }; return [slot.value, (next: unknown) => { slot.value = next; }]; },
    useEffect(create: () => void) { const index = cursor++; if (!slots[index]) { slots[index] = true; effects.push(create); } },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const colors = { text: '#fff', textSecondary: '#aaa', border: '#222' };
  const dependencies: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View' },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/api/data': { getTopSongs: () => read(), coverArtUrl: () => 'cover', COVER: { thumb: 100 },
      star: async (...args: unknown[]) => calls.push({ kind: 'star', value: args }) },
    '@/hooks/useFavoriteIds': { useFavoriteIds: () => new Set() },
    '@/i18n': { useT: () => (key: string, params?: Record<string, string>) => key.replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? '') },
    '@/lib/favoritesCache': { applyStarChange: () => {}, unstarWithUndo: () => {} },
    '@/store/auth': { profileScopeId: () => artistScope, useAuthStore: authStore },
    '@/store/player': { usePlayerStore: store }, '@/store/toast': { useToast: (select: (state: unknown) => unknown) => select({ show: () => {} }) },
    '@/theme': { colors, fontSize: {}, spacing: {}, themed: (factory: (color: typeof colors) => unknown) => factory(colors) },
    './Cover': { Cover: 'Cover' }, './SheetModal': { SheetModal: 'Sheet' },
  };
  const exported: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/components/ArtistMenuSheet.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports: exported, require(name: string) { const customization = defaultCustomizationBoundary(name); if (customization) return customization; assert.ok(name in dependencies, name); return dependencies[name]; } });
  function render() { cursor = 0; const sheet = exported.ArtistMenuSheet(); while (effects.length) effects.shift()!(); return sheet; }
  render(); exported.openArtistMenu({ id: 'artist', name: 'Artist' });
  const body = () => render().props.children((after?: () => void) => after?.());
  return { calls, player, auth, read: (next: typeof read) => { read = next; },
    switchProfile: () => { artistScope = 'two'; auth.auth = {}; },
    action(label: string) { return nodes(body()).find((node) => node.type === 'Pressable'
      && nodes(node.props.children).some((child) => child.type === 'Text' && child.props.children === label))!.props.onPress(); } };
}
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

test('artist library menu uses existing playback/mix actions rather than a missing radio route', async () => {
  for (const [label, kind] of [['Play', 'play'], ['Start mix', 'mix']]) {
    const h = harness(); h.action(label); await tick();
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].kind, kind);
  }
});
test('late artist songs cannot replace a newly selected queue or another account', async () => {
  for (const change of ['queue', 'profile']) {
    const h = harness(); let release!: (songs: { id: string; title: string; duration: number }[]) => void;
    h.read(() => new Promise((yes) => { release = yes; })); h.action('Play');
    if (change === 'queue') h.player.queue = [{ id: 'new-intent' }]; else h.switchProfile();
    release([{ id: 'old-song', title: 'Old', duration: 10 }]); await tick(); assert.deepEqual(h.calls, []);
  }
});
test('a menu opened under another account cannot favorite its artist in the replacement account', async () => {
  const h = harness(); h.switchProfile(); h.action('Add to favorites'); await tick(); assert.deepEqual(h.calls, []);
});
import { defaultCustomizationBoundary } from './helpers/defaultCustomizationBoundary';
