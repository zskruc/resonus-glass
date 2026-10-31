import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { artistHeroRenderer } from './helpers/artistHeroRenderer';

import {
  artistHeaderCopyGeometry, artistHeaderFromLayout, artistHeaderLocalSource, artistHeaderPhotoOffset,
  artistHeaderTransition, artistNameVisualFrame, artistPhotoParallax,
} from '../src/lib/artistHeaderTransition';

describe('artist visible-name handoff', () => {
  it('uses the measured logo bounds without moving its text baseline or the controls', () => {
    const ruler = { y: 347, height: 64 };
    const text = artistNameVisualFrame(ruler, 411, 24, 0);
    const logo = artistNameVisualFrame(ruler, 411, 24, 4826 / 1264);
    assert.equal(text.y + text.height, logo.y + logo.height);
    assert.ok(logo.y < text.y); assert.equal(ruler.y, 347); assert.equal(ruler.height, 64);
    assert.ok(artistHeaderTransition(245, 88, logo).compactOpacity > artistHeaderTransition(245, 88, text).compactOpacity,
      'a taller logo must leave the bar according to its actual visible top');
  });

  it('never draws the large name/logo and compact title together throughout forward and reverse scrolling', () => {
    for (const height of [40, 80, 120]) {
      const name = { y: 347 - height + 40, height };
      for (let y = -120; y < 700; y += .5) {
        const state = artistHeaderTransition(y, 88, name);
        assert.ok(state.largeOpacity >= 0 && state.largeOpacity <= 1);
        assert.ok(state.compactOpacity >= 0 && state.compactOpacity <= 1);
        assert.equal(state.largeOpacity * state.compactOpacity, 0, 'only one readable title may own each scroll frame');
      }
      assert.equal(artistHeaderTransition(0, 88, name).largeOpacity, 1);
      assert.equal(artistHeaderTransition(650, 88, name).compactOpacity, 1);
    }
  });

  it('keeps background and title fades continuous and bounded rather than snapping at the threshold', () => {
    const name = { y: 347, height: 40 }; let previous = artistHeaderTransition(0, 88, name);
    for (let y = .25; y < 500; y += .25) {
      const current = artistHeaderTransition(y, 88, name);
      assert.ok(current.largeOpacity <= previous.largeOpacity);
      assert.ok(current.compactOpacity >= previous.compactOpacity);
      assert.ok(current.backgroundOpacity >= previous.backgroundOpacity);
      assert.ok(Math.abs(current.backgroundOpacity - previous.backgroundOpacity) < .02);
      previous = current;
    }
  });

  it('waits for the real first layout and handles large official logos without simultaneous titles', () => {
    for (const scroll of [0, 250, 1000]) {
      assert.deepEqual(artistHeaderFromLayout(scroll, 88, { y: 0, height: 0 }, 411, 24, .4),
        { largeOpacity: 1, compactOpacity: 0, backgroundOpacity: 0 });
    }
    for (const width of [320, 411, 680]) {
      const ruler = { y: 300, height: 104 }; // a wrapped name, before the same controls
      const frame = artistNameVisualFrame(ruler, width, 24, .4);
      assert.equal(frame.y + frame.height, 380, 'large artwork retains the measured text baseline');
      assert.ok(frame.height <= Math.max(ruler.height - 24, width * .23));
      for (let y = 0; y < 550; y += .5) {
        const state = artistHeaderFromLayout(y, 88, ruler, width, 24, .4);
        assert.equal(state.largeOpacity * state.compactOpacity, 0);
      }
    }
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
        // ScrollView moves the entire photo by -scroll; the existing inner
        // photo adds its clamped one-third-height parallax independently.
        const pageParallax = scroll < 0 ? 0 : scroll > photoHeight ? -photoHeight / 3 : -scroll / 3;
        for (const viewportY of [0, 87.999, 88, 88.001, 143.999, 144, 144.001]) {
          const sourceInPage = viewportY - (-scroll + pageParallax);
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
    '@/lib/artistHeaderTransition': { artistHeaderCopyGeometry, artistHeaderLocalSource, artistPhotoParallax },
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
    hero(tree: any) { return tree.props.children.props.children[1].props.children.props.children; },
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
  assert.equal(hero.props.imageStyle.read().transform[0].translateY, artistPhotoParallax(0, 411) * (hero.props.width / 411));
  hero.props.onLayerDisplay('sharp'); tree = h.render(); assert.equal(tree.props.style[2].read().opacity, 0);
  hero.props.onLayerDisplay('field'); tree = h.render(); assert.equal(tree.props.style[2].read().opacity, .75);
  assert.equal(tree.props.pointerEvents, 'none'); assert.equal(tree.props.style[1].height, 144);
  const mask = tree.props.children;
  assert.equal(mask.props.maskElement.props.colors.at(-1), '#FFFFFF00');
  assert.equal(mask.props.maskElement.props.locations[1], 88 / 144);
  const photo = mask.props.children[1]; const before = h.writes();
  for (const scroll of [-20, 0, 180, 411, 600, 30]) {
    h.scroll(scroll);
    const pageOffset = photo.props.style[1].read().transform[0].translateY;
    const scaledParallax = hero.props.imageStyle.read().transform[0].translateY;
    assert.equal(pageOffset, -scroll, 'the original page outer clip must move exactly with ScrollView');
    assert.ok(Math.abs(pageOffset + scaledParallax / (hero.props.width / 411) - artistHeaderPhotoOffset(scroll, 411)) < 1e-10);
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

it('matches the original nested outer clip, inner source visibility and both actual mask alphas across the whole viewport', () => {
  const render = heroRenderer();
  const props = { uri: undefined, sourceUri: 'file:///photo.jpg', textureUri: 'file:///field.png',
    width: 411, height: 411, extensionHeight: 144, imageStyle: {} };
  const full = render(props); const small = artistHeaderCopyGeometry(411, 411, 144, 3.5);
  const copy = render({ ...props, width: small.width, height: small.photoHeight, extensionHeight: small.extensionHeight });
  const fullMask = full.props.children.props.children; const smallMask = copy.props.children.props.children;
  const fullSharp = fullMask.props.children[1]; const smallSharp = smallMask.props.children[1];
  const alpha = (locations: number[], y: number, height: number) =>
    Math.max(0, Math.min(1, (locations[2] - y / height) / (locations[2] - locations[1])));
  for (const scroll of [-90, 0, .001, 200, 410.999, 411, 411.001, 560, 850]) {
    // Independent original geometry: ScrollView's clip moves by -scroll and
    // its photograph alone has a clamped parallax inside that outer clip.
    const originalOuterY = -scroll;
    const originalParallax = scroll < 0 ? 0 : scroll > 411 ? -137 : -scroll / 3;
    const copyOuterY = -scroll; const copyParallax = artistPhotoParallax(scroll, 411) * small.scale;
    const probes = [0, 88, 144, ...Array.from({ length: 86 }, (_, i) => i * 11)];
    for (const edge of [originalOuterY, originalOuterY + 555, originalOuterY + originalParallax,
      originalOuterY + originalParallax + 555, originalOuterY + originalParallax + 411]) {
      if (edge >= 0) probes.push(edge - 1e-6, edge, edge + 1e-6);
    }
    for (const viewportY of probes) {
      const originalOuter = viewportY - originalOuterY;
      const originalSource = originalOuter - originalParallax;
      const copyOuter = (viewportY - copyOuterY) * small.scale;
      const copySource = copyOuter - copyParallax;
      const fullVisible = originalOuter >= 0 && originalOuter < 555 && originalSource >= 0 && originalSource < 555;
      const copyVisible = copyOuter >= 0 && copyOuter < small.photoHeight + small.extensionHeight
        && copySource >= 0 && copySource < small.photoHeight + small.extensionHeight;
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
});
