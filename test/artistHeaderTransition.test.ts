import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const activeImageLease = Object.freeze({ active: true });

import { artistHeroRenderer } from './helpers/artistHeroRenderer';

import {
  artistHeaderCopyGeometry, artistHeaderFromLayout, artistHeaderLocalSource, artistHeaderPhotoOffset,
  artistHeaderTransition, artistNameVisualFrame, artistPhotoParallax,
} from '../src/lib/artistHeaderTransition';

describe('artist visible-name handoff', () => {
  it('uses the measured bottom edge of both ordinary names and official artwork', () => {
    const ruler = { y: 347, height: 64 };
    const text = artistNameVisualFrame(ruler, 411, 24, 0);
    const logo = artistNameVisualFrame(ruler, 411, 24, 4826 / 1264);
    assert.equal(text.y + text.height, logo.y + logo.height);
    assert.ok(logo.y < text.y); assert.equal(ruler.y, 347); assert.equal(ruler.height, 64);
    const crossing = text.y + text.height - 88;
    for (const frame of [text, logo]) {
      const onTopEdge = artistHeaderTransition(frame.y - 88, 88, frame);
      assert.ok(onTopEdge.largeOpacity >= .9, 'touching the bar with the top cannot discard the whole name');
      const atBottom = artistHeaderTransition(crossing, 88, frame);
      assert.ok(atBottom.compactOpacity > .35, 'the compact title follows the bottom crossing');
      assert.ok(atBottom.largeOpacity < .35);
      assert.ok(artistHeaderTransition(crossing - 20, 88, frame).largeOpacity > 0);
    }
    assert.ok(Math.abs(artistHeaderTransition(crossing, 88, text).compactOpacity
      - artistHeaderTransition(crossing, 88, logo).compactOpacity) < 1e-12,
      'different artwork heights keep the same baseline handoff center');
  });

  it('has no blank handoff band or two simultaneously readable titles in either scroll direction', () => {
    for (const height of [20, 40, 80, 120]) {
      const name = { y: 387 - height, height };
      for (const direction of [1, -1]) {
        for (let t = 0; t < 1640; t++) {
          const y = direction === 1 ? -120 + t * .5 : 700 - t * .5;
          const state = artistHeaderTransition(y, 88, name);
          assert.ok(state.largeOpacity >= 0 && state.largeOpacity <= 1);
          assert.ok(state.compactOpacity >= 0 && state.compactOpacity <= 1);
          assert.ok(!(state.largeOpacity > .35 && state.compactOpacity > .35), 'only one readable title owns each frame');
          assert.ok(state.largeOpacity + state.compactOpacity >= .67, 'titles cannot blink out during handoff');
          assert.deepEqual(state, artistHeaderTransition(y, 88, name), 'reversing scroll must not depend on past frames');
        }
      }
      assert.equal(artistHeaderTransition(0, 88, name).largeOpacity, 1);
      assert.equal(artistHeaderTransition(650, 88, name).compactOpacity, 1);
    }
  });

  it('widens the visible fade to 28–64dp and keeps all three opacity curves continuous', () => {
    for (const height of [12, 40, 120]) {
      const name = { y: 387 - height, height };
      let previous = artistHeaderTransition(0, 88, name);
      let start = -1; let end = -1;
      for (let y = .125; y < 500; y += .125) {
        const current = artistHeaderTransition(y, 88, name);
        assert.ok(current.largeOpacity <= previous.largeOpacity);
        assert.ok(current.compactOpacity >= previous.compactOpacity);
        assert.ok(current.backgroundOpacity >= previous.backgroundOpacity);
        for (const role of ['largeOpacity', 'compactOpacity', 'backgroundOpacity'] as const) {
          assert.ok(Math.abs(current[role] - previous[role]) < .015, 'no threshold frame may snap');
        }
        if (start < 0 && current.largeOpacity < 1) start = y;
        if (start >= 0 && end < 0 && current.largeOpacity === 0) end = y;
        previous = current;
      }
      assert.ok(end - start >= 27.75 && end - start <= 64.25);
    }
  });

  it('waits for real layout and treats tall official logos by their visible frame', () => {
    for (const scroll of [0, 250, 1000]) {
      for (const invalid of [{ y: 0, height: 0 }, { y: NaN, height: 40 }, { y: 30, height: Infinity }]) {
        assert.deepEqual(artistHeaderFromLayout(scroll, 88, invalid, 411, 24, .4),
          { largeOpacity: 1, compactOpacity: 0, backgroundOpacity: 0 });
      }
    }
    for (const width of [320, 411, 680]) {
      const ruler = { y: 300, height: 104 };
      const frame = artistNameVisualFrame(ruler, width, 24, .4);
      assert.equal(frame.y + frame.height, 380);
      assert.ok(frame.height <= Math.max(ruler.height - 24, width * .23));
      for (let y = 0; y < 550; y += .5) {
        const state = artistHeaderFromLayout(y, 88, ruler, width, 24, .4);
        assert.ok(!(state.largeOpacity > .35 && state.compactOpacity > .35));
      }
    }
  });
});

describe('measured artist photograph motion', () => {
  it('matches the two Apple Music reference displacements and preserves that speed through the photo edge', () => {
    assert.equal(artistHeaderPhotoOffset(500, 411), -200, 'Xu Song: 500px content movement / 200px photograph movement');
    assert.ok(Math.abs(artistHeaderPhotoOffset(724, 411) - (-288)) < 2,
      'Lam: 724px content movement / about 288px photograph movement');
    for (const height of [140, 180, 411, 680]) {
      for (let y = 0; y <= height * 3.5; y += .25) {
        assert.ok(Math.abs(artistPhotoParallax(y, height) - y * .6) < 1e-9);
        assert.ok(Math.abs(artistHeaderPhotoOffset(y, height) + y * .4) < 1e-9);
      }
      for (const y of [height - .001, height, height + .001]) {
        const slope = (artistHeaderPhotoOffset(y + .0001, height) - artistHeaderPhotoOffset(y - .0001, height)) / .0002;
        assert.ok(Math.abs(slope + .4) < 1e-6, 'the visible frame edge cannot change scroll speed');
      }
    }
  });

  it('keeps long lists stable and bounds compensation only after the field is entirely offscreen', () => {
    for (const height of [140, 180, 411, 680]) {
      const maximumField = Math.max(height * 1.35, height + 120);
      let previous = 0;
      for (const scroll of [0, height, height * 2, height * 4, height * 8 + 512, 10000, 1000000]) {
        const offset = artistHeaderPhotoOffset(scroll, height);
        assert.ok(Number.isFinite(offset) && offset <= previous);
        assert.ok(artistPhotoParallax(scroll, height) <= (height * 8 + 512) * .6);
        if (scroll >= height * 8 + 512) assert.ok(offset + maximumField < 0);
        previous = offset;
      }
    }
    for (const scroll of [NaN, Infinity, -Infinity]) {
      assert.equal(artistHeaderPhotoOffset(scroll, 411), 0);
      assert.equal(artistPhotoParallax(scroll, 411), 0);
    }
    for (const height of [0, -1, NaN, Infinity]) assert.ok(Number.isFinite(artistHeaderPhotoOffset(500, height)));
  });
});

describe('same-source artist navigation copy', () => {
  it('samples the same source coordinate as page scrolling plus hero parallax, including the feather edge', () => {
    for (const [width, photoHeight, density] of [[320, 320, 1], [411, 411, 3.5], [680, 215, 4]]) {
      const extension = photoHeight * .35;
      const small = artistHeaderCopyGeometry(width, photoHeight, extension, density);
      assert.ok(small.width * density <= 240.00001, 'static blur/mask buffers have a bounded physical width');
      assert.ok(Math.abs(small.width / small.photoHeight - width / photoHeight) < 1e-10, 'cover crop cannot change');
      for (const scroll of [-80, 0, .5, 150, photoHeight - .001, photoHeight, photoHeight + .001, 700]) {
        // The reference advances the photograph by 0.4 of positive content scroll.
        const pageWorldY = scroll < 0 ? -scroll : -scroll * .4;
        for (const viewportY of [0, 87.999, 88, 88.001, 143.999, 144, 144.001]) {
          const sourceInPage = viewportY - pageWorldY;
          const sourceInSmallCopy = (viewportY - artistHeaderPhotoOffset(scroll, photoHeight)) * small.scale;
          assert.ok(Math.abs(sourceInSmallCopy / small.photoHeight - sourceInPage / photoHeight) < 1e-10,
            'source UVs stay continuous across the navigation bar and its lower feather');
        }
      }
      for (const boundary of [0, photoHeight]) {
        assert.ok(Math.abs(artistHeaderPhotoOffset(boundary - 1e-6, photoHeight)
          - artistHeaderPhotoOffset(boundary + 1e-6, photoHeight)) < 3e-6);
      }
    }
  });

  it('never hands an uncached remote image or cache-only marker to the extra image loader', () => {
    assert.equal(artistHeaderLocalSource('file:///cache/artist.webp'), 'file:///cache/artist.webp');
    assert.equal(artistHeaderLocalSource('content://artwork/1'), 'content://artwork/1');
    for (const uri of [undefined, 'cached-cover:https://example.com/a.jpg', 'https://example.com/a.jpg', '/cache/a.jpg']) {
      assert.equal(artistHeaderLocalSource(uri), undefined);
    }
  });
});

function findElement(tree: any, predicate: (element: any) => boolean): any {
  if (Array.isArray(tree)) { for (const child of tree) { const found = findElement(child, predicate); if (found) return found; } }
  else if (tree?.props) { if (predicate(tree)) return tree; return findElement(tree.props.children, predicate); }
}

function resolvedStyle(style: any): any {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(resolvedStyle));
  return style?.read ? style.read() : style ?? {};
}

function heroWorldOffset(tree: any, offset = 0, scale = 1): number | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = heroWorldOffset(child, offset, scale); if (found !== undefined) return found; }
  } else if (tree?.props) {
    const transforms = resolvedStyle(tree.props.style).transform ?? [];
    for (const transform of transforms) { offset += (transform.translateY ?? 0) * scale; scale *= transform.scale ?? transform.scaleY ?? 1; }
    if (tree.type === 'SameHero') {
      for (const transform of resolvedStyle(tree.props.imageStyle).transform ?? []) offset += (transform.translateY ?? 0) * scale;
      return offset;
    }
    return heroWorldOffset(tree.props.children, offset, scale);
  }
}

function backdropHarness() {
  const slots: any[] = []; let cursor = 0; const effects: (() => void)[] = []; const cleanups = new Set<() => void>();
  const slot = <T,>(create: () => T): T => { const i = cursor++; return i in slots ? slots[i] : slots[i] = create(); };
  const effect = (create: () => (() => void), deps: unknown[]) => {
    const state = slot(() => ({ deps: undefined as unknown[] | undefined, cleanup: undefined as (() => void) | undefined }));
    if (state.deps?.every((value, i) => Object.is(value, deps[i]))) return;
    state.deps = deps; effects.push(() => { if (state.cleanup) { state.cleanup(); cleanups.delete(state.cleanup); }
      state.cleanup = create(); cleanups.add(state.cleanup); });
  };
  const exports: Record<string, any> = {}; const jsx = (type: unknown, props: object, key?: string) => ({ type, props, key });
  let stateWrites = 0;
  const imports: Record<string, unknown> = {
    react: { memo: (component: unknown) => component, useLayoutEffect: effect,
      useMemo: (create: () => unknown, deps: unknown[]) => {
        const state = slot(() => ({ value: create(), deps }));
        if (!state.deps.every((value, i) => Object.is(value, deps[i]))) { state.value = create(); state.deps = deps; }
        return state.value;
      },
      useRef: <T,>(value: T) => slot(() => ({ current: value })),
      useState: <T,>() => { const state = slot(() => ({ value: undefined as T | undefined }));
        return [state.value, (next: T | ((previous: T | undefined) => T)) => { stateWrites++;
          state.value = typeof next === 'function' ? (next as (previous: T | undefined) => T)(state.value) : next; }]; },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@react-native-masked-view/masked-view': { __esModule: true, default: 'Mask' },
    'expo-linear-gradient': { LinearGradient: 'Gradient' },
    'react-native': { View: 'View', PixelRatio: { get: () => 3.5 }, StyleSheet: { create: (value: unknown) => value, absoluteFill: {} } },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' }, useAnimatedStyle: (read: () => unknown) => ({ read }) },
    '@/lib/artistHeaderTransition': { artistHeaderCopyGeometry, artistHeaderLocalSource, artistPhotoParallax, artistHeaderPhotoOffset },
    '@/components/RouteImageResources': { useRouteImageLease: () => activeImageLease },
    './VoltaDetailHeroFade': { VoltaDetailHeroFade: 'SameHero' },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/volta/VoltaArtistHeaderBackdrop.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  let scroll = 0; let opacity = .75;
  const props = { color: '#67686c', height: 88, width: 411, photoHeight: 411, extensionHeight: 144,
    uri: 'https://example.com/portrait.jpg', sourceUri: undefined as string | undefined, textureUri: undefined as string | undefined,
    scrollY: { get: () => scroll }, opacity: { get: () => opacity } };
  return {
    props,
    render() { cursor = 0; const tree = exports.VoltaArtistHeaderBackdrop(props); while (effects.length) effects.shift()!(); return tree; },
    hero(tree: any) { return findElement(tree, (element) => element.type === 'SameHero')!; },
    scroll(value: number) { scroll = value; }, opacity(value: number) { opacity = value; },
    writes: () => stateWrites,
    unmount() { for (const cleanup of cleanups) cleanup(); },
  };
}

it('renders one matching cached hero inside a static feather and updates only its UI-thread transform while scrolling', () => {
  const h = backdropHarness(); let tree = h.render();
  assert.equal(tree.props.style[2].read().opacity, 0, 'a pending photo is not replaced by a solid navigation color');
  h.props.sourceUri = 'file:///artist.webp'; h.props.textureUri = 'file:///field.png'; tree = h.render();
  const hero = h.hero(tree);
  assert.equal(hero.type, 'SameHero'); assert.equal(hero.props.uri, undefined);
  assert.equal(hero.props.sourceUri, h.props.sourceUri); assert.equal(hero.props.textureUri, h.props.textureUri);
  assert.equal(hero.props.blurRadius, 2); assert.equal(hero.props.fieldTransition, 0);
  assert.equal(heroWorldOffset(tree), 0);
  hero.props.onLayerDisplay('sharp'); tree = h.render(); assert.equal(tree.props.style[2].read().opacity, 0);
  hero.props.onLayerDisplay('field'); tree = h.render(); assert.equal(tree.props.style[2].read().opacity, .75);
  assert.equal(tree.props.pointerEvents, 'none'); assert.equal(tree.props.style[1].height, 144);
  const mask = tree.props.children;
  assert.equal(mask.props.maskElement.props.colors.at(-1), '#FFFFFF00');
  assert.equal(mask.props.maskElement.props.locations[1], 88 / 144);
  const before = h.writes();
  for (const scroll of [-20, 0, 180, 411, 600, 30]) {
    h.scroll(scroll);
    assert.ok(Math.abs(heroWorldOffset(tree)! - artistHeaderPhotoOffset(scroll, 411)) < 1e-10,
      'the prepared navigation plane must have the same world displacement as the main scene');
  }
  assert.equal(h.writes(), before, 'scrolling must not call setState or initiate another blur/decode');
  h.opacity(.4); assert.equal(tree.props.style[2].read().opacity, .4);
});

it('keeps failed/pending copies transparent and rejects callbacks from obsolete artists, including A → B → A', () => {
  const h = backdropHarness(); h.props.sourceUri = 'file:///A.webp'; h.props.textureUri = 'file:///A.png';
  let tree = h.render(); const old = h.hero(tree);
  old.props.onLayerDisplay('sharp'); old.props.onLayerDisplay('field'); tree = h.render();
  assert.equal(tree.props.style[2].read().opacity, .75);
  h.props.sourceUri = 'file:///B.webp'; h.props.textureUri = 'file:///B.png'; tree = h.render();
  assert.equal(tree.props.style[2].read().opacity, 0);
  h.props.sourceUri = 'file:///A.webp'; h.props.textureUri = 'file:///A.png'; tree = h.render();
  assert.equal(tree.props.style[2].read().opacity, 0, 'previously displayed bytes do not certify a newly mounted native image');
  old.props.onLayerDisplay('sharp'); old.props.onLayerDisplay('field'); old.props.onLayerError('field'); tree = h.render();
  assert.equal(tree.props.style[2].read().opacity, 0);
  const current = h.hero(tree); current.props.onLayerDisplay('sharp'); current.props.onLayerDisplay('field'); tree = h.render();
  assert.equal(tree.props.style[2].read().opacity, .75);
  current.props.onLayerError('sharp'); tree = h.render(); assert.equal(tree.props.style[2].read().opacity, 0);
  const writes = h.writes(); h.unmount(); current.props.onLayerDisplay('sharp'); assert.equal(h.writes(), writes);
});

it('shows natural body color when there is no photograph and never copies an unverified remote source', () => {
  const h = backdropHarness(); h.props.uri = undefined as any;
  let tree = h.render(); assert.equal(tree.props.style[2].read().opacity, .75);
  h.props.uri = 'https://example.com/portrait.jpg'; h.props.sourceUri = h.props.uri; h.props.textureUri = 'file:///field.png';
  tree = h.render(); const hero = h.hero(tree); hero.props.onLayerDisplay('field'); tree = h.render();
  assert.equal(h.hero(tree).props.sourceUri, undefined); assert.equal(tree.props.style[2].read().opacity, 0);
});

function heroRenderer() {
  return artistHeroRenderer().settled;
}

it('preserves the original hero mask, photo crop and default blur while allowing a static smaller copy', () => {
  const render = heroRenderer();
  const props = { uri: 'https://example.com/photo.jpg', sourceUri: 'file:///photo.jpg', textureUri: 'file:///field.png',
    width: 411, height: 411, extensionHeight: 144, imageStyle: {} };
  const original = render(props);
  const small = artistHeaderCopyGeometry(411, 411, 144, 3.5);
  const copy = render({ ...props, width: small.width, height: small.photoHeight,
    extensionHeight: small.extensionHeight, blurRadius: 2, fieldTransition: 0 });
  const mainMask = original.props.children.props.children; const copyMask = copy.props.children.props.children;
  copyMask.props.maskElement.props.locations.forEach((value: number, i: number) => {
    assert.ok(Math.abs(value - mainMask.props.maskElement.props.locations[i]) < 1e-10,
      'the final fade must be the same normalized .52H → H+extension ramp, not an independent navigation gradient');
  });
  const [mainField, mainSharp] = mainMask.props.children; const [copyField, copySharp] = copyMask.props.children;
  assert.equal(mainField.props.transition, 160); assert.equal(mainField.props.blurRadius, 0);
  assert.equal(mainSharp.props.children.props.blurRadius, 0);
  assert.equal(copyField.props.transition, 0); assert.equal(copySharp.props.children.props.blurRadius, 2);
  assert.equal(copySharp.props.children.props.contentFit, mainSharp.props.children.props.contentFit);
  assert.deepEqual(copySharp.props.maskElement.props.locations, mainSharp.props.maskElement.props.locations);
});

it('keeps static photo/field alpha aligned past the old content clip throughout the viewport', () => {
  const render = heroRenderer();
  const props = { uri: undefined, sourceUri: 'file:///photo.jpg', textureUri: 'file:///field.png',
    width: 411, height: 411, extensionHeight: 144, imageStyle: {} };
  const full = render(props); const small = artistHeaderCopyGeometry(411, 411, 144, 3.5);
  const copy = render({ ...props, width: small.width, height: small.photoHeight, extensionHeight: small.extensionHeight });
  const fullMask = full.props.children.props.children; const smallMask = copy.props.children.props.children;
  const fullSharp = fullMask.props.children[1]; const smallSharp = smallMask.props.children[1];
  const alpha = (locations: number[], y: number, height: number) =>
    Math.max(0, Math.min(1, (locations[2] - y / height) / (locations[2] - locations[1])));
  for (const scroll of [-90, 0, .001, 200, 410.999, 411, 411.001, 560, 850, 5000]) {
    const worldY = artistHeaderPhotoOffset(scroll, 411);
    const probes = [0, 88, 144, ...Array.from({ length: 86 }, (_, i) => i * 11)];
    for (const edge of [worldY, worldY + 411, worldY + 555]) {
      if (edge >= 0) probes.push(edge - 1e-6, edge, edge + 1e-6);
    }
    for (const viewportY of probes) {
      const originalSource = viewportY - worldY;
      const copySource = originalSource * small.scale;
      const fullVisible = originalSource >= 0 && originalSource < 555;
      const copyVisible = copySource >= 0 && copySource < small.photoHeight + small.extensionHeight;
      const originalFieldAlpha = fullVisible ? alpha(fullMask.props.maskElement.props.locations, originalSource, 555) : 0;
      const copyFieldAlpha = copyVisible ? alpha(smallMask.props.maskElement.props.locations, copySource,
        small.photoHeight + small.extensionHeight) : 0;
      const originalSharpAlpha = originalSource < 411 ? originalFieldAlpha
        * alpha(fullSharp.props.maskElement.props.locations, originalSource, 411) : 0;
      const copySharpAlpha = copySource < small.photoHeight ? copyFieldAlpha
        * alpha(smallSharp.props.maskElement.props.locations, copySource, small.photoHeight) : 0;
      assert.ok(Math.abs(originalFieldAlpha - copyFieldAlpha) < 1e-10, `field source-alpha diverged at scroll=${scroll}, y=${viewportY}`);
      assert.ok(Math.abs(originalSharpAlpha - copySharpAlpha) < 1e-10, `sharp source-alpha diverged at scroll=${scroll}, y=${viewportY}`);
    }
  }
  const scroll = 200;
  const tailY = artistHeaderPhotoOffset(scroll, 411) + 555 * .9;
  assert.ok(tailY > 555 - scroll, 'the real fading tail crosses the obsolete ScrollView clip');
  assert.ok(alpha(fullMask.props.maskElement.props.locations, 555 * .9, 555) > .1,
    'that visible tail must be allowed to finish instead of being cut at a fixed container boundary');
});


it('initializes valid closures through the installed Babel worklets transform and executes their serialized UI code', () => {
  const { transformSync } = createRequire(import.meta.url)('@babel/core') as {
    transformSync(source: string, options: Record<string, unknown>): { code?: string | null } | null;
  };
  const source = readFileSync(new URL('../src/lib/artistHeaderTransition.ts', import.meta.url), 'utf8');
  const modes = [
    { plugins: ['@babel/plugin-transform-typescript', 'react-native-worklets/plugin', '@babel/plugin-transform-modules-commonjs'] },
    { envName: 'production', presets: ['babel-preset-expo'], plugins: ['@babel/plugin-transform-modules-commonjs'],
      caller: { name: 'metro', platform: 'android', isDev: false, supportsStaticESM: true, supportsDynamicImport: true } },
  ];
  for (const mode of modes) {
  const compiled = transformSync(source, { filename: new URL('../src/lib/artistHeaderTransition.ts', import.meta.url).pathname,
    configFile: false, babelrc: false, ...mode });
  const exports: Record<string, any> = {};
  // Ordinary TypeScript test execution preserves declaration hoisting. The
  // native Babel plugin instead creates worklet factories with eager captures.
  runInNewContext(compiled!.code!, { exports, global: { Error } });
  assert.equal(exports.artistHeaderPhotoOffset.__closure.artistPhotoParallax, exports.artistPhotoParallax);

  const restored = new Map<any, (...args: any[]) => any>();
  function restore(worklet: any): (...args: any[]) => any {
    if (restored.has(worklet)) return restored.get(worklet)!;
    assert.equal(typeof worklet, 'function');
    assert.equal(typeof worklet.__initData?.code, 'string');
    const closure: Record<string, any> = {};
    for (const [key, value] of Object.entries(worklet.__closure)) {
      assert.notEqual(value, undefined, `worklet capture ${key} was initialized too early`);
      closure[key] = typeof value === 'function' && (value as any).__initData ? restore(value) : value;
    }
    const ui = runInNewContext(`(${worklet.__initData.code})`) as (...args: any[]) => any;
    const invoke = (...args: any[]) => ui.apply({ __closure: closure }, args);
    restored.set(worklet, invoke);
    return invoke;
  }
  const offset = restore(exports.artistHeaderPhotoOffset);
  const name = restore(exports.artistHeaderFromLayout);
  for (const scroll of [-80, 0, 200, 500, 724, 20000]) {
    assert.equal(offset(scroll, 411), artistHeaderPhotoOffset(scroll, 411));
    assert.deepEqual(JSON.parse(JSON.stringify(name(scroll, 88, { y: 300, height: 104 }, 411, 24, .4))),
      artistHeaderFromLayout(scroll, 88, { y: 300, height: 104 }, 411, 24, .4));
  }
  }
});
