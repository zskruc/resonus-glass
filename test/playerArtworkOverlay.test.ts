import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as crop from '../src/lib/playerArtworkCrop';

type Element = { type: string; props: Record<string, any> };
const jsx = (type: string, props: object): Element => ({ type, props });

// Execute the real overlay and its animated closures with retained React slots.
// Only native rendering and the mutable player bus are substituted.
function harness() {
  let cursor = 0;
  const slots: any[] = [], effects: (() => void)[] = [];
  const slot = <T,>(create: () => T): T => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = create();
    return slots[index];
  };
  const changed = (a?: unknown[], b?: unknown[]) => !a || !b || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const memo = (create: () => unknown, deps: unknown[]) => {
    const state = slot(() => ({ deps: undefined as unknown[] | undefined, value: undefined as unknown }));
    if (changed(state.deps, deps)) { state.deps = deps; state.value = create(); }
    return state.value;
  };
  const react = {
    useRef: (value: unknown) => slot(() => ({ current: value })),
    useMemo: memo,
    useState: (value: unknown) => {
      const state = slot(() => ({ value }));
      return [state.value, (next: unknown) => { state.value = next; }];
    },
    useLayoutEffect: (create: () => (() => void), deps: unknown[]) => {
      const state = slot(() => ({ deps: undefined as unknown[] | undefined, cleanup: undefined as (() => void) | undefined }));
      if (changed(state.deps, deps)) effects.push(() => { state.cleanup?.(); state.deps = deps; state.cleanup = create(); });
    },
  };
  const state = { song: { id: 'A' }, fit: true, progress: 1, owner: 7, active: true };
  const imports: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { create: (s: unknown) => s, absoluteFill: { position: 'absolute' } } },
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated' }, useAnimatedStyle: (read: () => unknown) => ({ read }) },
    '@/api/data': { COVER: { card: 600, thumb: 200 }, songCoverUrl: (song: { id: string }, size: number) => `${song.id}/${size}` },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ width: 400 }) },
    '@/lib/playerReveal': {
      playerSurfaceOwner: { get: () => state.owner },
      playerArtworkFlight: { get: () => state.active ? { owner: 7, frame: { fullContentOpacity: state.progress,
        artwork: { rect: { x: 10, y: 100, width: 40, height: 40, cornerRadius: 7 } } } } : null },
    },
    '@/lib/playerArtworkCrop': crop,
    '@/store/player': { currentSong: (s: unknown) => s, usePlayerStore: () => state.song },
    '@/store/settings': { useSettings: () => state.fit },
    './Cover': { Cover: 'Cover' },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/components/PlayerArtworkOverlay.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(compiled, { exports, require(id: string) {
    assert.ok(Object.hasOwn(imports, id), `Unexpected overlay import ${id}`); return imports[id];
  } });
  const render = () => {
    cursor = 0;
    const root: Element = exports.PlayerArtworkOverlay();
    while (effects.length) effects.shift()!();
    const outer: Element = root.props.children;
    const [thumb, card]: Element[] = outer.props.children;
    return { outer, thumb, card,
      thumbImage: thumb.props.children as Element, cardImage: card.props.children as Element,
      thumbStyle: () => thumb.props.style.at(-1).read(), cardStyle: () => card.props.style.at(-1).read(),
      outerStyle: () => outer.props.style.at(-1).read() };
  };
  return { state, render };
}

for (const [width, height] of [[900, 800], [800, 900], [800, 800]]) {
  test(`the real fitted overlay continuously crops ${width}×${height} art to the mini's cover endpoint`, () => {
    const h = harness(); let view = h.render();
    const metadata = { width, height, isAnimated: false };
    view.thumbImage.props.onImageMetadata('A/200', metadata);
    view.cardImage.props.onImageMetadata('A/600', metadata);
    view.cardImage.props.onAnimatedDetected('A/600', false);
    view = h.render();
    assert.equal(view.thumbImage.props.contentFit, 'contain');
    assert.equal(view.cardImage.props.contentFit, 'contain');
    assert.equal(view.cardStyle().opacity, 1);
    assert.equal(view.cardStyle().transform[0].scale, 1);
    h.state.progress = .5;
    const cover = Math.max(width / height, height / width);
    assert.equal(view.cardStyle().transform[0].scale, (cover + 1) / 2);
    h.state.progress = .2;
    assert.ok(view.cardStyle().opacity > 0 && view.cardStyle().opacity < 1);
    h.state.progress = .08;
    assert.equal(view.cardStyle().opacity, 0, 'the hi-res source has fully yielded before the actual mini handoff');
    h.state.progress = 0;
    assert.equal(view.thumbStyle().transform[0].scale, cover);
    assert.equal(view.thumbImage.props.uri, 'A/200', 'same thumb URL as MiniPlayer');
    assert.equal(view.cardStyle().opacity, 0);
    assert.equal(view.outerStyle().transform[2].scaleX, .1, 'internal crop never changes the measured outer flight');
  });
}

test('fit=false remains cover throughout, with source-specific metadata and a thumb-only mini', () => {
  const h = harness(); h.state.fit = false; let view = h.render();
  view.thumbImage.props.onImageMetadata('A/200', { width: 900, height: 800, isAnimated: false });
  view.cardImage.props.onImageMetadata('A/600', { width: 800, height: 1200, isAnimated: false });
  view.cardImage.props.onAnimatedDetected('A/600', false); view = h.render();
  assert.equal(view.thumbImage.props.contentFit, 'cover'); assert.equal(view.cardImage.props.contentFit, 'cover');
  for (const progress of [1, .5, .1, 0]) {
    h.state.progress = progress;
    assert.equal(view.cardStyle().transform[0].scale, 1); assert.equal(view.thumbStyle().transform[0].scale, 1);
  }
  assert.equal(view.cardStyle().opacity, 0);
});

test('card and thumb keep their own aspect, rejecting late URI/ABA callbacks without inheriting the old readiness', () => {
  const h = harness(); const old = h.render();
  old.thumbImage.props.onImageMetadata('A/200', { width: 2, height: 1, isAnimated: false });
  old.cardImage.props.onImageMetadata('A/600', { width: 1, height: 3, isAnimated: false });
  old.cardImage.props.onAnimatedDetected('A/600', false); let view = h.render(); h.state.progress = 0;
  assert.equal(view.thumbStyle().transform[0].scale, 2); assert.equal(view.cardStyle().transform[0].scale, 3);
  h.state.song = { id: 'B' }; view = h.render();
  view.thumbImage.props.onImageMetadata('B/200', { width: 1, height: 4, isAnimated: false }); view = h.render();
  old.thumbImage.props.onImageMetadata('A/200', { width: 8, height: 1, isAnimated: false });
  old.cardImage.props.onAnimatedDetected('A/600', false); view = h.render();
  assert.equal(view.thumbStyle().transform[0].scale, 4); assert.equal(view.cardStyle().opacity, 0);
  h.state.song = { id: 'A' }; view = h.render();
  h.state.progress = 1;
  assert.equal(view.cardStyle().opacity, 0, 'returning to URI A does not inherit a previous native request readiness');
  h.state.progress = 0;
  view.thumbImage.props.onImageMetadata('A/200', { width: 5, height: 1, isAnimated: false });
  old.thumbImage.props.onImageMetadata('A/200', { width: 9, height: 1, isAnimated: false }); view = h.render();
  assert.equal(view.thumbStyle().transform[0].scale, 5, 'a previous A binding cannot mutate the later A request');
  h.state.owner = 8; assert.equal(view.outerStyle().opacity, 0, 'stale flights remain hidden');
});

test('invalid metadata and progress cannot emit invalid scales or opacity', () => {
  for (const value of [0, -1, Infinity, NaN]) {
    assert.equal(crop.playerArtworkCropScale(true, value, 100, .5), 1);
    assert.equal(crop.playerArtworkCropScale(true, 100, value, .5), 1);
  }
  assert.equal(crop.playerArtworkCropScale(true, Number.MAX_VALUE, Number.MIN_VALUE, .5), 1);
  assert.equal(crop.playerArtworkCardOpacity(true, NaN), 0);
  assert.equal(crop.playerArtworkCardOpacity(false, 1), 0);
});
