import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Element = { type: string; props: Record<string, any> };
const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });

function harness() {
  const slots: { value: any }[] = [];
  let cursor = 0;
  const saved: unknown[][] = [];
  let picked: Record<string, unknown> = { canceled: false, assets: [{ uri: 'file:///picked.ttf', name: 'picked.ttf' }] };
  let failure: 'picker' | 'import' | null = 'import';
  let imports = 0;
  const settings = { appFont: 'system', customFontFamily: null, customFontUri: null,
    setCustomFont: (...args: unknown[]) => saved.push(['custom', ...args]),
    setAppFont: (...args: unknown[]) => saved.push(['selected', ...args]),
  };
  const dependencies: Record<string, unknown> = {
    'react': { useState(initial: unknown) {
      const state = slots[cursor++] ??= { value: initial };
      return [state.value, (value: unknown) => { state.value = value; }];
    } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/DockScrollView': { DockScrollView: 'Scroll' },
    '@/components/Dialog': { Dialog: 'Dialog' },
    'expo-document-picker': { async getDocumentAsync() {
      if (failure === 'picker') throw new Error('Picker unavailable');
      return picked;
    } },
    'expo-font': { isLoaded: () => true },
    '@/components/SettingsUI': { SettingRow: 'Row', SelectList: 'Select', SettingsGroup: 'Group', SettingsPage: 'Page', settingsStyles: {} },
    '@/i18n': { useT: () => (value: string) => value },
    '@/lib/customFont': { async importCustomFont() {
      imports++;
      if (failure === 'import') throw new Error('Invalid font');
      return { family: 'ImportedFont', file: 'file:///saved.ttf' };
    }, removeCustomFontFiles() {} },
    '@/store/settings': { APP_FONT_LABELS: { system: 'System font', custom: 'Custom font' },
      useSettings: (select: (value: unknown) => unknown) => select(settings) },
    '@/theme': { useTheme() {} },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/app/settings/font.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports: Record<string, any> = {};
  runInNewContext(compiled.outputText, { exports, require(id: string) {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected font screen import ${id}`);
    return dependencies[id];
  } });
  function find(node: Element | Element[], type: string): Element | undefined {
    if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
    if (!node?.props) return;
    return node.type === type ? node : find(node.props.children, type);
  }
  let tree: Element;
  function render() { cursor = 0; tree = exports.default(); }
  render();
  return { render, saved, imports: () => imports,
    pick: () => find(tree, 'Row')!.props.onPress(), dialog: () => find(tree, 'Dialog')!.props,
    failAt: (stage: typeof failure) => { failure = stage; }, cancel: () => { picked = { canceled: true }; },
  };
}

describe('font import error dialog', () => {
  it('shows picker or import failures, supports both dismiss actions, and permits a successful retry', async () => {
    for (const stage of ['picker', 'import'] as const) {
      const h = harness();
      h.failAt(stage);
      await h.pick(); h.render();
      assert.equal(h.dialog().visible, true);
      assert.equal(h.dialog().title, "Couldn't load the font");
      assert.deepEqual(h.saved, [], 'a failed import must not change the font selection');
      (stage === 'picker' ? h.dialog().onCancel : h.dialog().onConfirm)(); h.render();
      assert.equal(h.dialog().visible, false);
      h.failAt(null);
      await h.pick(); h.render();
      assert.deepEqual(h.saved, [['custom', 'ImportedFont', 'file:///saved.ttf'], ['selected', 'custom']]);
      assert.equal(h.dialog().visible, false);
    }
  });

  it('keeps cancelling the OS picker quiet and leaves the current font untouched', async () => {
    const h = harness(); h.failAt(null); h.cancel();
    await h.pick(); h.render();
    assert.equal(h.dialog().visible, false);
    assert.equal(h.imports(), 0);
    assert.deepEqual(h.saved, []);
  });
});
