/** Android's accessibility adjustment, expressed in RN's supported weights. */
export function adjustedFontWeight(weight: unknown, adjustment: number): `${number}` {
  const parsed = weight === 'bold' ? 700 : weight === 'normal' || weight == null ? 400 : Number(weight);
  const base = Number.isFinite(parsed) && parsed >= 100 && parsed <= 900 ? parsed : 400;
  const delta = Number.isFinite(adjustment) && Math.abs(adjustment) <= 1000 ? adjustment : 0;
  return `${Math.max(100, Math.min(900, Math.round((base + delta) / 100) * 100))}`;
}

/** Icon glyphs and single-face imported fonts must keep their registered face. */
export function preservesFontWeight(family: string | undefined): boolean {
  if (!family) return false;
  const name = family.toLowerCase();
  return name === 'phosphor' || name === 'phosphor-fill' || name === 'ionicons' || name === 'material' || name.startsWith('customfont-');
}
