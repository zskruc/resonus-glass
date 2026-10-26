import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as geometry from '../src/lib/amllPlayerControls';

type Element = { type: any; props: Record<string, any> };
type Animation = { kind: string; target?: number; duration?: number };
const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });

function harness() {
  const scopes = new Map<string, { slots: any[]; values: any[]; cursor: number; pending: (() => void)[]; cleanups: Set<() => void> }>();
  let current!: ReturnType<typeof scope>;
  function scope(key: string) {
    if (!scopes.has(key)) scopes.set(key, { slots: [], values: [], cursor: 0, pending: [], cleanups: new Set() });
    return scopes.get(key)!;
  }
  const slot = <T,>(create: () => T): T => current.slots[current.cursor++] ??= create();
  function effect(create: () => void | (() => void), deps?: unknown[]) {
    const owner = current;
    const saved = slot(() => ({ deps: undefined as unknown[] | undefined, cleanup: undefined as (() => void) | undefined }));
    if (saved.deps && deps && saved.deps.length === deps.length && saved.deps.every((v, i) => Object.is(v, deps[i]))) return;
    saved.deps = deps;
    owner.pending.push(() => {
      if (saved.cleanup) { owner.cleanups.delete(saved.cleanup); saved.cleanup(); }
      saved.cleanup = create() || undefined;
      if (saved.cleanup) owner.cleanups.add(saved.cleanup);
    });
  }
  const calls: string[] = [];
  const dependencies: Record<string, any> = {
    react: { useRef: (value: unknown) => slot(() => ({ current: value })), useEffect: effect, useLayoutEffect: effect },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-image': { Image: 'SvgImage' },
    'react-native': { Pressable: 'Button', View: 'View', ScrollView: 'ScrollView', ActivityIndicator: 'Spinner',
      StyleSheet: { create: (s: unknown) => s, absoluteFill: {} } },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue: (initial: number) => slot(() => {
        const value = { value: initial, animation: undefined as Animation | undefined,
          get() { return this.value; }, set(next: number | Animation) {
            if (typeof next === 'number') { this.value = next; this.animation = undefined; } else this.animation = next;
          } };
        current.values.push(value); return value;
      }),
      useAnimatedStyle: (read: () => unknown) => ({ read }),
      cancelAnimation: (value: any) => { value.animation = undefined; },
      withTiming: (target: number, config: object) => ({ kind: 'timing', target, ...config }),
      Easing: { bezier: (...points: number[]) => points },
    },
    '@/i18n': { useT: () => (value: string) => value },
    '@/lib/amllPlayerControls': geometry,
    '@/theme/motion': { motion: { reduceMotion: { decorative: 'system' } } },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/components/AmllPlayerControls.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, require(name: string) {
    if (name.endsWith('.svg')) return name;
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected controls dependency ${name}`);
    return dependencies[name];
  } });
  function render(component: (props: any) => Element, props: object, key: string) {
    current = scope(key); current.cursor = 0;
    const tree = component(props);
    while (current.pending.length) current.pending.shift()!();
    return tree;
  }
  let props: Record<string, any> = { width: 348, viewportWidth: 384, viewportHeight: 840, horizontal: false,
    playing: false, shuffle: false, repeat: 'off', showLyrics: false, progress: jsx('Progress', {}), volume: jsx('Volume', {}),
    onPrevious: () => calls.push('previous'), onToggle: () => calls.push('toggle'), onNext: () => calls.push('next'),
    onShuffle: () => calls.push('shuffle'), onRepeat: () => calls.push('repeat'), onLongPressPlay: () => calls.push('stop'),
    onLyrics: () => calls.push('lyrics'), onOutput: () => calls.push('output'), onQueue: () => calls.push('queue') };
  function controls(next: object = {}) { props = { ...props, ...next }; return render(exports.AmllPlayerControls, props, 'controls'); }
  function buttons(tree: Element) { return findAll(tree, (node) => typeof node.type === 'function' && !!node.props.label); }
  function button(node: Element) { return render(node.type, node.props, `button:${node.props.label}`); }
  function glyph(node: Element) { return render(node.type, node.props, `glyph:${node.props.name}`); }
  return { controls, buttons, button, glyph, calls,
    utilities(next: object = {}) { props = { ...props, ...next }; return render(exports.AmllPlayerBottomActions, props, 'utilities'); },
    more(next: object = {}) { return render(exports.AmllPlayerMoreButton, { viewportWidth: 384, viewportHeight: 840,
      onPress: () => calls.push('more'), ...next }, 'more'); },
    values(label: string) { return scope(`button:${label}`).values; },
    renderElement(node: Element, key: string) { return render(node.type, node.props, key); },
    scopeValues(key: string) { return scope(key).values; },
    unmount(label: string) { for (const cleanup of scope(`button:${label}`).cleanups) cleanup(); },
  };
}

function findAll(node: unknown, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, predicate));
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [...(predicate(element) ? [element] : []), ...findAll(element.props.children, predicate)];
}

test('native transport keeps every existing action and selects the original play/shuffle/repeat state SVGs', () => {
  const h = harness();
  const first = h.buttons(h.controls());
  assert.deepEqual(first.map((node) => node.props.label), ['Shuffle', 'Previous', 'Play', 'Next', 'Repeat']);
  for (const node of first) h.button(node).props.onPress();
  h.button(first[2]).props.onLongPress();
  assert.deepEqual(h.calls, ['shuffle', 'previous', 'toggle', 'next', 'repeat', 'stop']);
  const active = h.buttons(h.controls({ playing: true, shuffle: true, repeat: 'one' }));
  assert.equal(active[0].props.children.props.name, 'shuffle-active');
  assert.equal(active[2].props.children.props.name, 'pause');
  assert.equal(active[4].props.children.props.name, 'repeat-one-active');
  assert.equal(active[0].props.children.props.size, 28, 'selected plate keeps the compact mode size');
  assert.equal(first[0].props.children.props.size, 36, 'unselected SVG whitespace preserves roughly 22dp ink');
  const repeatImage = h.glyph(active[4].props.children);
  assert.equal(repeatImage.props.source.endsWith('/repeat-one-active.svg'), true);
  assert.equal(repeatImage.props.tintColor, undefined, 'static SVG paint must not depend on native tint support');
  assert.equal(h.button(active[0]).props.accessibilityState.selected, true);
  const all = h.buttons(h.controls({ repeat: 'all' }));
  assert.equal(all[4].props.children.props.name, 'repeat-active');
  const loading = h.buttons(h.controls({ buffering: true }));
  assert.equal(loading[2].props.children.type, 'Spinner');
});

test('lyrics, queue, output and More keep callbacks and use checked artwork rather than text or icon fonts', () => {
  const h = harness();
  const utilities = h.buttons(h.utilities({ showLyrics: true, queueOpen: true, outputLabel: 'Living room' }));
  assert.deepEqual(utilities.map((node) => node.props.children.props.name), ['lyrics-on', 'output', 'queue-on']);
  assert.equal(utilities[1].props.label, 'Living room');
  for (const node of utilities) h.button(node).props.onPress();
  const more = h.more(); h.button(more).props.onPress();
  assert.deepEqual(h.calls, ['lyrics', 'output', 'queue', 'more']);
  assert.equal(h.glyph(utilities[0].props.children).props.source.endsWith('/lyrics-on.svg'), true);
  assert.equal(h.values('Show cover')[0].animation, undefined, 'confirmed action never starts a delayed click bounce');
});

test('the actual native button gives short press/release feedback, acts immediately and rejects stale callbacks', () => {
  const h = harness();
  const node = h.buttons(h.controls())[2];
  const play = h.button(node);
  play.props.onPressIn();
  const press = h.values('Play')[0].animation! as Animation;
  assert.equal(press.target, .9);
  assert.equal(press.duration, 80);
  play.props.onPressOut();
  const release = h.values('Play')[0].animation! as Animation;
  assert.equal(release.target, 1);
  assert.equal(release.duration, 140);
  play.props.onPress();
  assert.deepEqual(h.calls, ['toggle'], 'action runs before any animation completion');
  assert.equal(h.values('Play')[0].animation, release, 'press does not start a second bounce');
  const disabled = h.buttons(h.controls({ active: false }))[2];
  assert.equal(h.button(disabled).props.accessibilityState.disabled, true);
  assert.equal(h.values('Play')[0].animation, undefined);
  play.props.onPress(); play.props.onLongPress(); play.props.onPressOut();
  assert.equal(h.values('Play')[0].animation, undefined);
  assert.deepEqual(h.calls, ['toggle']);
  h.button(h.buttons(h.controls({ active: true }))[2]); h.unmount('Play');
  play.props.onPress();
  assert.deepEqual(h.calls, ['toggle']);
});

test('skip arrows render the white upstream SVG immediately without a separate entrance animation', () => {
  const h = harness();
  for (const index of [1, 3]) {
    const node = h.buttons(h.controls())[index].props.children;
    const image = h.glyph(node);
    assert.equal(image.type, 'SvgImage');
    assert.equal(image.props.source.endsWith(`/${node.props.name}.svg`), true);
    assert.equal(image.props.tintColor, undefined);
    assert.equal(image.props.transition, 0);
  }
  assert.deepEqual(h.calls, [], 'decorative SVG entrance never starts playback');
});

test('bundled control SVGs retain pinned upstream provenance and contain no external image/font dependencies', () => {
  const base = new URL('../assets/amll-controls/', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('PROVENANCE.json', base), 'utf8'));
  assert.equal(provenance.commit, '5fee356362353dbb24ce9bea3a62536478040de7');
  assert.equal(provenance.declaredLicense, 'AGPL-3.0-only');
  for (const file of provenance.files) {
    const source = readFileSync(new URL(file.asset, base), 'utf8');
    assert.equal(createHash('sha256').update(source).digest('hex'), file.adaptedSha256, file.asset);
    assert.match(file.originalSha256, /^[a-f0-9]{64}$/);
    assert.match(source, /viewBox=/);
    assert.match(source, /<path\b/);
    assert.doesNotMatch(source, /<image|<text|href=|<script/i);
  }
});

test('every bundled SVG has explicit native white paint while all non-color bytes retain their original hash', () => {
  const base = new URL('../assets/amll-controls/', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('PROVENANCE.json', base), 'utf8'));
  let changedFiles = 0, replacements = 0;
  assert.equal(provenance.files.length, 15);
  for (const file of provenance.files) {
    const source = readFileSync(new URL(file.asset, base), 'utf8');
    assert.doesNotMatch(source, /currentColor/i, file.asset);
    const fills = [...source.matchAll(/\bfill="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(fills.some((fill) => fill === 'white' || fill === '#FFFFFF'), `${file.asset}: explicit white paint`);
    assert.ok(fills.every((fill) => ['none', 'white', '#FFFFFF'].includes(fill)), `${file.asset}: transparent cutouts stay unpainted`);
    assert.equal(source.match(/#FFFFFF/g)?.length ?? 0, file.currentColorReplacements, file.asset);
    // Reversing only the paint spelling must restore the entire pinned original,
    // including every path, viewBox and evenodd rule.
    const original = source.replaceAll('#FFFFFF', 'currentColor');
    assert.equal(createHash('sha256').update(original).digest('hex'), file.originalSha256, `${file.asset}: non-color bytes changed`);
    if (file.currentColorReplacements > 0) changedFiles++;
    replacements += file.currentColorReplacements;
  }
  assert.equal(changedFiles, 10);
  assert.equal(replacements, 11);
});
