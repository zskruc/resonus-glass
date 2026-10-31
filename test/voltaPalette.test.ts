import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { paletteContrast } from '../src/lib/playerPalette';
import { voltaDetailBackground } from '../src/lib/voltaPalette';

describe('artwork-tinted detail pages', () => {
  it('keeps existing row text readable for saturated, neutral and extreme covers in both themes', () => {
    const appearances = [
      { base: '#101114', primary: '#F1F2F4', secondary: '#A0A3AB' },
      { base: '#FFFFFF', primary: '#17171A', secondary: '#5C5C66' },
    ];
    for (const theme of appearances) for (const seed of ['#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFE15A', '#9B356B']) {
      const tint = voltaDetailBackground(seed, theme.base, theme.primary, theme.secondary);
      assert.ok(paletteContrast(theme.primary, tint) >= 7, `${seed}: main text`);
      assert.ok(paletteContrast(theme.secondary, tint) >= 4.5, `${seed}: secondary text`);
    }
  });

  it('falls back to the page color without an interpretable artwork color', () => {
    for (const seed of ['', 'transparent', '#fff', 'rgb(2,3,4)']) {
      assert.equal(voltaDetailBackground(seed, '#101114', '#F1F2F4', '#A0A3AB'), '#101114');
    }
  });
});
