import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { artistHeaderPhotoOffset } from '../src/lib/artistHeaderTransition';

type Node = { type: unknown; props: Record<string, any> };

/** Execute the production scene plane; only the RN host and UI-thread hook are replaced. */
function plane() {
  let offset = 0;
  let renders = 0;
  let stateWrites = 0;
  const jsx = (type: unknown, props: Node['props']) => ({ type, props });
  const imports: Record<string, unknown> = {
    react: { memo: (component: unknown) => component,
      useState: () => { throw new Error('a scroll-only image plane must not subscribe to React frame state'); },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { StyleSheet: { create: (value: unknown) => value } },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useAnimatedStyle: (read: () => unknown) => ({ read }),
      runOnJS: () => { stateWrites++; throw new Error('image scrolling must stay on the UI thread'); },
    },
    '@/lib/artistHeaderTransition': { artistHeaderPhotoOffset },
    '@/components/DetailHeroScene': { useDetailHeroReporter: () => undefined },
    './VoltaDetailHeroFade': { VoltaDetailHeroFade: 'PreparedHero' },
  };
  const exported: Record<string, any> = {};
  const source = readFileSync(new URL('../src/components/volta/VoltaArtistScrollBackdrop.tsx', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports: exported, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected scene-plane dependency: ${name}`);
    return imports[name];
  } });
  const scrollY = { get: () => offset };
  const props = { width: 400, height: 400, extensionHeight: 160, backgroundColor: '#60686a',
    uri: 'https://example.com/artist-full.jpg', sourceUri: 'file:///cache/artist-full.jpg',
    textureUri: 'file:///cache/prepared-field.png', cacheOnly: true, scrollY, onError() {},
  };
  return {
    props,
    render(next: Record<string, unknown> = {}) {
      renders++;
      return exported.VoltaArtistScrollBackdrop({ ...props, ...next }) as Node;
    },
    scroll(value: number) { offset = value; },
    counters: () => ({ renders, stateWrites }),
  };
}

function position(tree: Node) {
  const animated = tree.props.style.find((value: any) => typeof value?.read === 'function');
  assert.ok(animated, 'the persistent scene plane must be driven by the UI-thread style');
  return animated.read().transform[0].translateY as number;
}

describe('persistent artist scroll backdrop', () => {
  it('matches the measured photo movement while its feather remains visible past the old header boundary', () => {
    const h = plane();
    const tree = h.render();
    assert.equal(tree.props.pointerEvents, 'none');
    assert.equal(tree.props.accessible, false);
    assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants');
    const frame = tree.props.style.find((value: any) => value?.height !== undefined);
    assert.equal(frame.height, 560, 'the same world plane includes the real photo and complete extended tail');
    const hero = tree.props.children as Node;
    assert.equal(hero.type, 'PreparedHero');
    assert.deepEqual(Object.keys(hero.props.imageStyle), [], 'inner masks and pixels stay static on the moving world plane');
    for (const [scroll, expected] of [[0, 0], [500, -200], [724, -289.6]]) {
      h.scroll(scroll);
      assert.ok(Math.abs(position(tree) - expected) < 1e-8,
        'the plane follows the reference 0.4× content movement, not an additional accelerated scroll');
    }
    h.scroll(500);
    assert.ok(frame.height + position(tree) > 0,
      'after the original 400dp header has left recycled content, the feather still has 360dp to paint');
    h.scroll(2_000);
    assert.ok(frame.height + position(tree) < 0, 'the whole image eventually leaves the viewport without a stuck strip');
    h.scroll(0);
    assert.equal(position(tree), 0, 'returning to the top lands at the original photograph pose');
  });

  it('updates neither React state nor image requests or blur configuration across thousands of native scroll samples', () => {
    const h = plane();
    const tree = h.render();
    const hero = tree.props.children as Node;
    const sources = [hero.props.uri, hero.props.sourceUri, hero.props.textureUri];
    const counters = h.counters();
    for (let scroll = -100; scroll < 80_000; scroll += 25) {
      h.scroll(scroll);
      assert.ok(Number.isFinite(position(tree)));
      assert.deepEqual([hero.props.uri, hero.props.sourceUri, hero.props.textureUri], sources);
      assert.equal(hero.props.blurRadius, undefined, 'scroll frames must not allocate another blur pipeline');
    }
    assert.deepEqual(h.counters(), counters, 'the same mounted plane handles all frames with no JS render or state work');
    const repeated = h.render();
    assert.equal(repeated.props.children.props.imageStyle, hero.props.imageStyle,
      'an unrelated parent render keeps the same static inner-mask style');
    assert.equal(repeated.props.children.props.onError, h.props.onError);
    assert.equal(repeated.props.children.props.cacheOnly, true, 'offline/cache-only ownership reaches the existing image loader');
    const changed = h.render({ sourceUri: 'file:///cache/replaced-artist.jpg', textureUri: 'file:///cache/replaced-field.png' });
    assert.equal(changed.props.children.props.sourceUri, 'file:///cache/replaced-artist.jpg');
    assert.equal(changed.props.children.props.textureUri, 'file:///cache/replaced-field.png');
    assert.equal(changed.props.children.props.imageStyle, hero.props.imageStyle);
  });
});

it('owns the artist photograph in the scene rather than the clipped scroll header', () => {
  const source = ts.createSourceFile('ArtistScreen.tsx',
    readFileSync(new URL('../src/app/artist/[id].tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const planes: ts.JsxSelfClosingElement[] = [];
  const scrolls: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'VoltaArtistScrollBackdrop') planes.push(node);
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'AnimatedPage') scrolls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(planes.length, 1, 'only one scene photograph should paint this artist');
  assert.equal(scrolls.length, 1);
  const owners: ts.JsxElement[] = [];
  for (let parent = planes[0].parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent)) owners.push(parent);
  }
  assert.equal(owners.includes(scrolls[0]), false,
    'native ScrollView clipping must never remove the still-visible slow-moving feather');
  assert.equal(owners[0], scrolls[0].parent,
    'the photo and scrolling content share the same scene geometry without a second scroll host');
  assert.ok(planes[0].pos < scrolls[0].pos, 'content and touch targets paint above the pointer-free photograph');
});
