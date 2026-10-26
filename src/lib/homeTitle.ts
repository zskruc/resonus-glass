/** Keep native TextInput and imported settings within the same small title budget. */
export const HOME_TITLE_MAX = 32;

/** Trim at commit/hydration, never while an input method is composing text. */
export function normalizeHomeTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  let title = '';
  for (const character of text) {
    if (title.length + character.length > HOME_TITLE_MAX) break;
    title += character;
  }
  return title.trim();
}

/** A chosen heading takes priority without modifying the independent greeting preference. */
export function resolveHomeTitle(custom: unknown, showGreeting: boolean, greeting: string, translatedHome: string): string {
  return normalizeHomeTitle(custom) || (showGreeting ? greeting : translatedHome);
}
