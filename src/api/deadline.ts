/**
 * A time limit for a request that covers the whole of it, the answer's body
 * included.
 *
 * `expo/fetch` resolves as soon as the headers arrive, and the native client
 * under it has no read timeout of its own, so a timer cleared at that point
 * guards nothing: a server or proxy that sends the headers and then stalls
 * would leave its caller waiting for good. Here the signal stays armed until
 * `work` has read what it needed.
 *
 * Aborting is not enough on its own to end the wait: `text()` and `json()` are
 * read natively, and that read does not hear the signal. So the wait is also
 * raced against it, and the deadline answers even when the read never does.
 */

/** The limit ran out before `work` finished. */
export class DeadlineError extends Error {
  constructor() {
    super('Server took too long to respond');
    this.name = 'DeadlineError';
  }
}

/** Rejects once `signal` fires, so a read that ignores it can be raced. */
export function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new DeadlineError());
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

export async function withDeadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([work(controller.signal), untilAborted(controller.signal)]);
  } catch (e) {
    if (controller.signal.aborted) throw new DeadlineError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
