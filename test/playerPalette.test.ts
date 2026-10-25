import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPlayerPalette,
  createStablePlayerPalette,
  paletteContrast,
  PLAYER_PALETTE_CACHE_LIMIT,
  PLAYER_PALETTE_STABLE_MS,
  PlayerPaletteCache,
  type PlayerPalette,
  type PlayerPaletteRequest,
} from '../src/lib/playerPalette';

const COLORS = [
  '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#815c9e', '#b44813', '#3d756b',
  // useCoverTint supplies softened light/dark seeds, not raw saturated pixels.
  '#f8e0e0', '#e3f8e3', '#e0e0f8', '#bc9999', '#2f1a1a', '#355347',
];

describe('full-player artwork palette', () => {
  it('guards text, secondary text and accent contrast for saturated and muted covers in both themes', () => {
    for (const seed of COLORS) for (const dark of [false, true]) {
      const palette = buildPlayerPalette(seed, dark);
      assert.ok(palette, `${seed}, dark=${dark}`);
      assert.ok(paletteContrast(palette.text, palette.background) >= 7);
      assert.ok(paletteContrast(palette.textSecondary, palette.background) >= 4.5);
      assert.ok(paletteContrast(palette.accent, palette.background) >= 4.5);
      assert.ok(paletteContrast(palette.onAccent, palette.accent) >= 4.5);
      for (const color of Object.values(palette)) assert.match(color, /^#[\da-f]{6}$/);
      assert.ok(Object.isFrozen(palette));
    }
  });

  it('retains ordinary player colors for invalid, neutral and absent cover colors', () => {
    for (const seed of ['', '#fff', 'red', '#gg0011', '#000000', '#ffffff', '#787878', '#fefefe']) {
      assert.equal(buildPlayerPalette(seed, true), null);
      assert.equal(buildPlayerPalette(seed, false), null);
    }
  });

  it('keeps a bounded LRU and distinguishes artwork, seed and light/dark appearance', () => {
    const cache = new PlayerPaletteCache();
    const first = cache.resolve('first', '#ff0000', false);
    const dark = cache.resolve('first', '#ff0000', true);
    assert.notDeepEqual(first, dark);
    for (let i = 0; i < PLAYER_PALETTE_CACHE_LIMIT - 2; i++) cache.resolve(String(i), '#00ffff', false);
    assert.equal(cache.resolve('first', '#ff0000', false), first); // Touch oldest.
    cache.resolve('new', '#00ff00', false);
    assert.equal(cache.size, PLAYER_PALETTE_CACHE_LIMIT);
    assert.equal(cache.resolve('first', '#ff0000', false), first);
    assert.notEqual(cache.resolve('first', '#ff0000', true), dark); // Untouched entry was evicted.
    assert.notEqual(cache.resolve('first', '#0000ff', false), first);
    assert.equal(cache.size, PLAYER_PALETTE_CACHE_LIMIT);
  });
});

function gateHarness() {
  const jobs: { callback: () => void; delay: number; cancelled: boolean }[] = [];
  const published: (PlayerPalette | null)[] = [];
  const gate = createStablePlayerPalette((palette) => published.push(palette), new PlayerPaletteCache(), (callback, delay) => {
    const job = { callback, delay, cancelled: false };
    jobs.push(job);
    return () => { job.cancelled = true; };
  });
  const request: PlayerPaletteRequest = { artworkKey: 'song-a', seed: '#ff0000', ready: true, enabled: true, dark: true };
  return { jobs, published, gate, request };
}

describe('stable artwork publication', () => {
  it('waits for a ready cover to remain stable for 900ms, then publishes one palette', () => {
    const h = gateHarness();
    h.gate.update({ ...h.request, ready: false });
    assert.equal(h.jobs.length, 0);
    h.gate.update(h.request);
    assert.equal(h.jobs.length, 1);
    assert.equal(h.jobs[0].delay, PLAYER_PALETTE_STABLE_MS);
    assert.deepEqual(h.published, []);
    h.jobs[0].callback();
    assert.deepEqual(h.published, [buildPlayerPalette('#ff0000', true)]);
  });

  it('rejects obsolete song callbacks even if a cancelled timer is already queued', () => {
    const h = gateHarness();
    h.gate.update(h.request);
    h.gate.update({ ...h.request, artworkKey: 'song-b', seed: '#0000ff', ready: false });
    assert.equal(h.jobs[0].cancelled, true);
    h.jobs[0].callback();
    assert.deepEqual(h.published, []);
    h.gate.update({ ...h.request, artworkKey: 'song-b', seed: '#0000ff' });
    h.jobs[1].callback();
    assert.deepEqual(h.published, [buildPlayerPalette('#0000ff', true)]);
  });

  it('clears immediately on disable/no artwork and cannot be recolored by late callbacks', () => {
    for (const patch of [{ enabled: false }, { artworkKey: undefined }]) {
      const h = gateHarness();
      h.gate.update(h.request);
      h.gate.update({ ...h.request, ...patch });
      assert.deepEqual(h.published, [null]);
      h.jobs[0].callback();
      assert.deepEqual(h.published, [null]);
    }
  });

  it('keeps the applied cover while loading, falls back for a ready neutral cover, and disposes safely', () => {
    const h = gateHarness();
    h.gate.update(h.request);
    h.jobs[0].callback();
    h.gate.update({ ...h.request, artworkKey: 'neutral', seed: '#888888', ready: false });
    assert.equal(h.published.length, 1);
    h.gate.update({ ...h.request, artworkKey: 'neutral', seed: '#888888' });
    h.jobs[1].callback();
    assert.equal(h.published[1], null);
    h.gate.update(h.request);
    h.gate.dispose();
    assert.equal(h.jobs[2].cancelled, true);
    h.jobs[2].callback();
    h.gate.update(h.request);
    assert.equal(h.jobs.length, 3);
    assert.equal(h.published.length, 2);
  });
});
