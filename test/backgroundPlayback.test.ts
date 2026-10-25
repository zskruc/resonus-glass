import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BACKGROUND_RETRY_ROUNDS, NETWORK_RESUME_WINDOW_MS, PlaybackOutage } from '@/lib/backgroundPlayback';

const context = { songId: 'track', isPlaying: true, background: true, remote: false };
const running = { playing: true, isLoaded: true, isBuffering: false };

describe('background playback recovery', () => {
  it('does not treat Android buffering playing intent as restored audio', () => {
    const outage = new PlaybackOutage();
    outage.remember('track', 120, 1000, true);
    assert.equal(outage.observeStatus('track', { ...running, isLoaded: false, isBuffering: true }, 120), false);
    assert.equal(outage.waiting, true);
    assert.equal(outage.retry(context)?.positionSec, 120);
  });

  it('keeps the saved position and retry ownership across reloading the same song', () => {
    const outage = new PlaybackOutage();
    outage.remember('track', 120, 1000, true);
    const ticket = outage.retry(context)!;
    outage.trackChanged('track');
    outage.remember('track', 0, 2000, true);
    assert.equal(outage.owns(ticket), true);
    assert.equal(outage.retry(context)?.positionSec, 120);
    assert.equal(outage.observeStatus('track', running, 0), false);
    assert.equal(outage.observeStatus('track', running, 120), true);
    assert.equal(outage.owns(ticket), false);
  });

  it('invalidates a late retry when the user pauses, clears the queue or changes song', () => {
    for (const action of ['pause', 'clear', 'change'] as const) {
      const outage = new PlaybackOutage();
      outage.remember('track', 120, 1000, true);
      const ticket = outage.retry(context)!;
      if (action === 'pause') outage.cancel();
      else outage.trackChanged(action === 'clear' ? null : 'other');
      assert.equal(outage.owns(ticket), false);
      assert.equal(outage.networkReturned(context, 3000), null);
    }
  });

  it('stops retries when playback intent, output or visibility no longer allows them', () => {
    for (const changed of [{ isPlaying: false }, { remote: true }, { background: false }, { songId: 'other' }]) {
      const outage = new PlaybackOutage();
      outage.remember('track', 120, 1000, true);
      assert.equal(outage.retry({ ...context, ...changed }), null);
      assert.equal(outage.waiting, false);
    }
  });

  it('caps background retry work even when every reload reports another error', () => {
    const outage = new PlaybackOutage();
    outage.remember('track', 120, 1000, true);
    for (let i = 0; i < BACKGROUND_RETRY_ROUNDS; i++) {
      assert.ok(outage.retry(context));
      outage.remember('track', 0, 1000 + i * 60_000, true);
    }
    assert.equal(outage.retry(context), null);
    assert.equal(outage.waiting, false);
  });

  it('allows a recent stopped song to resume on a network edge, with its saved position', () => {
    const outage = new PlaybackOutage();
    outage.remember('track', 120, 1000, true);
    const old = outage.retry(context)!;
    assert.equal(outage.leaveBackground(), true);
    assert.equal(outage.owns(old), false);
    const ticket = outage.networkReturned({ ...context, background: false, isPlaying: false }, 3000)!;
    assert.equal(ticket.positionSec, 120);
    assert.equal(outage.owns(ticket), true);
  });

  it('does not autoplay an old, manually resumed or remotely playing failure', () => {
    for (const [changed, now] of [
      [{}, 1001 + NETWORK_RESUME_WINDOW_MS],
      [{ isPlaying: true }, 3000],
      [{ remote: true }, 3000],
      [{ songId: 'other' }, 3000],
    ] as const) {
      const outage = new PlaybackOutage();
      outage.remember('track', 120, 1000, false);
      assert.equal(outage.networkReturned({ ...context, background: false, isPlaying: false, ...changed }, now), null);
    }
  });

  it('resolves the latest current index after a deferred load while shuffle moves the song', async () => {
    const outage = new PlaybackOutage();
    outage.remember('track', 120, 1000, true);
    const ticket = outage.retry(context)!;
    let state = { queue: [{ id: 'first' }, { id: 'second' }, { id: 'track' }], index: 2 };
    let ready!: () => void;
    const initialization = new Promise<void>((resolve) => { ready = resolve; });
    const installed = initialization.then(() => {
      const index = outage.targetIndex(ticket, state, false);
      return index === null ? null : state.queue[index].id;
    });
    state = { queue: [{ id: 'track' }, { id: 'first' }, { id: 'second' }], index: 0 };
    ready();
    assert.equal(await installed, 'track');
    assert.equal(outage.targetIndex(ticket, state, false), 0);
  });

  it('rejects a deferred restore seek after a newer retry, manual pause or remote handoff', async () => {
    for (const action of ['retry', 'pause', 'remote'] as const) {
      const outage = new PlaybackOutage();
      outage.remember('track', 120, 1000, true);
      const ticket = outage.retry(context)!;
      const state = { queue: [{ id: 'track' }], index: 0 };
      let ready!: () => void;
      const offsetSupport = new Promise<void>((resolve) => { ready = resolve; });
      const seekAllowed = offsetSupport.then(() => outage.targetIndex(ticket, state, action === 'remote'));
      if (action === 'pause') outage.cancel();
      if (action === 'retry') assert.ok(outage.retry(context));
      ready();
      assert.equal(await seekAllowed, null);
    }
  });

  it('does not mistake an in-flight network recovery for a manual resume on another network edge', () => {
    const outage = new PlaybackOutage();
    outage.remember('track', 120, 1000, false);
    const first = outage.networkReturned({ ...context, isPlaying: false }, 2000)!;
    const second = outage.networkReturned(context, 3000)!;
    assert.equal(outage.owns(first), false);
    assert.equal(outage.owns(second), true);
    assert.equal(second.positionSec, 120);
  });
});
