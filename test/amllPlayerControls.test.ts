import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amllBottomActionLayout, amllMoreButtonSize, amllPlayerControlLayout } from '@/lib/amllPlayerControls';

test('portrait preserves three transport actions and places utility actions before volume', () => {
  const layout = amllPlayerControlLayout({ width: 348, viewportHeight: 840, horizontal: false, showVolume: true });
  assert.deepEqual(layout.slots.map((slot) => slot.action), ['previous', 'toggle', 'next']);
  assert.deepEqual(layout.rows, ['progress', 'transport', 'auxiliary', 'volume']);
  assert.equal(layout.auxiliaryHeight, 48);
  assert.equal(layout.height, layout.progressHeight + layout.transportHeight + layout.auxiliaryHeight
    + layout.volumeHeight + layout.volumeBottomPadding);
});

test('landscape keeps shuffle and repeat around transport, with a separate physical output-left footer', () => {
  const layout = amllPlayerControlLayout({ width: 348, viewportHeight: 384, horizontal: true, showVolume: true });
  assert.deepEqual(layout.slots.map((slot) => slot.action), ['shuffle', 'previous', 'toggle', 'next', 'repeat']);
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
  assert.equal(amllMoreButtonSize(384, 840), 32);
  for (const value of [Number.NaN, 0, Number.POSITIVE_INFINITY]) {
    const layout = amllPlayerControlLayout({ width: value, viewportHeight: value, horizontal: false, showVolume: true });
    assert.ok(Number.isFinite(layout.height));
    assert.ok(Number.isFinite(amllMoreButtonSize(value, value)));
  }
});
