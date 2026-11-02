import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Events = { coverDisplayed(): void; fieldDisplayed(): void };
type Props = { enabled: boolean; uri?: string; textureUri?: string; prepared: boolean };

/** Real React/provider/effect lifecycle; native image display and route ownership
 * are explicit boundaries. This does not decode images or measure frame rate. */
function harness() {
  let lease = { active: true };
  let events!: Events, saved!: object, mounts = 0;
  const reports: boolean[] = [];
  const report = (ready: boolean) => { reports.push(ready); };
  const exports: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    '@/components/DetailHeroScene': { useDetailHeroReporter: () => report },
    '@/components/RouteImageResources': { useRouteImageLease: () => lease },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/components/primuse/PrimuseAlbumScene.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected scene import ${name}`);
    return imports[name];
  } });
  function Child() {
    events = exports.usePrimuseAlbumScene();
    const [state] = React.useState(() => ({ selected: 'second-A', scroll: 318 }));
    saved = state;
    React.useLayoutEffect(() => { mounts++; return () => { mounts--; }; }, []);
    return React.createElement('content', { saved: state });
  }
  const render = (props: Props) => React.createElement(exports.PrimuseAlbumScene, props, React.createElement(Child));
  return { render, reports, events: () => events, saved: () => saved, mounts: () => mounts,
    last: () => reports.at(-1), lease(active: boolean) { lease = { active }; } };
}

test('a cover displayed before preparation remains ready when its field arrives later', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render({ enabled: true, uri: 'A', prepared: false })); });
    const saved = h.saved(), cover = h.events().coverDisplayed;
    await act(async () => { cover(); });
    assert.equal(h.last(), false);
    await act(async () => { renderer.update(h.render({ enabled: true, uri: 'A', textureUri: 'field-A', prepared: true })); });
    assert.equal(h.events().coverDisplayed, cover, 'field preparation must not reset the already displayed cover');
    assert.equal(h.last(), false, 'the undisplayed field still prevents a layered reveal');
    await act(async () => { h.events().fieldDisplayed(); });
    assert.equal(h.last(), true);
    assert.equal(h.saved(), saved); assert.equal(h.mounts(), 1);
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('a field cannot reveal the scene early and replacing only the field keeps the cover ownership', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render({ enabled: true, uri: 'A', textureUri: 'field-A', prepared: true })); });
    const first = h.events();
    await act(async () => { first.fieldDisplayed(); });
    assert.equal(h.last(), false, 'background pixels cannot reveal a missing foreground cover');
    await act(async () => { first.coverDisplayed(); });
    assert.equal(h.last(), true);
    await act(async () => { renderer.update(h.render({ enabled: true, uri: 'A', textureUri: 'field-A-2', prepared: true })); });
    assert.equal(h.events().coverDisplayed, first.coverDisplayed);
    await act(async () => { first.fieldDisplayed(); });
    assert.equal(h.last(), true, 'a revealed cover/lease remains visible while its local field revalidates');
    await act(async () => { h.events().fieldDisplayed(); });
    assert.equal(h.last(), true);
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('replacing a field before the first reveal rejects its old callback', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(h.render({ enabled: true, uri: 'A', textureUri: 'field-A', prepared: true })); });
    const first = h.events();
    await act(async () => { first.coverDisplayed(); });
    await act(async () => { renderer.update(h.render({ enabled: true, uri: 'A', textureUri: 'field-A-2', prepared: true })); });
    await act(async () => { first.fieldDisplayed(); });
    assert.equal(h.last(), false);
    await act(async () => { h.events().fieldDisplayed(); });
    assert.equal(h.last(), true);
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('A to B to A never accepts display callbacks from either earlier scene', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  const props = (uri: string): Props => ({ enabled: true, uri, textureUri: `field-${uri}`, prepared: true });
  try {
    await act(async () => { renderer = create(h.render(props('A'))); });
    const firstA = h.events();
    await act(async () => { renderer.update(h.render(props('B'))); });
    const previousB = h.events();
    await act(async () => { renderer.update(h.render(props('A'))); });
    const current = h.events();
    await act(async () => { firstA.coverDisplayed(); firstA.fieldDisplayed(); previousB.coverDisplayed(); previousB.fieldDisplayed(); });
    assert.equal(h.last(), false, 'matching URI strings do not give an old generation current ownership');
    await act(async () => { current.coverDisplayed(); });
    assert.equal(h.last(), false);
    await act(async () => { current.fieldDisplayed(); });
    assert.equal(h.last(), true);
  } finally { await act(async () => { renderer?.unmount(); }); }
});

test('lease reacquisition requires fresh displays and disabled styles retain children without reporting', async () => {
  const h = harness(); let renderer!: ReactTestRenderer;
  const props = (enabled = true): Props => ({ enabled, uri: 'A', textureUri: 'field-A', prepared: true });
  try {
    await act(async () => { renderer = create(h.render(props())); });
    const saved = h.saved(), original = h.events();
    await act(async () => { original.coverDisplayed(); original.fieldDisplayed(); });
    assert.equal(h.last(), true);
    h.lease(false);
    await act(async () => { renderer.update(h.render(props())); });
    const inactive = h.events();
    assert.equal(h.last(), false);
    h.lease(true);
    await act(async () => { renderer.update(h.render(props())); });
    await act(async () => { original.coverDisplayed(); original.fieldDisplayed(); inactive.coverDisplayed(); inactive.fieldDisplayed(); });
    assert.equal(h.last(), false, 'reacquired images need this lease to display them again');
    await act(async () => { h.events().fieldDisplayed(); });
    assert.equal(h.last(), false);
    await act(async () => { h.events().coverDisplayed(); });
    assert.equal(h.last(), true);
    const count = h.reports.length;
    await act(async () => { renderer.update(h.render(props(false))); });
    await act(async () => { h.events().coverDisplayed(); h.events().fieldDisplayed(); });
    assert.equal(h.reports.length, count, 'an inactive presentation cannot reset the surrounding detail scene');
    assert.equal(h.saved(), saved); assert.equal(h.mounts(), 1);
    await act(async () => { renderer.update(h.render(props())); });
    assert.equal(h.last(), false);
    assert.equal(h.saved(), saved); assert.equal(h.mounts(), 1);
  } finally { await act(async () => { renderer?.unmount(); }); }
  assert.equal(h.mounts(), 0);
});
