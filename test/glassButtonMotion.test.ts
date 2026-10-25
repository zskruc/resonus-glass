import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getGlassButtonMotion } from '@/lib/glassButtonMotion';

describe('catalog glass button movement', () => {
  it('starts and ends at the original bounds, including a not-yet-laid-out control', () => {
    assert.deepEqual(getGlassButtonMotion(180, 48, 0, 0, 0), { x: 0, y: 0, scaleX: 1, scaleY: 1 });
    assert.deepEqual(getGlassButtonMotion(0, 0, 1, 20, 20), { x: 0, y: 0, scaleX: 1, scaleY: 1 });
  });

  it('adds the same 4dp resting press enlargement to large and compact controls', () => {
    for (const height of [24, 48, 72]) {
      const result = getGlassButtonMotion(180, height, 1, 0, 0);
      assert.ok(Math.abs(result.scaleY * height - (height + 4)) < 0.00001);
      assert.equal(result.scaleX, result.scaleY);
    }
  });

  it('keeps a long drag near its original touch target and stretches along the drag axis', () => {
    const horizontal = getGlassButtonMotion(180, 48, 1, 1000, 0);
    const reverse = getGlassButtonMotion(180, 48, 1, -1000, 0);
    assert.ok(horizontal.x > 0 && horizontal.x < 48);
    assert.equal(reverse.x, -horizontal.x);
    assert.equal(reverse.scaleX, horizontal.scaleX);
    assert.ok(horizontal.scaleX > horizontal.scaleY);
    assert.equal(horizontal.y, 0);
    const vertical = getGlassButtonMotion(180, 48, 1, 0, 1000);
    assert.ok(vertical.y > 0 && vertical.y < 48);
    assert.ok(vertical.scaleY > vertical.scaleX);
  });
});
