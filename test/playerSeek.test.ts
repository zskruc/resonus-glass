import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canApplyPlayerSeek } from '@/lib/playerSeek';

describe('player seek handoff', () => {
  it('rejects an old song before React has rendered the new song or duration', () => {
    const renderedSong = 'old-song';
    const dragSong = renderedSong;
    assert.equal(canApplyPlayerSeek(dragSong, 'new-song', true, true), false);
    // A queued start callback from that old render must not adopt the new song.
    assert.equal(canApplyPlayerSeek(renderedSong, 'new-song', true, true), false);
    assert.equal(canApplyPlayerSeek('new-song', 'new-song', true, true), true);
  });

  it('rejects a retained hidden player, backgrounding and an already cancelled drag', () => {
    assert.equal(canApplyPlayerSeek('song', 'song', false, true), false);
    // AppState can change before the active prop's React update commits.
    assert.equal(canApplyPlayerSeek('song', 'song', true, false), false);
    assert.equal(canApplyPlayerSeek(undefined, 'song', true, true), false);
    assert.equal(canApplyPlayerSeek('song', undefined, true, true), false);
  });
});
