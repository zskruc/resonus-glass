/** The music server answered successfully without lyrics; only its external
 * fallback failed. Preserve the item failure without declaring the server down. */
export class LyricsFallbackError extends Error {
  constructor(cause: unknown) {
    super('External lyrics fallback failed', { cause });
    this.name = 'LyricsFallbackError';
  }
}
