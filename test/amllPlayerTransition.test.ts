import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  amllPlayerDragOffset, amllPlayerExitDuration, beginPlayerClose, commitPlayerClose, completePlayerClose,
  playerModalAnimation, removePlayerTransition, shouldCloseAmllPlayer,
  type PlayerCloseSession, type PlayerCloseSource,
} from '@/lib/amllPlayerTransition';

describe('AMLL player dismissal', () => {
  it('tracks downward pulls, resists upward pulls and returns cancelled pulls to the open phase', () => {
    assert.equal(amllPlayerDragOffset(80, 800), 80);
    assert.equal(amllPlayerDragOffset(1000, 800), 800);
    assert.ok(amllPlayerDragOffset(-80, 800) < 0 && amllPlayerDragOffset(-80, 800) > -32);
    assert.equal(shouldCloseAmllPlayer(119, 500), false);
    assert.equal(shouldCloseAmllPlayer(121, 0), true);
    assert.equal(shouldCloseAmllPlayer(30, 801), true);
    assert.equal(shouldCloseAmllPlayer(-30, 1200), false);
    assert.equal(shouldCloseAmllPlayer(Number.NaN, 1200), false);
    const session: PlayerCloseSession = { generation: 0, phase: 'open' };
    // A cancelled/under-threshold pull does not begin a removal or consume a later close.
    assert.equal(completePlayerClose(session, 0), false);
    assert.equal(session.phase, 'open');
    assert.equal(beginPlayerClose(session, 'button'), 1);
  });

  it('waits for the full surface before allowing exactly one close from each return source', () => {
    for (const source of ['button', 'handle', 'back', 'navigation'] satisfies PlayerCloseSource[]) {
      const session: PlayerCloseSession = { generation: 0, phase: 'open' };
      const generation = beginPlayerClose(session, source)!;
      assert.equal(session.phase, 'closing');
      assert.equal(beginPlayerClose(session, 'back'), undefined);
      assert.equal(session.source, source);
      assert.equal(completePlayerClose(session, generation + 1), false);
      assert.equal(session.phase, 'closing');
      assert.equal(completePlayerClose(session, generation), true);
      assert.equal(session.phase, 'ready');
      assert.equal(completePlayerClose(session, generation), false);
      assert.equal(beginPlayerClose(session, source), undefined);
      assert.equal(commitPlayerClose(session), true);
      assert.equal(commitPlayerClose(session), false);
      assert.equal(session.phase, 'removed');
    }
  });

  it('drops a queued animation completion after unmount and avoids a second delay for a cancelled mini reveal', () => {
    const session: PlayerCloseSession = { generation: 0, phase: 'open' };
    const generation = beginPlayerClose(session, 'navigation')!;
    removePlayerTransition(session);
    assert.equal(completePlayerClose(session, generation), false);
    assert.equal(amllPlayerExitDuration(800, 800), 0);
    assert.equal(amllPlayerExitDuration(0, 800), 220);
    assert.ok(amllPlayerExitDuration(400, 800) < 220);
  });

  it('keeps native animation exclusively in the legacy entry path', () => {
    assert.equal(playerModalAnimation('amll', false), 'none');
    assert.equal(playerModalAnimation('amll', true), 'none');
    assert.equal(playerModalAnimation('resonus', true), 'none');
    assert.equal(playerModalAnimation('resonus', false), 'fade_from_bottom');
  });

  it('a cancelled mini reveal already offscreen commits immediately once without a second hold', () => {
    const session: PlayerCloseSession = { generation: 0, phase: 'open' };
    const generation = beginPlayerClose(session, 'navigation')!;
    assert.equal(amllPlayerExitDuration(800, 800), 0);
    assert.equal(completePlayerClose(session, generation), true);
    assert.equal(beginPlayerClose(session, 'back'), undefined);
    assert.equal(commitPlayerClose(session), true);
    assert.equal(commitPlayerClose(session), false);
  });
});
