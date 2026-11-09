import assert from 'node:assert/strict';
import { test } from 'node:test';
import { widgetLyricIndex, widgetLyricRows } from '../src/lib/widgetExtras';
test('widget lyrics use milliseconds, publish a bounded line window and do not invent an early lyric', () => {
  const lyrics = { synced: true, lines: [{ value: 'One', start: 1000 }, { value: 'Two', start: 5000 }, { value: 'Three', start: 10000 }, { value: 'Four', start: 15000 }] };
  assert.equal(widgetLyricIndex(lyrics, 0), -1); assert.deepEqual(widgetLyricRows(lyrics, -1), []);
  assert.equal(widgetLyricIndex(lyrics, 5), 1); assert.deepEqual(widgetLyricRows(lyrics, 1), ['One', 'Two', 'Three']);
  assert.equal(widgetLyricIndex(lyrics, 5.4), 1, 'same lyric line yields the same subscription selection');
  assert.deepEqual(widgetLyricRows(lyrics, 3), ['Three', 'Four']);
  assert.equal(widgetLyricIndex({ ...lyrics, synced: false }, 99), 0);
});
