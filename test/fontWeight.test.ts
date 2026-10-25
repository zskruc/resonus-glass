import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adjustedFontWeight, preservesFontWeight } from '@/lib/fontWeight';

describe('system text weight', () => {
  it('honors Android bold text for body text and explicitly styled headings', () => {
    assert.equal(adjustedFontWeight(undefined, 300), '700');
    assert.equal(adjustedFontWeight('normal', 300), '700');
    assert.equal(adjustedFontWeight('500', 300), '800');
    assert.equal(adjustedFontWeight('600', 300), '900');
    assert.equal(adjustedFontWeight('bold', 300), '900');
  });

  it('restores original weights when disabled and stays within RN-supported weights', () => {
    assert.equal(adjustedFontWeight(undefined, 0), '400');
    assert.equal(adjustedFontWeight('500', 0), '500');
    assert.equal(adjustedFontWeight('bold', 0), '700');
    assert.equal(adjustedFontWeight('200', -300), '100');
    assert.equal(adjustedFontWeight('900', 300), '900');
    assert.equal(adjustedFontWeight('400', 75), '500');
  });

  it('does not turn invalid or unspecified configuration values into maximum boldness', () => {
    assert.equal(adjustedFontWeight('normal', 2147483647), '400');
    assert.equal(adjustedFontWeight('normal', NaN), '400');
    assert.equal(adjustedFontWeight('invalid', 300), '700');
  });

  it('preserves icons and imported font faces while allowing built-in font adjustment', () => {
    for (const family of ['phosphor', 'phosphor-fill', 'Ionicons', 'material', 'CustomFont-123']) {
      assert.equal(preservesFontWeight(family), true);
    }
    for (const family of [undefined, 'sans-serif', 'sans-serif-condensed', 'serif']) {
      assert.equal(preservesFontWeight(family), false);
    }
  });
});
