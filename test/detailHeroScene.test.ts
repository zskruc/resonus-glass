import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const element = React.createElement;
const host = (renderer: ReactTestRenderer, name: string) => renderer.root.find((node) => String(node.type) === name);

function harness() {
  let lease = { active: true };
  let clock = 0, serial = 0, mounted = 0, cancelled = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const scheduled: (() => void)[] = [];
  let reporter: ((ready: boolean) => void) | undefined;
  let state: object | undefined;
  const exports: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { View: 'view', ActivityIndicator: 'spinner',
      StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' } } },
    'react-native-reanimated': { __esModule: true, default: { View: 'animated-view' } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24 }) },
    '@/components/RouteImageResources': { useRouteImageLease: () => lease },
    '@/components/BackChevron': { BackChevron: (props: Record<string, any>) => element('back', {
      accessibilityRole: 'button', accessibilityLabel: 'Back', ...props,
      onPress: props.onPress ?? (() => { cancelled++; }),
    }) },
    '@/i18n': { useT: () => (key: string) => key },
    '@/theme': { colors: { background: '#111111', text: '#ffffff' }, spacing: { lg: 16, sm: 8 } },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/DetailHeroScene.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports,
    setTimeout(callback: () => void, delay: number) {
      const id = ++serial; timers.set(id, { at: clock + delay, callback }); scheduled.push(callback); return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; },
  });
  function Content({ ready }: { ready?: boolean }) {
    const report = exports.useDetailHeroReporter();
    reporter = report;
    const [saved] = React.useState(() => ({ scroll: 371, selected: new Set(['track']), marker: {} }));
    state = saved;
    React.useEffect(() => { mounted++; return () => { mounted--; }; }, []);
    React.useLayoutEffect(() => { if (ready !== undefined) report?.(ready); }, [report, ready]);
    return element('page', { saved }, element('button', { accessibilityLabel: 'Play' }));
  }
  const render = (identity: string, enabled = true, ready?: boolean, onCancel?: () => void, background?: React.ReactNode) => element(exports.DetailHeroScene,
    { identity, enabled, loadingColor: '#223344', style: { minHeight: 100 }, onCancel, background }, element(Content, { ready }));
  const advance = (duration: number) => {
    clock += duration;
    for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
  };
  const content = (renderer: ReactTestRenderer) => renderer.root.findByProps({ testID: 'detail-hero-scene-content' });
  const loading = (renderer: ReactTestRenderer) => renderer.root.findAllByProps({ testID: 'detail-hero-loading' });
  return { render, content, loading, advance, timers, scheduled,
    reporter: () => reporter, state: () => state, mounted: () => mounted, cancelled: () => cancelled,
    lease: (active: boolean) => { lease = { active }; } };
}

test('the complete scene reveals immediately on readiness while keeping page layout and state mounted', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render('first')); });
    const saved = h.state();
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 0);
    assert.equal(h.content(renderer).props.pointerEvents, 'none');
    assert.equal(h.content(renderer).props.importantForAccessibility, 'no-hide-descendants');
    assert.equal(renderer.root.findAll((node) => String(node.type) === 'page').length, 1);
    assert.equal(h.loading(renderer).length, 0);
    await act(async () => { h.reporter()!(true); });
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 1, 'no second fade or entry timer is added');
    assert.equal(h.content(renderer).props.pointerEvents, 'auto');
    assert.equal(h.content(renderer).props.accessibilityElementsHidden, false);
    assert.equal(h.timers.size, 0);
    await act(async () => { h.reporter()!(false); });
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 1, 'same-identity local revalidation cannot retract painted content');
    assert.equal(h.state(), saved); assert.equal(h.mounted(), 1);
  } finally { await act(async () => { renderer?.unmount(); }); }
  assert.equal(h.mounted(), 0); assert.equal(h.timers.size, 0);
});

test('the final background remains outside readiness and a slow overlay does not replace it with a solid flash', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  const background = element('gradient', { colors: ['#223344', '#112233'] });
  try {
    await act(async () => { renderer = create(h.render('background', true, undefined, undefined, background)); });
    const gradient = host(renderer, 'gradient');
    assert.equal(gradient.parent?.type, 'view', 'background belongs to the outer scene, not hidden content');
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 0);
    await act(async () => { h.advance(150); });
    assert.equal(h.loading(renderer)[0].props.style.at(-1).backgroundColor, 'transparent');
    await act(async () => { h.reporter()!(true); });
    assert.equal(host(renderer, 'gradient'), gradient, 'revealing keeps the same final background');
    assert.equal(h.loading(renderer).length, 0);
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('warm readiness from a child layout effect does not show a loading flash or remount the scene', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render('warm', true, true)); });
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 1);
    assert.equal(h.loading(renderer).length, 0); assert.equal(h.timers.size, 0);
    const saved = h.state();
    await act(async () => { renderer.update(h.render('warm', false)); });
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 1);
    assert.equal(h.reporter(), undefined); assert.equal(h.state(), saved);
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('source changes reject old ready/unready callbacks and old loading timers without discarding page state', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render('first')); });
    const first = h.reporter()!, oldTimer = h.scheduled[0], saved = h.state();
    await act(async () => { first(true); });
    await act(async () => { renderer.update(h.render('second')); });
    const second = h.reporter()!;
    await act(async () => { first(true); oldTimer(); });
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 0);
    assert.equal(h.loading(renderer).length, 0);
    await act(async () => { second(true); first(false); });
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 1);
    assert.equal(h.state(), saved); assert.equal(h.mounted(), 1);
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('released image ownership stops loading UI and reacquisition requires its own composite readiness', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render('same')); });
    const original = h.reporter()!;
    await act(async () => { original(true); });
    const saved = h.state();
    h.lease(false);
    await act(async () => { renderer.update(h.render('same')); h.advance(200); });
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 0);
    assert.equal(h.loading(renderer).length, 0); assert.equal(h.timers.size, 0);
    h.lease(true);
    await act(async () => { renderer.update(h.render('same')); });
    await act(async () => { original(true); });
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 0);
    await act(async () => { h.reporter()!(true); });
    assert.equal(h.content(renderer).props.style.at(-1).opacity, 1);
    assert.equal(h.state(), saved);
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('slow loading has an accessible exit after 150ms, supports cancellation and cleans up its timer', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render('slow')); });
    await act(async () => { h.advance(149); });
    assert.equal(h.loading(renderer).length, 0);
    await act(async () => { h.advance(1); });
    assert.equal(h.loading(renderer).length, 1);
    const back = host(renderer, 'back');
    assert.equal(back.props.accessibilityRole, 'button'); assert.equal(back.props.accessibilityLabel, 'Back');
    assert.equal(back.props.style.at(-1).top, 32);
    back.props.onPress(); assert.equal(h.cancelled(), 1, 'default BackChevron navigation remains available');
    assert.equal(host(renderer, 'spinner').props.accessibilityLabel, 'Loading…');
    let cancelled = 0;
    await act(async () => { renderer.update(h.render('slow', true, undefined, () => { cancelled++; })); });
    host(renderer, 'back').props.onPress(); assert.equal(cancelled, 1);
    await act(async () => { h.reporter()!(true); });
    assert.equal(h.loading(renderer).length, 0);
    await act(async () => { renderer.update(h.render('aborted')); });
    assert.equal(h.timers.size, 1);
    const timer = h.scheduled.at(-1)!;
    await act(async () => { renderer.unmount(); });
    await act(async () => { timer(); });
    assert.equal(h.timers.size, 0);
  } finally { if (h.mounted()) await act(async () => { renderer?.unmount(); }); }
});
