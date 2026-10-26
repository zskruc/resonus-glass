import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glassMaterialTuningMask } from '@/lib/glassMaterialTuning';

test('AM++ optics flags preserve defaults until each field is explicitly edited', () => {
  assert.equal(glassMaterialTuningMask({}), 0);
  assert.equal(glassMaterialTuningMask({ blur: 12, tintColor: '#aabbcc', depthEffect: true }), 0);
  assert.equal(glassMaterialTuningMask({ refraction: 0 }), 1);
  assert.equal(glassMaterialTuningMask({ refractionHeight: 0 }), 2);
  assert.equal(glassMaterialTuningMask({ highlightWidth: 0, highlightOpacity: 0 }), 12);
  assert.equal(glassMaterialTuningMask({ chromaticAberration: false, tintOpacity: 0 }), 48);
  assert.equal(glassMaterialTuningMask({ refraction: 32, refractionHeight: 20, highlightWidth: 1,
    highlightOpacity: .5, chromaticAberration: true, tintOpacity: .2 }), 63);
});
