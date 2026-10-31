import { createSlots } from '@/lib/slots';
import type { PlaybackLoadGate } from '@/lib/playbackLoadGate';

export type RequestSlots = ReturnType<typeof createSlots>;

/**
 * One shared budget for mirror covers and optional stream warming. Native
 * transports keep their own dispatchers, so this limits our speculative work;
 * it does not claim to reserve a connection across every client in the app.
 * Requests made for an explicit tap never wait for this pool.
 */
export const speculativeSlots = createSlots(4);

/** Recheck ownership/policy after waiting, and give back even an unused slot. */
export async function withSpeculativeSlot<T>(
  stillWanted: () => boolean,
  work: () => Promise<T>,
  slots: RequestSlots = speculativeSlots,
  gate?: PlaybackLoadGate,
): Promise<T | undefined> {
  while (stillWanted()) {
    // No connection permit is occupied while playback has priority. The gate
    // can close while this task waits for a slot, so check it again afterward.
    if (gate?.held) { await gate.wait(); continue; }
    await slots.take();
    try {
      if (!stillWanted()) return undefined;
      if (gate?.held) continue;
      return await work();
    } finally {
      slots.release();
    }
  }
  return undefined;
}
