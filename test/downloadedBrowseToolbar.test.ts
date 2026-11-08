import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import ts from 'typescript';

/** Execute the actual browser toolbar JSX, with no native browser/list mocks. */
function toolbar(file: string, downloaded: boolean) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node: ts.JsxSelfClosingElement | undefined;
  const find = (child: ts.Node) => {
    if (ts.isJsxSelfClosingElement(child) && child.tagName.getText(ast) === 'BrowseToolbar') node = child;
    child.forEachChild(find);
  };
  ast.forEachChild(find); assert.ok(node, `${file} must contain its production toolbar`);
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(`exports.result = (${node.getText(ast)});`, {
    fileName: 'toolbar.tsx', compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, React, BrowseToolbar: 'BrowseToolbar', downloaded,
    SORTS: [{ key: 'recent', label: 'Recent' }], SORT_LABEL: { recent: 'Recent' }, sorts: ['recent'],
    sort: 'recent', setSort: () => {}, setSelectedIds: () => {}, t: (key: string) => key });
  return exports.result.props;
}

test('Downloaded songs removes the real server-library Play and Shuffle target, retaining sort controls', () => {
  const filtered = toolbar('app/browse/songs.tsx', true), normal = toolbar('app/browse/songs.tsx', false);
  assert.equal(filtered.play, undefined);
  assert.equal(filtered.value, 'recent'); assert.equal(typeof filtered.onChange, 'function');
  assert.equal(filtered.options[0].key, 'recent');
  assert.equal(normal.play.href, '/browse/songs'); assert.equal(normal.play.sort, 'recent');
});
test('Downloaded albums also hides the server-library play target; artists and playlists never expose one', () => {
  assert.equal(toolbar('app/browse/albums.tsx', true).play, undefined);
  assert.equal(toolbar('app/browse/albums.tsx', false).play.href, '/browse/albums');
  for (const downloaded of [false, true]) {
    assert.equal(toolbar('app/browse/artists.tsx', downloaded).play, undefined);
    assert.equal(toolbar('components/PlaylistsBrowser.tsx', downloaded).play, undefined);
  }
});
