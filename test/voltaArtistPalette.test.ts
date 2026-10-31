import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { paletteContrast } from '../src/lib/playerPalette';
import * as artistColors from '../src/lib/voltaArtistPalette';
import { buildVoltaArtistPalette, pickVoltaArtistSeed, VOLTA_ARTIST_FALLBACK, VoltaArtistPaletteCache,
  type ArtistImageColors } from '../src/lib/voltaArtistPalette';

describe('immersive artist image palette', () => {
  it('selects a portrait background/population role rather than a vibrant skin detail', () => {
    const portrait = { platform: 'android' as const, dominant: '#405165', average: '#645A4C',
      muted: '#9B816A', vibrant: '#E69B54' };
    assert.equal(pickVoltaArtistSeed(portrait), '#405165');
    const palette = buildVoltaArtistPalette(portrait);
    const channels = palette.background.match(/\w\w/g)!.map((value) => parseInt(value, 16));
    assert.ok(channels[2] > channels[0], 'the blue-grey photograph must not become a pink/skin-tone page');
    assert.ok(channels.every((value) => value < 120), 'a naturally dark image must not be normalized pale');
    assert.equal(pickVoltaArtistSeed({ platform: 'ios', background: '#405165', primary: '#E69B54' }), '#405165');
  });

  it('uses the real neutral average for black/white images and avoids a near-black clothing swatch', () => {
    for (const average of ['#000000', '#FFFFFF']) {
      const sample = { platform: 'android' as const, dominant: '#605090', average };
      assert.equal(pickVoltaArtistSeed(sample), average);
      const background = buildVoltaArtistPalette(sample).background;
      assert.equal(background.slice(1, 3), background.slice(3, 5));
      assert.equal(background.slice(3, 5), background.slice(5, 7));
    }
    assert.equal(pickVoltaArtistSeed({ dominant: '#010101', average: '#405165' }), '#405165');
    assert.equal(pickVoltaArtistSeed({ dominant: 'bad', average: '#405165' }), '#405165');
  });

  it('keeps text, active controls and inverse Play glyphs readable for every artwork hue', () => {
    for (const dominant of ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF', '#405165', '#AAAAAA']) {
      const palette = buildVoltaArtistPalette({ dominant });
      assert.ok(paletteContrast(palette.text, palette.background) >= 4.5);
      assert.ok(paletteContrast(palette.textSecondary, palette.background) >= 4.5);
      assert.ok(paletteContrast(palette.textMuted, palette.background) >= 4.5);
      assert.ok(paletteContrast(palette.accent, palette.background) >= 4.5);
      assert.ok(paletteContrast(palette.onText, palette.text) >= 4.5);
      assert.ok(paletteContrast(palette.onText, palette.accent) >= 4.5);
      assert.ok(Object.isFrozen(palette));
    }
  });

  it('provides a stable natural fallback without involving the global theme', () => {
    assert.deepEqual(buildVoltaArtistPalette({}), VOLTA_ARTIST_FALLBACK);
    assert.deepEqual(buildVoltaArtistPalette({ dominant: 'transparent', average: '#fff' }), VOLTA_ARTIST_FALLBACK);
  });

  it('uses lower visible-crop pixels before whole-photo roles and preserves a medium natural background', () => {
    const sample = { dominant: '#001122', average: '#FFFFFF', lowerMean: '#78817C', lowerEdgeMean: '#626A64', lowerCenterMean: '#D1D5DC' };
    const seed = pickVoltaArtistSeed(sample)!;
    const palette = buildVoltaArtistPalette(sample);
    assert.notEqual(seed, sample.dominant);
    assert.notEqual(seed, sample.average);
    const channels = palette.background.match(/\w\w/g)!.map((value) => parseInt(value, 16));
    assert.ok(channels.every((value) => value > 100), 'medium grey-green pixels must not be forced under the old dark HSL ceiling');
    assert.ok(channels[1] > channels[0] && channels[1] > channels[2], 'the surrounding lower-scene hue is retained');
    assert.ok(paletteContrast(palette.text, palette.background) < 7, 'AAA white text is not a reason to darken this readable photo-derived body');
    assert.ok(paletteContrast(palette.textSecondary, palette.background) >= 4.5);
    assert.ok(paletteContrast(palette.textMuted, palette.background) >= 4.5);
  });

  it('preserves darker clothing and neutral tones rather than lifting every image to a fixed floor', () => {
    const dark = buildVoltaArtistPalette({ lowerMean: '#10161F', lowerEdgeMean: '#10161F' });
    assert.ok(paletteContrast(dark.text, dark.background) > 15);
    const neutral = buildVoltaArtistPalette({ lowerMean: '#6B706C', lowerEdgeMean: '#6B706C' });
    const channel = (color: string, i: number) => parseInt(color.slice(1 + i * 2, 3 + i * 2), 16);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(channel(neutral.background, i) - channel('#6B706C', i)) <= 1);
    assert.equal(pickVoltaArtistSeed({ dominant: '#FF0033', lowerCenterMean: '#5C675F' }), '#5C675F');
  });

  it('uses verified artwork metadata ahead of lower pixels, preserving dark metadata and dimming bright metadata in RGB', () => {
    const lower = { lowerMean: '#DDEEFF', lowerEdgeMean: '#8899AA' };
    assert.equal(pickVoltaArtistSeed({ ...lower, artworkBackground: '#374153' }), '#374153');
    assert.equal(buildVoltaArtistPalette({ ...lower, artworkBackground: '#374153' }).background, '#374153');
    assert.equal(buildVoltaArtistPalette({ ...lower, artworkBackground: '#d6dbd7' }).background, '#6b706c');
    assert.deepEqual(buildVoltaArtistPalette({ ...lower, artworkBackground: 'bad' }), buildVoltaArtistPalette(lower));
    for (const artworkBackground of ['#ffffff', '#ffff00', '#ff00ff', '#0000ff', '#000000']) {
      const palette = buildVoltaArtistPalette({ artworkBackground });
      assert.ok(paletteContrast(palette.text, palette.background) >= 4.5);
      assert.ok(paletteContrast(palette.textSecondary, palette.background) >= 4.5);
      assert.ok(paletteContrast(palette.textMuted, palette.background) >= 4.5);
    }
  });

  it('keeps clothing out of the page background even without public metadata', () => {
    const cases = [
      { sourceBackground: '#0e0e0c', lowerMean: '#828280', lowerEdgeMean: '#616261', reference: '#0a0a08' },
      { sourceBackground: '#f6f7fb', lowerMean: '#9a816e', lowerEdgeMean: '#d5ceca', reference: '#67686c' },
    ];
    for (const sample of cases) {
      const result = buildVoltaArtistPalette(sample);
      assert.equal(pickVoltaArtistSeed(sample), sample.sourceBackground);
      assert.equal(result.background, buildVoltaArtistPalette({ sourceBackground: sample.sourceBackground }).background);
      // Samsung Apple Music reference margins, rather than sweater/jacket colors.
      for (let i = 1; i < 7; i += 2) assert.ok(Math.abs(parseInt(result.background.slice(i, i + 2), 16)
        - parseInt(sample.reference.slice(i, i + 2), 16)) <= 6);
      assert.ok(paletteContrast(result.text, result.background) >= 4.5);
    }
    assert.equal(pickVoltaArtistSeed({ sourceBackground: '#eeeeee', artworkBackground: '#374153' }), '#374153');
  });

  it('does not jump half a brightness level at the white-text contrast boundary', () => {
    let previous = 0;
    for (let value = 0; value <= 255; value++) {
      const seed = '#' + value.toString(16).padStart(2, '0').repeat(3);
      const result = parseInt(buildVoltaArtistPalette({ artworkBackground: seed }).background.slice(1, 3), 16);
      assert.ok(Math.abs(result - previous) <= 2, `unexpected tone jump at ${seed}`);
      previous = result;
    }
  });

  it('matches five Apple Music artist bodies with one scene rule instead of per-artist colors', () => {
    // Official Artwork.bgColor paired with clean screenshot body margins.
    // The near-white Lam reference permits one RGB step for the continuous
    // 5.6 contrast target; all other cases currently match exactly.
    const references = [
      { name: 'Ayano Tsuji', source: '#c3c2b4', body: '#717062' },
      { name: 'Xu Song', source: '#d6dbd7', body: '#6b706c' },
      { name: 'George Lam', source: '#f8f9fd', body: '#67686c' },
      { name: 'Eason Chan', source: '#0a0a08', body: '#0a0a08' },
      { name: 'Dao Lang', source: '#374153', body: '#374153' },
    ];
    const rgb = (color: string) => [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
    for (const { name, source, body } of references) {
      const metadata = buildVoltaArtistPalette({ artworkBackground: source });
      const localScene = buildVoltaArtistPalette({ sourceBackground: source });
      assert.deepEqual(localScene, metadata, `${name}: unavailable metadata must not change the scene treatment`);
      const actual = rgb(metadata.background), expected = rgb(body);
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(Math.abs(actual[channel] - expected[channel]) <= (name === 'George Lam' ? 1 : 0),
          `${name}: RGB channel ${channel}`);
      }
      assert.ok(paletteContrast('#FFFFFF', metadata.background) >= 5);
    }
  });

  it('preserves every pair of unclipped photographic channel differences across the RGB gamut', () => {
    const rgb = (color: string) => [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
    const toHex = (channels: number[]) => '#' + channels.map((n) => n.toString(16).padStart(2, '0')).join('');
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
      const input = [r, g, b], sourceBackground = toHex(input);
      const output = rgb(buildVoltaArtistPalette({ sourceBackground }).background);
      for (let first = 0; first < 3; first++) {
        assert.ok(output[first] <= input[first], `${sourceBackground}: scene must not be brightened`);
        for (let second = first + 1; second < 3; second++) {
          if (output[first] > 0 && output[second] > 0) {
            assert.equal(output[first] - output[second], input[first] - input[second],
              `${sourceBackground}: channel difference ${first}/${second}`);
          }
        }
      }
    }
  });

  it('keeps colored photographic ramps continuous through the normal and pale contrast bands', () => {
    const rgb = (color: string) => [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
    let previous: number[] | undefined;
    for (let value = 20; value <= 255; value++) {
      const sourceBackground = '#' + [value, value - 1, value - 15]
        .map((channel) => channel.toString(16).padStart(2, '0')).join('');
      const result = rgb(buildVoltaArtistPalette({ sourceBackground }).background);
      if (previous) for (let channel = 0; channel < 3; channel++) {
        assert.ok(Math.abs(result[channel] - previous[channel]) <= 2,
          `unexpected chromatic tone jump at ${sourceBackground}`);
      }
      previous = result;
    }
  });
});

describe('bounded raw artist palette cache', () => {
  it('coalesces consumers of the same image and evicts by recent use', async () => {
    const calls: string[] = [];
    const cache = new VoltaArtistPaletteCache(async (uri) => { calls.push(uri); return { dominant: '#405165' }; }, 2);
    const first = cache.load('A');
    assert.equal(cache.load('A'), first);
    await first;
    await cache.load('B'); await cache.load('A'); await cache.load('C');
    assert.equal(cache.size, 2);
    assert.equal(cache.peek('B'), undefined);
    await cache.load('A');
    assert.deepEqual(calls, ['A', 'B', 'C']);
    await cache.load('B');
    assert.deepEqual(calls, ['A', 'B', 'C', 'B']);
    assert.equal(cache.size, 2);
  });

  it('does not cache failed reads, allowing a later visit to retry', async () => {
    let calls = 0;
    const cache = new VoltaArtistPaletteCache(async () => {
      if (++calls === 1) throw new Error('temporary decoder failure');
      return { dominant: '#405165' };
    });
    assert.equal(await cache.load('A'), null);
    assert.equal(cache.size, 0);
    assert.ok(await cache.load('A'));
    assert.equal(calls, 2);
  });
});

function hookHarness() {
  let cursor = 0;
  let writes = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const cleanup = new Set<() => void>();
  const slot = <T,>(create: () => T): T => { const index = cursor++; return index in slots ? slots[index] : slots[index] = create(); };
  const calls: { uri: string; config: Record<string, unknown> }[] = [];
  const reads = new Map<string, (sample: ArtistImageColors) => void>();
  const cachePaths = new Map<string, string>();
  const shared = new Map<string, ArtistImageColors>();
  const cacheProbes: string[] = [];
  const react = {
    useRef: <T,>(value: T) => slot(() => ({ current: value })),
    useState: <T,>(value?: T) => {
      const state = slot(() => ({ value }));
      return [state.value, (next: T) => { writes++; state.value = next; }];
    },
    useMemo: (create: () => unknown) => create(),
    useEffect: (create: () => (() => void) | undefined, deps: unknown[]) => {
      const state = slot(() => ({ deps: undefined as unknown[] | undefined, cleanup: undefined as (() => void) | undefined }));
      if (state.deps && state.deps.every((value, index) => Object.is(value, deps[index]))) return;
      state.deps = deps;
      effects.push(() => {
        if (state.cleanup) { cleanup.delete(state.cleanup); state.cleanup(); }
        state.cleanup = create(); if (state.cleanup) cleanup.add(state.cleanup);
      });
    },
  };
  const source = readFileSync(new URL('../src/hooks/useVoltaArtistPalette.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports: Record<string, any> = {};
  runInNewContext(compiled.outputText, { exports, require(name: string) {
    if (name === 'react') return react;
    if (name === '@/api/data') return { CACHED_COVER: 'cached-cover:', COVER: { thumb: 200 } };
    if (name === 'expo-image') return { Image: { async getCachePathAsync(uri: string) { cacheProbes.push(uri); return cachePaths.get(uri); } } };
    if (name === '@/lib/voltaArtistPalette') return artistColors;
    if (name === 'react-native-image-colors') return { cache: { getItem(uri: string) { return shared.get(uri); } }, getColors(uri: string, config: Record<string, unknown>) {
      calls.push({ uri, config }); return new Promise<ArtistImageColors>((resolve) => reads.set(uri, resolve));
    } };
    throw new Error(`Unexpected artist-palette hook import ${name}`);
  } });
  return {
    calls, reads, cachePaths, cacheProbes, shared,
    render(uri?: string, offline = false) { cursor = 0; const result = exports.useVoltaArtistPalette(uri, offline); while (effects.length) effects.shift()!(); return result; },
    unmount() { for (const close of cleanup) close(); cleanup.clear(); },
    writes: () => writes,
  };
}

async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

describe('displayed-artist photo ownership', () => {
  it('does not fetch absent/offline cache-only art and keeps external image identity intact', async () => {
    const h = hookHarness();
    assert.equal(h.render(), VOLTA_ARTIST_FALLBACK);
    assert.equal(h.render('cached-cover:https://server/portrait?size=1200'), VOLTA_ARTIST_FALLBACK);
    await flush(); assert.equal(h.calls.length, 0);
    h.render('https://cdn.example/portrait.jpg'); await flush();
    assert.equal(h.calls[0].uri, 'https://cdn.example/portrait.jpg');
    assert.equal(h.calls[0].config.cache, false, 'new results must not grow the dependency’s unbounded cache');
  });

  it('samples a small copy of the displayed server photo and rejects an obsolete artist result', async () => {
    const h = hookHarness();
    const a = 'https://server/photo-A?size=1200';
    const b = 'https://server/photo-B?size=1200';
    h.render(a); await flush();
    h.render(b); await flush();
    assert.deepEqual(h.calls.map((call) => call.uri), ['https://server/photo-A?size=200', 'https://server/photo-B?size=200']);
    h.reads.get('https://server/photo-A?size=200')!({ dominant: '#DD3311' }); await flush();
    assert.equal(h.render(b), VOLTA_ARTIST_FALLBACK, 'artist A cannot repaint artist B');
    h.reads.get('https://server/photo-B?size=200')!({ dominant: '#405165' }); await flush();
    assert.deepEqual(h.render(b), buildVoltaArtistPalette({ dominant: '#405165' }));
    assert.deepEqual(h.render(a), buildVoltaArtistPalette({ dominant: '#DD3311' }), 'returning to A consumes its own cached result');
    await flush(); assert.equal(h.calls.length, 2, 'cached visits do not decode the portrait again');
  });

  it('never sends a remote request while offline, but can decode the exact locally cached displayed photo', async () => {
    const absent = hookHarness();
    assert.equal(absent.render('https://cdn.example/portrait.jpg', true), VOLTA_ARTIST_FALLBACK);
    await flush(); assert.equal(absent.calls.length, 0);
    assert.deepEqual(absent.cacheProbes, ['https://cdn.example/portrait.jpg']);
    const local = hookHarness();
    local.cachePaths.set('https://server/portrait?size=1200', '/cached/portrait.jpg');
    local.render('https://server/portrait?size=1200', true); await flush();
    assert.equal(local.calls.length, 1);
    assert.equal(local.calls[0].uri, 'file:///cached/portrait.jpg');
    local.reads.get('file:///cached/portrait.jpg')!({ dominant: '#405165' }); await flush();
    assert.deepEqual(local.render('https://server/portrait?size=1200', true), buildVoltaArtistPalette({ dominant: '#405165' }));
  });

  it('can reuse a previously extracted raw palette offline without inspecting or fetching the image', async () => {
    const h = hookHarness();
    h.shared.set('https://cdn.example/portrait.jpg', { dominant: '#405165' });
    h.render('https://cdn.example/portrait.jpg', true); await flush();
    assert.deepEqual(h.render('https://cdn.example/portrait.jpg', true), buildVoltaArtistPalette({ dominant: '#405165' }));
    assert.equal(h.calls.length, 0); assert.equal(h.cacheProbes.length, 0);
  });

  it('ignores a pending native result after unmount', async () => {
    const h = hookHarness();
    h.render('https://cdn.example/a.jpg'); await flush();
    h.unmount(); const writes = h.writes();
    h.reads.get('https://cdn.example/a.jpg')!({ dominant: '#405165' }); await flush();
    assert.equal(h.writes(), writes);
  });
});
