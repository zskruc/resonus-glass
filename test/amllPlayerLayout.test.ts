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
  assert.equal(layout.footerHeight, 0);
  assert.equal(layout.controlLayout.volumeBottomPadding, 0);
  assert.ok(layout.controlLayout.transportTop >= layout.controlLayout.volumeTop + layout.controlLayout.volumeHeight);
});

test('Samsung portrait anchors match the measured Apple Music screen after safe-area origin is applied once', () => {
  const topInset = 24, bottomInset = 16, fullHeight = 832;
  const layout = amllPlayerLayout({ width: 384, viewportWidth: 384, viewportHeight: fullHeight,
    topInset, height: fullHeight - topInset - bottomInset - 8, fontScale: 1, showVolume: false, showQuality: true });
  const origin = topInset + 8 + layout.headerHeight;
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .01, `${actual} ≈ ${expected}`);
  close(layout.coverFrame.x, 24);
  close(layout.coverFrame.y + origin, 106.9333333);
  close(layout.coverFrame.size, 336);
  close(layout.pausedCover.x, 49.2);
  close(layout.pausedCover.y + origin, 132.1333333);
  close(layout.pausedCover.size, 285.6);
  close(layout.metadataInset, 32);
  close(layout.metadataTop + origin, 483.7333333);
  close(layout.metadataHeight, 58.1333333);
  close(layout.controlsTop + origin + 22, 566.4);
  close(layout.controlsTop + origin + layout.controlLayout.transportTop + layout.controlLayout.transportHeight / 2, 674.2);
  close(layout.controlsTop + origin + layout.controlLayout.auxiliaryTop + 24, 773);
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
