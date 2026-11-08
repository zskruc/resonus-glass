import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { SettingsAnchorContext } from '../src/components/SettingsAnchorContext';
import { settingScrollOffset } from '../src/lib/settingsSearch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function harness() {
  let params: Record<string, string | undefined> = { setting: 'Blur inactive lyrics', settingVisit: '1' };
  const moves: unknown[] = [], pending: (() => void)[] = [], timers: (() => void)[] = [];
  const content = {}, scroll = { scrollTo: (value: unknown) => moves.push(value) };
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSX,
    'expo-router': { useLocalSearchParams: () => params },
    'react-native': { View: 'native-view', StyleSheet: { absoluteFill: { position: 'absolute' } } },
    '@/i18n': { useT: () => translate }, '@/hooks/useAccent': { useAccent: () => '#009966' },
    '@/lib/settingsSearch': { settingScrollOffset }, './SettingsAnchorContext': { SettingsAnchorContext },
  };
  const translate = (key: string) => key === 'Blur inactive lyrics' ? '模糊非当前歌词' : key;
  const exported: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/SettingAnchor.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: exported, require: (name: string) => { assert.ok(name in imports, name); return imports[name]; },
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; }, clearTimeout: () => {} });
  function ScrollRegistration() {
    const context = React.useContext(SettingsAnchorContext);
    React.useEffect(() => { context?.registerScroll(scroll as any, content as any); return () => context?.registerScroll(null, null); }, [context]);
    return null;
  }
  const render = () => React.createElement(exported.SettingsAnchorProvider, null,
    React.createElement(ScrollRegistration), React.createElement(exported.SettingAnchor, { label: '模糊非当前歌词' }, React.createElement('control', { value: 'untouched' })));
  const options = { createNodeMock: (element: React.ReactElement) => (element.props as Record<string, unknown>).collapsable === false
    ? { measureLayout: (relative: unknown, success: (...values: number[]) => void) => {
      assert.equal(relative, content); pending.push(() => success(0, 500, 200, 56));
    } } : {} };
  return { render, options, moves, pending, timers, setParams: (next: Record<string, string | undefined>) => { params = next; } };
}
test('the actual translated settings anchor scrolls its real row into view and highlights without changing the control', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render(), h.options); });
    assert.equal(h.pending.length, 1);
    await act(async () => { h.pending.shift()!(); });
    assert.deepEqual(JSON.parse(JSON.stringify(h.moves)), [{ y: 482, animated: true }]);
    assert.equal(renderer.root.findByType('control' as any).props.value, 'untouched');
    assert.ok(renderer.root.findAllByType('native-view' as any).some((node) => node.props.pointerEvents === 'none'));
    await act(async () => { h.timers.at(-1)!(); });
    assert.ok(!renderer.root.findAllByType('native-view' as any).some((node) => node.props.pointerEvents === 'none'));
  } finally { await act(async () => renderer?.unmount()); }
});
test('normal settings and an unmatched hidden option never measure or replace native scrolling', async () => {
  for (const params of [{}, { setting: 'not mounted in this mode' }]) {
    const h = harness(); h.setParams(params); let renderer!: ReactTestRenderer;
    try { await act(async () => { renderer = create(h.render(), h.options); }); assert.equal(h.pending.length, 0); assert.equal(h.moves.length, 0); }
    finally { await act(async () => renderer?.unmount()); }
  }
});
test('a measurement which finishes after the target row is gone cannot scroll the replacement page', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render(), h.options); });
    const old = h.pending.shift()!;
    h.setParams({ setting: 'Another option', settingVisit: '2' });
    await act(async () => renderer.update(h.render()));
    await act(async () => old()); assert.equal(h.moves.length, 0);
  } finally { await act(async () => renderer?.unmount()); }
});
