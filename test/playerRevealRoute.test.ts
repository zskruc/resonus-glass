import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createPlayerRevealGuard } from '@/lib/playerRevealOwner';

const source = ts.createSourceFile('player.tsx', readFileSync(new URL('../src/app/player.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const wrapper = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'PlayerScreen');
assert.ok(wrapper);
const code = ts.transpileModule(wrapper.getText(source), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

function harness(reveal?: string, presentation = 'amll') {
  const guard = createPlayerRevealGuard(), layout: (() => void)[] = [], effects: (() => void)[] = [];
  const offset = { value: 800 }, api: Record<string, any> = {}, calls = { back: 0 };
  runInNewContext(code, {
    exports: api, require: () => ({ jsx: (type: unknown) => type }),
    useSettings: (select: (state: object) => unknown) => select({ playerPresentation: presentation }),
    useIsFocused: () => true, useRouter: () => ({ canGoBack: () => true, back: () => { calls.back++; } }),
    useLocalSearchParams: () => ({ reveal }), useState: (create: () => unknown) => [create()],
    useLayoutEffect: (effect: () => void) => layout.push(effect), useEffect: (effect: () => void) => effects.push(effect),
    playerRevealGuard: guard, revealOffset: offset, AmllPlayerScreen: 'AMLL', ResonusPlayerScreen: 'Resonus',
  });
  return { guard, offset, calls, render: () => api.default(),
    layout: () => layout.forEach((effect) => effect()), effects: () => effects.forEach((effect) => effect()) };
}

test('both actual player presentations clear a leftover pull offset on an ordinary open', () => {
  for (const presentation of ['amll', 'resonus']) {
    const h = harness(undefined, presentation); h.guard.begin(); h.render(); h.layout(); h.effects();
    assert.equal(h.offset.value, -1); assert.equal(h.calls.back, 0);
  }
});

test('the actual player wrapper never mounts a late cancelled surface before removing its route', () => {
  const h = harness('pull-1'); const request = h.guard.begin(); h.guard.cancel(request);
  assert.equal(h.render(), null);
  h.layout();
  assert.equal(h.offset.value, 800, 'do not expose a full surface while navigation removal is pending');
  h.effects(); assert.equal(h.calls.back, 1);
});

test('a current pull keeps its offset and a newer focused route cannot be popped by an old effect', () => {
  const h = harness('pull-1'); h.guard.begin(); h.render(); h.layout(); h.effects();
  assert.equal(h.offset.value, 800); assert.equal(h.calls.back, 0);
  h.guard.cancel('pull-1'); h.guard.focus({}, null); h.effects();
  assert.equal(h.calls.back, 0);
});
