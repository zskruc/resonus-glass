import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amllPlayerLayout } from '@/lib/amllPlayerLayout';

const cases = [
  [360, 640, 1], [412, 840, 1], [320, 440, 1.8],
  [840, 360, 1], [1024, 720, 1], [1280, 760, 1.5],
] as const;

test('native player cover, metadata and controls remain bounded with scroll fallback on short viewports', () => {
  for (const [width, height, fontScale] of cases) for (const showVolume of [false, true]) {
    const layout = amllPlayerLayout({ width, height, fontScale, showVolume, showQuality: true });
    for (const cover of [layout.largeCover, layout.smallCover]) {
      assert.ok(cover.size > 0 && cover.x >= 0 && cover.y >= 0);
      assert.ok(cover.x + cover.size <= layout.leftWidth + .001 || !layout.horizontal);
    }
    assert.ok(layout.largeCover.y + layout.largeCover.size <= layout.metadataTop);
    assert.ok(layout.metadataTop + layout.metadataHeight <= layout.controlsTop);
    assert.ok(layout.controlsTop + (layout.horizontal ? layout.compactControlsHeight : layout.fullControlsHeight) <= layout.contentHeight);
    assert.ok(layout.lyricsHeight >= Math.min(96, layout.viewportHeight));
    assert.ok(layout.metadataHeight >= 52 * fontScale + 4);
    assert.ok(layout.compactMetadataHeight >= 42 * fontScale + 4);
    assert.equal(layout.scrollable, layout.contentHeight > layout.viewportHeight + 1);
  }
});

test('large accessibility text uses a scrollable column rather than shrinking or covering the transport', () => {
  const layout = amllPlayerLayout({ width: 320, height: 440, fontScale: 2.5, showVolume: true, showQuality: true });
  assert.equal(layout.scrollable, true);
  assert.ok(layout.contentHeight > layout.viewportHeight);
  assert.ok(layout.lyricsTop >= layout.smallCover.y + layout.compactMetadataHeight);
  assert.ok(layout.lyricsTop + layout.lyricsHeight <= layout.contentHeight);
  assert.ok(layout.footerHeight >= 26 + 3 + 10 * 2.5);
});

test('portrait lyric view uses a small cover while the cover view can expand to its available slot', () => {
  const layout = amllPlayerLayout({ width: 412, height: 840, fontScale: 1, showVolume: true, showQuality: false });
  assert.equal(layout.horizontal, false);
  assert.equal(layout.smallCover.size, 72);
  assert.ok(layout.largeCover.size > layout.smallCover.size * 3);
  assert.ok(layout.lyricsTop >= 72);
  assert.ok(layout.lyricsTop + layout.lyricsHeight > layout.compactControlsTop, 'portrait lyrics occupy the freed transport area');
  assert.ok(layout.lyricsTop + layout.lyricsHeight <= layout.contentHeight);
});

test('landscape retains a 45 percent information column and can center that same column without overflow', () => {
  const layout = amllPlayerLayout({ width: 1024, height: 720, fontScale: 1, showVolume: true, showQuality: true });
  assert.equal(layout.horizontal, true);
  assert.equal(layout.leftWidth, layout.innerWidth * .45);
  assert.ok(layout.centeredColumnLeft >= 0);
  assert.ok(layout.centeredColumnLeft + layout.leftWidth <= layout.innerWidth);
});
