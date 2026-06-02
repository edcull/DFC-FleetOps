/**
 * Intent legality (isLegal) tests.
 *
 * isLegal is the single authoritative gate the server runs before apply() and
 * the client runs before a local hotseat mutation. These tests exercise the
 * turn-flow, ownership, phase and geometry guards for a representative set of
 * intent types.
 */
import { describe, it, expect } from 'vitest';
import { isLegal, legalActions } from '../../src/engine/gating.js';
import { makeState, shipDef, shipInstance, addGroup } from './helpers.js';

// Build a minimal play-phase game: one group per side.
function playState({ activeSide = 'player1', order = null, thrust = 6 } = {}) {
  const state = makeState();
  const p1 = shipDef({ id: 'player1:a', side: 'player1', thrust });
  const p2 = shipDef({ id: 'player2:b', side: 'player2', thrust });
  addGroup(state, p1, [shipInstance({ x: 200, y: 200, heading: 0 })]);
  addGroup(state, p2, [shipInstance({ x: 400, y: 400, heading: 0 })]);
  state.activeSide = activeSide;
  if (order) state.groups['player1:a'].order = order;
  return state;
}

// ---------------------------------------------------------------------------
// Basic guards
// ---------------------------------------------------------------------------

describe('isLegal — basic guards', () => {
  it('rejects non-object intents', () => {
    const s = playState();
    expect(isLegal(s, null, 'player1')).toBe(false);
    expect(isLegal(s, 'pass', 'player1')).toBe(false);
    expect(isLegal(s, undefined, 'player1')).toBe(false);
  });
  it('rejects unknown intent types', () => {
    expect(isLegal(playState(), { type: 'teleport' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pass
// ---------------------------------------------------------------------------

describe('isLegal — pass', () => {
  it('legal when it is your turn and you hold a pass token', () => {
    const s = playState({ activeSide: 'player1' });
    s.planning.passTokens.player1 = 1;
    expect(isLegal(s, { type: 'pass' }, 'player1')).toBe(true);
  });
  it('illegal without a pass token', () => {
    const s = playState({ activeSide: 'player1' });
    s.planning.passTokens.player1 = 0;
    expect(isLegal(s, { type: 'pass' }, 'player1')).toBe(false);
  });
  it('illegal when it is not your turn', () => {
    const s = playState({ activeSide: 'player2' });
    s.planning.passTokens.player1 = 1;
    expect(isLegal(s, { type: 'pass' }, 'player1')).toBe(false);
  });
  it('illegal outside the play phase', () => {
    const s = playState({ activeSide: 'player1' });
    s.planning.passTokens.player1 = 1;
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'pass' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// endRound
// ---------------------------------------------------------------------------

describe('isLegal — endRound', () => {
  it('the active side may end the round', () => {
    expect(isLegal(playState({ activeSide: 'player1' }), { type: 'endRound' }, 'player1')).toBe(true);
  });
  it('either side may end the round when no side is active', () => {
    const s = playState({ activeSide: null });
    expect(isLegal(s, { type: 'endRound' }, 'player1')).toBe(true);
    expect(isLegal(s, { type: 'endRound' }, 'player2')).toBe(true);
  });
  it('the inactive side may not end the round', () => {
    expect(isLegal(playState({ activeSide: 'player1' }), { type: 'endRound' }, 'player2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyOrder
// ---------------------------------------------------------------------------

describe('isLegal — applyOrder', () => {
  it('legal to order your own undeployed-free group on your turn', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'applyOrder', gid: 'player1:a', order: 'WF' }, 'player1')).toBe(true);
  });
  it('rejects an unknown order key', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'applyOrder', gid: 'player1:a', order: 'ZZ' }, 'player1')).toBe(false);
  });
  it('cannot order the enemy group', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'applyOrder', gid: 'player2:b', order: 'WF' }, 'player1')).toBe(false);
  });
  it('cannot order an already-activated group', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].activated = true;
    expect(isLegal(s, { type: 'applyOrder', gid: 'player1:a', order: 'WF' }, 'player1')).toBe(false);
  });
  it('cannot change order after a ship has moved under the current order', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    s.groups['player1:a'].ships[0].movedThisRound = true;
    expect(isLegal(s, { type: 'applyOrder', gid: 'player1:a', order: 'CC' }, 'player1')).toBe(false);
    // ...but re-issuing the SAME order is fine
    expect(isLegal(s, { type: 'applyOrder', gid: 'player1:a', order: 'WF' }, 'player1')).toBe(true);
  });
  it('cannot order on the opponent\'s turn', () => {
    const s = playState({ activeSide: 'player2' });
    expect(isLegal(s, { type: 'applyOrder', gid: 'player1:a', order: 'WF' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// moveShip (geometry)
// ---------------------------------------------------------------------------

describe('isLegal — moveShip', () => {
  it('legal move straight ahead within the thrust cone', () => {
    const s = playState({ activeSide: 'player1', order: 'WF', thrust: 6 });
    // WF maxR = 6*12 = 72px; move 50px straight ahead (heading 0 = +x)
    expect(isLegal(s, { type: 'moveShip', gid: 'player1:a', si: 0, x: 250, y: 200 }, 'player1')).toBe(true);
  });
  it('illegal move beyond the thrust range', () => {
    const s = playState({ activeSide: 'player1', order: 'WF', thrust: 6 });
    expect(isLegal(s, { type: 'moveShip', gid: 'player1:a', si: 0, x: 400, y: 200 }, 'player1')).toBe(false);
  });
  it('illegal move that turns more than the order allows (WF cannot turn)', () => {
    const s = playState({ activeSide: 'player1', order: 'WF', thrust: 6 });
    // straight up = 90° off heading; WF turnLimit 0
    expect(isLegal(s, { type: 'moveShip', gid: 'player1:a', si: 0, x: 200, y: 150 }, 'player1')).toBe(false);
  });
  it('a ship that already moved cannot move again', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    s.groups['player1:a'].ships[0].movedThisRound = true;
    expect(isLegal(s, { type: 'moveShip', gid: 'player1:a', si: 0, x: 250, y: 200 }, 'player1')).toBe(false);
  });
  it('cannot move the enemy ship', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    expect(isLegal(s, { type: 'moveShip', gid: 'player2:b', si: 0, x: 450, y: 400 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// adjust* counters
// ---------------------------------------------------------------------------

describe('isLegal — adjustAP', () => {
  it('legal integer delta for your own side', () => {
    expect(isLegal(playState(), { type: 'adjustAP', side: 'player1', delta: 1 }, 'player1')).toBe(true);
    expect(isLegal(playState(), { type: 'adjustAP', side: 'player1', delta: -2 }, 'player1')).toBe(true);
  });
  it('online: cannot adjust the opponent\'s AP', () => {
    expect(isLegal(playState(), { type: 'adjustAP', side: 'player2', delta: 1 }, 'player1')).toBe(false);
  });
  it('rejects a non-integer delta and bad side', () => {
    expect(isLegal(playState(), { type: 'adjustAP', side: 'player1', delta: 0.5 }, 'player1')).toBe(false);
    expect(isLegal(playState(), { type: 'adjustAP', side: 'nobody', delta: 1 }, 'player1')).toBe(false);
  });
});

describe('isLegal — adjustSpike', () => {
  it('legal ±1 on your own group', () => {
    const s = playState();
    expect(isLegal(s, { type: 'adjustSpike', gid: 'player1:a', delta: 1 }, 'player1')).toBe(true);
    expect(isLegal(s, { type: 'adjustSpike', gid: 'player1:a', delta: -1 }, 'player1')).toBe(true);
  });
  it('rejects deltas other than ±1', () => {
    expect(isLegal(playState(), { type: 'adjustSpike', gid: 'player1:a', delta: 2 }, 'player1')).toBe(false);
  });
  it('cannot adjust the enemy group', () => {
    expect(isLegal(playState(), { type: 'adjustSpike', gid: 'player2:b', delta: 1 }, 'player1')).toBe(false);
  });
  it('rejects an unknown group', () => {
    expect(isLegal(playState(), { type: 'adjustSpike', gid: 'ghost', delta: 1 }, 'player1')).toBe(false);
  });
});

describe('isLegal — adjustHull', () => {
  it('legal ±1 on your own ship', () => {
    const s = playState();
    expect(isLegal(s, { type: 'adjustHull', gid: 'player1:a', si: 0, delta: -1 }, 'player1')).toBe(true);
  });
  it('rejects a missing ship index', () => {
    expect(isLegal(playState(), { type: 'adjustHull', gid: 'player1:a', si: 9, delta: -1 }, 'player1')).toBe(false);
  });
  it('cannot adjust the enemy hull', () => {
    expect(isLegal(playState(), { type: 'adjustHull', gid: 'player2:b', si: 0, delta: -1 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deployShip (phase gating)
// ---------------------------------------------------------------------------

describe('isLegal — deployShip phase gate', () => {
  it('illegal during the play phase', () => {
    const s = playState();
    s.groups['player1:a'].ships[0].offTable = true;
    expect(isLegal(s, { type: 'deployShip', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// legalActions
// ---------------------------------------------------------------------------

describe('legalActions', () => {
  it('includes pass and endRound when the active side can take them', () => {
    const s = playState({ activeSide: 'player1' });
    s.planning.passTokens.player1 = 1;
    const types = legalActions(s, 'player1').map(i => i.type);
    expect(types).toContain('pass');
    expect(types).toContain('endRound');
  });
  it('omits pass for the inactive side', () => {
    const s = playState({ activeSide: 'player1' });
    s.planning.passTokens.player2 = 1;
    const types = legalActions(s, 'player2').map(i => i.type);
    expect(types).not.toContain('pass');
  });
});
