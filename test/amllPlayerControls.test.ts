import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amllBottomActionLayout, amllMoreButtonSize, amllPlayerControlLayout } from '@/lib/amllPlayerControls';

test('portrait exposes only the three transport actions while retaining its reference row heights', () => {
  const layout = amllPlayerControlLayout({ width: 348, viewportHeight: 840, horizontal: false, showVolume: true });
  assert.deepEqual(layout.slots.map((slot) => slot.action), ['previous', 'toggle', 'next']);
  assert.deepEqual(layout.rows, ['progress', 'volume', 'transport', 'auxiliary']);
  assert.equal(layout.auxiliaryHeight, 48);
  assert.equal(layout.height, layout.auxiliaryTop + layout.auxiliaryHeight);
  assert.ok(layout.transportTop >= layout.volumeTop + layout.volumeHeight);
  assert.ok(layout.auxiliaryTop >= layout.transportTop + layout.transportHeight);
});

test('removing mode buttons leaves the measured Samsung transport and utility anchors unchanged', () => {
  const layout = amllPlayerControlLayout({ width: 384, viewportWidth: 384, viewportHeight: 832,
    horizontal: false, showVolume: false });
  const centers = layout.slots.map((slot) => slot.left + slot.size / 2);
  for (const [index, expected] of [84.9333333, 192, 299.0666667].entries()) {
    assert.ok(Math.abs(centers[index] - expected) < .001);
  }
  assert.ok(Math.abs(layout.transportTop + layout.transportHeight / 2 - 129.8) < .001);
  assert.ok(Math.abs(layout.auxiliaryTop + layout.auxiliaryHeight / 2 - 228.6) < .001);
  const footer = amllBottomActionLayout(384, false);
  for (const [index, expected] of [88.933, 192, 295.067].entries()) {
    assert.ok(Math.abs(footer.slots[index].left + footer.slots[index].size / 2 - expected) < .001);
  }
});

test('landscape removes modes without moving transport centers and keeps its output-left footer', () => {
  const layout = amllPlayerControlLayout({ width: 348, viewportHeight: 384, horizontal: true, showVolume: true });
  assert.deepEqual(layout.slots.map((slot) => slot.action), ['previous', 'toggle', 'next']);
  assert.deepEqual(layout.slots.map((slot) => Number((slot.left + slot.size / 2).toFixed(2))), [102.66, 174, 245.34]);
  assert.deepEqual(layout.rows, ['progress', 'transport', 'volume']);
  assert.equal(layout.auxiliaryHeight, 0);
  const footer = amllBottomActionLayout(760, true);
  assert.equal(footer.slots[0].action, 'output');
  assert.equal(footer.slots[0].left, 0);
  assert.deepEqual(footer.slots.slice(1).map((slot) => slot.action), ['lyrics', 'queue']);
  assert.equal(footer.slots[2].left + footer.slots[2].size, footer.contentWidth);
});

test('transport and utility hit rectangles remain distinct and bounded, scrolling on exceptionally narrow columns', () => {
  for (const width of [1, 120, 240, 348, 560]) for (const horizontal of [false, true]) {
    const layout = amllPlayerControlLayout({ width, viewportHeight: 440, horizontal, showVolume: false, fontScale: 2.5 });
    let previousEnd = 0;
    for (const slot of layout.slots) {
      assert.ok(slot.size >= 44);
      assert.ok(slot.left >= previousEnd - .001);
      assert.ok(slot.left + slot.size <= layout.contentWidth + .001);
      previousEnd = slot.left + slot.size;
    }
    assert.equal(layout.scrollable, layout.contentWidth > width);
    assert.equal(layout.volumeHeight, 0);
    const footer = amllBottomActionLayout(width, horizontal);
    previousEnd = 0;
    for (const slot of footer.slots) {
      assert.ok(slot.left >= previousEnd);
      assert.ok(slot.left + slot.size <= footer.contentWidth);
      previousEnd = slot.left + slot.size;
    }
  }
});

test('large text reserves a full time-label row and small phone More keeps an accessible visual size', () => {
  const ordinary = amllPlayerControlLayout({ width: 348, viewportHeight: 840, horizontal: false, showVolume: true });
  const accessible = amllPlayerControlLayout({ width: 348, viewportHeight: 840, horizontal: false, showVolume: true, fontScale: 2.5 });
  assert.ok(accessible.progressHeight >= 44 + 16 * 2.5);
  assert.ok(accessible.height > ordinary.height);
  assert.equal(amllMoreButtonSize(384, 840), 28);
  for (const value of [Number.NaN, 0, Number.POSITIVE_INFINITY]) {
    const layout = amllPlayerControlLayout({ width: value, viewportHeight: value, horizontal: false, showVolume: true });
    assert.ok(Number.isFinite(layout.height));
    assert.ok(Number.isFinite(amllMoreButtonSize(value, value)));
  }
});

test('phone SVG whitespace yields compact visible glyphs without shrinking the three transport targets', () => {
  const layout = amllPlayerControlLayout({ width: 348, viewportWidth: 384, viewportHeight: 840,
    horizontal: false, showVolume: true });
  const visibleSkip = layout.skipGlyphSize * 84 / 134;
  const visiblePlay = layout.playGlyphSize * 34.1406 / 38;
  assert.ok(visibleSkip >= 32 && visibleSkip <= 38);
  assert.ok(visiblePlay >= 44 && visiblePlay <= 48);
  assert.equal(layout.utilitySelectedGlyphSize, 24);
  assert.ok(layout.utilityGlyphSize * 44.3 / 64 < 26);
  assert.equal(layout.auxiliaryHeight, 48);
  assert.ok(layout.slots.every((slot) => slot.size >= 44));
  assert.equal(amllBottomActionLayout(348, false).height, 48);
});
