import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTtml } from '@/lib/ttml';
import { wordGroups } from '@/lib/lyricWords';
import type { LyricWord } from '@/api/subsonic';

const words = (...values: string[]): LyricWord[] => values.map((value, index) => ({
  value, start: index * 500, end: (index + 1) * 500,
}));

test('timed syllables stay in one word while whitespace permits a line break', () => {
  const line = words('Flow', 'er ', 'in ', 'a ', 'hur', 'ri', 'cane');
  const before = structuredClone(line);
  assert.deepEqual(wordGroups(line), [[0, 1], [2], [3], [4, 5, 6]]);
  assert.deepEqual(line, before);
  assert.equal(wordGroups(line).flat().map((index) => line[index].value).join(''), 'Flower in a hurricane');
});

test('TTML spans retain their independent clocks inside an unbreakable word', () => {
  const lyric = parseTtml('<tt><body><p begin="1s"><span begin="1s">Beau</span><span begin="1.3s">ti</span><span begin="1.6s">ful </span><span begin="2s">day</span></p></body></tt>')!;
  const line = lyric.lines[0].words!;
  assert.deepEqual(wordGroups(line), [[0, 1, 2], [3]]);
  assert.deepEqual(line.map((word) => word.start), [1000, 1300, 1600, 2000]);
});

test('CJK and other unspaced scripts can wrap without grouping an entire line', () => {
  for (const line of [words('你', '好', '世界'), words('正しさ', 'とは'), words('ก', 'ข'), words('မြ', 'န်')]) {
    assert.deepEqual(wordGroups(line), line.map((_, index) => [index]));
  }
});

test('Korean syllables and Unicode whitespace respect word boundaries', () => {
  assert.deepEqual(wordGroups(words('눈', '을 ', '뜬 ', '순간')), [[0, 1], [2], [3]]);
  assert.deepEqual(wordGroups(words('one\u00a0', 'two', '\tthree', ' four')), [[0], [1], [2], [3]]);
  assert.deepEqual(wordGroups([]), []);
});
