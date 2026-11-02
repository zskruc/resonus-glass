import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

import { SettingsScrollPaddingContext } from '../src/components/SettingsScrollPaddingContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function flatten(style: unknown): Record<string, unknown> {
  return Array.isArray(style) ? Object.assign({}, ...style.map(flatten))
    : typeof style === 'object' && style !== null ? style as Record<string, unknown> : {};
}

/** Executes the real forwardRef/context/style composition. Native scrolling
 * and the dock's worklet event are boundaries, not replacement padding logic. */
function harness() {
  const dock = () => {};
  const node = { scrollTo() {} };
  const ref = React.createRef<unknown>();
  const exports: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { ScrollView: 'scroll', StyleSheet: { flatten } },
    'react-native-reanimated': { __esModule: true, default: { ScrollView: 'animated-scroll' } },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => dock },
    './SettingsScrollPaddingContext': { SettingsScrollPaddingContext },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/DockScrollView.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected dock-scroll import ${name}`); return imports[name];
  } });
  const render = (bottom: number | undefined, props: Record<string, unknown>) => React.createElement(
    SettingsScrollPaddingContext.Provider, { value: bottom },
    React.createElement(exports.DockScrollView, { ...props, ref }));
  return { render, dock, ref, node, options: { createNodeMock: () => node } };
}

test('settings content clears a growing dock/inset without replacing the native scroll, custom style or event handlers', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  let begins = 0;
  const styles = [{ padding: 16, gap: 8 }, { paddingBottom: 160, paddingHorizontal: 24 }];
  const props = { contentContainerStyle: styles, onScrollBeginDrag: () => { begins++; } };
  try {
    await act(async () => { renderer = create(h.render(180, props), h.options); });
    const scroll = () => renderer.root.findAll((item) => String(item.type) === 'animated-scroll')[0].props;
    assert.equal(h.ref.current, h.node);
    assert.deepEqual(flatten(scroll().contentContainerStyle), { padding: 16, gap: 8, paddingBottom: 180, paddingHorizontal: 24 });
    assert.equal(scroll().onScroll, h.dock); assert.equal(scroll().scrollEventThrottle, 16);
    await act(async () => { renderer.update(h.render(240, props)); });
    assert.equal(h.ref.current, h.node);
    assert.equal(flatten(scroll().contentContainerStyle).paddingBottom, 240);
    scroll().onScrollBeginDrag(); assert.equal(begins, 1);
    await act(async () => { renderer.update(h.render(180, { ...props, contentContainerStyle: [{ paddingBottom: 400 }, { gap: 20 }] })); });
    assert.equal(flatten(scroll().contentContainerStyle).paddingBottom, 400, 'caller-owned extra space must survive');
  } finally { await act(async () => { renderer?.unmount(); }); }
  assert.equal(h.ref.current, null);
});

test('other pages and horizontal scrolls retain their exact existing content style', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  const style = { paddingVertical: 12, gap: 8 };
  try {
    await act(async () => { renderer = create(h.render(undefined, { contentContainerStyle: style })); });
    const scroll = () => renderer.root.findAll((item) => String(item.type) === 'animated-scroll')[0].props;
    assert.equal(scroll().contentContainerStyle, style);
    await act(async () => { renderer.update(h.render(240, { contentContainerStyle: style, horizontal: true })); });
    assert.equal(scroll().contentContainerStyle, style);
    assert.equal(scroll().onScroll, h.dock);
  } finally { await act(async () => { renderer?.unmount(); }); }
});
