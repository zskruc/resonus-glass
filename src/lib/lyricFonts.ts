import type { LocalLyricFonts, LyricScript } from './localCustomizationModels';
export interface LyricFontRun { text: string; script?: LyricScript; }
function script(value: string): LyricScript | undefined {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return 'japanese';
  if (/\p{Script=Hangul}/u.test(value)) return 'korean';
  if (/\p{Script=Han}/u.test(value)) return 'chinese';
  if (/\p{Script=Latin}/u.test(value)) return 'latin';
  return undefined;
}
/** Whole-line context prevents Japanese kanji words being classified as Chinese. */
export function lyricFontRuns(text: string, context = text): LyricFontRun[] {
  const cjk = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(context) ? 'japanese'
    : /\p{Script=Hangul}/u.test(context) ? 'korean' : 'chinese';
  const runs: LyricFontRun[] = []; let previous: LyricScript | undefined;
  for (const character of text) {
    const detected = script(character);
    const language = detected === 'chinese' ? cjk : detected ?? (/\p{L}/u.test(character) ? undefined : previous);
    if (runs.length && runs[runs.length - 1].script === language) runs[runs.length - 1].text += character;
    else runs.push({ text: character, ...(language ? { script: language } : {}) });
    previous = language;
  }
  return runs;
}
export function lyricFontFamily(script: LyricScript | undefined, preferences: LocalLyricFonts | undefined, customFamily?: string | null): string | undefined {
  const selected = script ? preferences?.fonts[script] : undefined;
  return !selected || selected === 'inherit' ? undefined : selected === 'custom' ? customFamily ?? undefined : selected;
}
