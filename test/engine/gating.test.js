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
import { makeState, shipDef, shipInstance, addGroup, weapon } from './helpers.js';

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

// ---------------------------------------------------------------------------
// Shared helpers for extended tests
// ---------------------------------------------------------------------------

// Attacker + target groups, 40 px apart, weapon arc ALL, large scan so range is
// never the limiting factor.
function weaponState({ atkScan = 20, wArc = 'ALL', order = null } = {}) {
  const s = makeState();
  const atkDef = shipDef({ id: 'player1:atk', side: 'player1', scan: atkScan,
                           weapons: [weapon({ arc: wArc })] });
  const tgtDef = shipDef({ id: 'player2:tgt', side: 'player2' });
  addGroup(s, atkDef, [shipInstance({ x: 200, y: 200 })]);
  addGroup(s, tgtDef, [shipInstance({ x: 240, y: 200 })]);
  s.activeSide = 'player1';
  if (order) s.groups['player1:atk'].order = order;
  return s;
}

// Minimal state with one dropsite.
function dropsiteState() {
  const s = makeState();
  s.scenarioData = {
    dropsites: [{ id: 'ds1', x: 10, y: 10, damage: 0, destroyed: false,
                  battalions: {}, features: [] }],
  };
  return s;
}

// Dropsite state with an active dropsiteActivation.
function daState() {
  const s = dropsiteState();
  s.dropsiteActivation = { side: 'player1', done: [], dsId: null };
  s.phase = 'da';
  return s;
}

// ---------------------------------------------------------------------------
// atmoDamage global guard
// ---------------------------------------------------------------------------

describe('isLegal — atmoDamage guard', () => {
  it('blocks all intents (except confirmEndActivation) when atmoDamage is set', () => {
    const s = playState({ activeSide: 'player1' });
    s.atmoDamage = { side: 'player1' };
    s.planning.passTokens.player1 = 1;
    expect(isLegal(s, { type: 'pass' }, 'player1')).toBe(false);
    expect(isLegal(s, { type: 'endRound' }, 'player1')).toBe(false);
    expect(isLegal(s, { type: 'applyOrder', gid: 'player1:a', order: 'WF' }, 'player1')).toBe(false);
  });
  it('allows confirmEndActivation for the owning side even when atmoDamage is set', () => {
    const s = playState();
    s.atmoDamage = { side: 'player1' };
    expect(isLegal(s, { type: 'confirmEndActivation' }, 'player1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// confirmEndActivation
// ---------------------------------------------------------------------------

describe('isLegal — confirmEndActivation', () => {
  it('legal for the owning side', () => {
    const s = playState();
    s.atmoDamage = { side: 'player1' };
    expect(isLegal(s, { type: 'confirmEndActivation' }, 'player1')).toBe(true);
  });
  it('illegal when no atmoDamage is pending', () => {
    expect(isLegal(playState(), { type: 'confirmEndActivation' }, 'player1')).toBe(false);
  });
  it('illegal for the wrong side', () => {
    const s = playState();
    s.atmoDamage = { side: 'player1' };
    expect(isLegal(s, { type: 'confirmEndActivation' }, 'player2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// advanceRound
// ---------------------------------------------------------------------------

describe('isLegal — advanceRound', () => {
  it('legal during the play phase', () => {
    expect(isLegal(playState(), { type: 'advanceRound' }, 'player1')).toBe(true);
  });
  it('illegal outside the play phase', () => {
    const s = playState();
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'advanceRound' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// beginPlay
// ---------------------------------------------------------------------------

describe('isLegal — beginPlay', () => {
  it('legal during the deploy phase', () => {
    const s = playState();
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'beginPlay' }, 'player1')).toBe(true);
  });
  it('illegal during the play phase', () => {
    expect(isLegal(playState(), { type: 'beginPlay' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// giveInitiative / beginActivation
// ---------------------------------------------------------------------------

describe('isLegal — giveInitiative', () => {
  function withInitiative(winner = 'player1') {
    const s = playState();
    s.initiative = { winner, holder: winner };
    return s;
  }
  it('legal for the initiative winner', () => {
    expect(isLegal(withInitiative('player1'), { type: 'giveInitiative' }, 'player1')).toBe(true);
  });
  it('illegal for the non-winner', () => {
    expect(isLegal(withInitiative('player1'), { type: 'giveInitiative' }, 'player2')).toBe(false);
  });
  it('illegal when there is no initiative object', () => {
    expect(isLegal(playState(), { type: 'giveInitiative' }, 'player1')).toBe(false);
  });
  it('illegal outside the play phase', () => {
    const s = withInitiative('player1');
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'giveInitiative' }, 'player1')).toBe(false);
  });
});

describe('isLegal — beginActivation', () => {
  function withHolder(holder = 'player1') {
    const s = playState();
    s.initiative = { winner: holder, holder };
    return s;
  }
  it('legal for the initiative holder', () => {
    expect(isLegal(withHolder('player1'), { type: 'beginActivation' }, 'player1')).toBe(true);
  });
  it('illegal for the non-holder', () => {
    expect(isLegal(withHolder('player1'), { type: 'beginActivation' }, 'player2')).toBe(false);
  });
  it('illegal when there is no initiative object', () => {
    expect(isLegal(playState(), { type: 'beginActivation' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// finishActivation
// ---------------------------------------------------------------------------

describe('isLegal — finishActivation', () => {
  it('legal when the group has an order', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    expect(isLegal(s, { type: 'finishActivation', gid: 'player1:a' }, 'player1')).toBe(true);
  });
  it('legal when a ship has moved (implicit activation start)', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].movedThisRound = true;
    expect(isLegal(s, { type: 'finishActivation', gid: 'player1:a' }, 'player1')).toBe(true);
  });
  it('legal when all ships are off-table (nothing to activate)', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].offTable = true;
    expect(isLegal(s, { type: 'finishActivation', gid: 'player1:a' }, 'player1')).toBe(true);
  });
  it('illegal when the group has not started (no order, no moves)', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'finishActivation', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal when the group is already activated', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    s.groups['player1:a'].activated = true;
    expect(isLegal(s, { type: 'finishActivation', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal when it is not your turn', () => {
    const s = playState({ activeSide: 'player2', order: 'WF' });
    expect(isLegal(s, { type: 'finishActivation', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal outside the play phase', () => {
    const s = playState({ order: 'WF' });
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'finishActivation', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal when a cell group deployed by this activation has not yet acted', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    const cellDef = shipDef({ id: 'player1:cell', side: 'player1' });
    addGroup(s, cellDef, [shipInstance({ deployedByGid: 'player1:a', x: 200, y: 200 })]);
    expect(isLegal(s, { type: 'finishActivation', gid: 'player1:a' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cancelOrder
// ---------------------------------------------------------------------------

describe('isLegal — cancelOrder', () => {
  it('legal before any action is taken', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    expect(isLegal(s, { type: 'cancelOrder', gid: 'player1:a' }, 'player1')).toBe(true);
  });
  it('illegal when no order is set', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'cancelOrder', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal after a ship has moved', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    s.groups['player1:a'].ships[0].movedThisRound = true;
    expect(isLegal(s, { type: 'cancelOrder', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal when the group is already activated', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    s.groups['player1:a'].activated = true;
    expect(isLegal(s, { type: 'cancelOrder', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal for the enemy group', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    expect(isLegal(s, { type: 'cancelOrder', gid: 'player2:b' }, 'player1')).toBe(false);
  });
  it('illegal on the opponent\'s turn', () => {
    const s = playState({ activeSide: 'player2', order: 'WF' });
    expect(isLegal(s, { type: 'cancelOrder', gid: 'player1:a' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// undoMove
// ---------------------------------------------------------------------------

describe('isLegal — undoMove', () => {
  it('legal when the ship moved and a trail entry exists', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].movedThisRound = true;
    s.groups['player1:a'].moveTrail = [{ si: 0, x: 200, y: 200, heading: 0 }];
    expect(isLegal(s, { type: 'undoMove', gid: 'player1:a', si: 0 }, 'player1')).toBe(true);
  });
  it('illegal when the ship has not moved', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'undoMove', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the ship has fired this activation', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].movedThisRound = true;
    s.groups['player1:a'].ships[0].firedThisActivation = true;
    s.groups['player1:a'].moveTrail = [{ si: 0, x: 200, y: 200, heading: 0 }];
    expect(isLegal(s, { type: 'undoMove', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal when there is no trail entry for this ship', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].movedThisRound = true;
    s.groups['player1:a'].moveTrail = [{ si: 1, x: 300, y: 300, heading: 0 }]; // different si
    expect(isLegal(s, { type: 'undoMove', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the group is already activated', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].movedThisRound = true;
    s.groups['player1:a'].activated = true;
    s.groups['player1:a'].moveTrail = [{ si: 0, x: 200, y: 200, heading: 0 }];
    expect(isLegal(s, { type: 'undoMove', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal for the wrong side', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].movedThisRound = true;
    s.groups['player1:a'].moveTrail = [{ si: 0, x: 200, y: 200, heading: 0 }];
    expect(isLegal(s, { type: 'undoMove', gid: 'player1:a', si: 0 }, 'player2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// nominateLead
// ---------------------------------------------------------------------------

describe('isLegal — nominateLead', () => {
  it('legal to nominate a live ship as lead', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'nominateLead', gid: 'player1:a', si: 0 }, 'player1')).toBe(true);
  });
  it('legal to clear the lead (si = null)', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'nominateLead', gid: 'player1:a', si: null }, 'player1')).toBe(true);
  });
  it('illegal to nominate a destroyed ship', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].destroyed = true;
    expect(isLegal(s, { type: 'nominateLead', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal for an enemy group', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'nominateLead', gid: 'player2:b', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the group is already activated', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].activated = true;
    expect(isLegal(s, { type: 'nominateLead', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal outside the play phase', () => {
    const s = playState({ activeSide: 'player1' });
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'nominateLead', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// unlockWeapon
// ---------------------------------------------------------------------------

describe('isLegal — unlockWeapon', () => {
  it('legal to clear a locked target', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'unlockWeapon', gid: 'player1:a', si: 0, wi: 0 }, 'player1')).toBe(true);
  });
  it('illegal outside the play phase', () => {
    const s = playState({ activeSide: 'player1' });
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'unlockWeapon', gid: 'player1:a', si: 0, wi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when an attackModal is active', () => {
    const s = playState({ activeSide: 'player1' });
    s.attackModal = { step: 'intro' };
    expect(isLegal(s, { type: 'unlockWeapon', gid: 'player1:a', si: 0, wi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the group is already activated', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].activated = true;
    expect(isLegal(s, { type: 'unlockWeapon', gid: 'player1:a', si: 0, wi: 0 }, 'player1')).toBe(false);
  });
  it('illegal for an enemy group', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'unlockWeapon', gid: 'player2:b', si: 0, wi: 0 }, 'player1')).toBe(false);
  });
  it('illegal for a missing ship index', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'unlockWeapon', gid: 'player1:a', si: 99, wi: 0 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fireWeapons
// ---------------------------------------------------------------------------

describe('isLegal — fireWeapons', () => {
  it('legal when at least one weapon target is locked', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    s.groups['player1:a'].ships[0].weaponTargets = { 0: { gid: 'player2:b', si: 0 } };
    expect(isLegal(s, { type: 'fireWeapons', gid: 'player1:a' }, 'player1')).toBe(true);
  });
  it('illegal when no weapon targets are locked', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    expect(isLegal(s, { type: 'fireWeapons', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal when an attackModal is already open', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    s.groups['player1:a'].ships[0].weaponTargets = { 0: { gid: 'player2:b', si: 0 } };
    s.attackModal = { step: 'intro' };
    expect(isLegal(s, { type: 'fireWeapons', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal under MT order (fireRule: none)', () => {
    const s = playState({ activeSide: 'player1', order: 'MT' });
    s.groups['player1:a'].ships[0].weaponTargets = { 0: { gid: 'player2:b', si: 0 } };
    expect(isLegal(s, { type: 'fireWeapons', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal for an enemy group', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player2:b'].ships[0].weaponTargets = { 0: { gid: 'player1:a', si: 0 } };
    expect(isLegal(s, { type: 'fireWeapons', gid: 'player2:b' }, 'player1')).toBe(false);
  });
  it('illegal outside the play phase', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    s.groups['player1:a'].ships[0].weaponTargets = { 0: { gid: 'player2:b', si: 0 } };
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'fireWeapons', gid: 'player1:a' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lockWeaponTarget
// ---------------------------------------------------------------------------

describe('isLegal — lockWeaponTarget', () => {
  const lwt = (s, overrides = {}) => isLegal(s, {
    type: 'lockWeaponTarget', gid: 'player1:atk', si: 0, wi: 0,
    targetGid: 'player2:tgt', targetSi: 0, ...overrides,
  }, 'player1');

  it('legal for an enemy ship within arc (ALL) and scan range', () => {
    expect(lwt(weaponState())).toBe(true);
  });
  it('illegal outside the play phase', () => {
    const s = weaponState();
    s.phase = 'deploy';
    expect(lwt(s)).toBe(false);
  });
  it('illegal when an attackModal is open', () => {
    const s = weaponState();
    s.attackModal = { step: 'intro' };
    expect(lwt(s)).toBe(false);
  });
  it('illegal under MT order (fireRule: none)', () => {
    expect(lwt(weaponState({ order: 'MT' }))).toBe(false);
  });
  it('illegal when the target ship is destroyed', () => {
    const s = weaponState();
    s.groups['player2:tgt'].ships[0].destroyed = true;
    expect(lwt(s)).toBe(false);
  });
  it('illegal when the target ship is off-table', () => {
    const s = weaponState();
    s.groups['player2:tgt'].ships[0].offTable = true;
    expect(lwt(s)).toBe(false);
  });
  it('illegal when no weapon exists at the given index', () => {
    expect(lwt(weaponState(), { wi: 99 })).toBe(false);
  });
  it('illegal when the firing group belongs to the wrong side', () => {
    const s = weaponState();
    expect(isLegal(s, { type: 'lockWeaponTarget', gid: 'player1:atk', si: 0, wi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player2')).toBe(false);
  });
  it('illegal when the attacker group is already activated', () => {
    const s = weaponState();
    s.groups['player1:atk'].activated = true;
    expect(lwt(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deployShip (extended)
// ---------------------------------------------------------------------------

describe('isLegal — deployShip (extended)', () => {
  it('illegal for a destroyed ship', () => {
    const s = makeState();
    s.phase = 'deploy';
    const def = shipDef({ id: 'player1:a', side: 'player1' });
    addGroup(s, def, [shipInstance()]);
    s.groups['player1:a'].ships[0].destroyed = true;
    expect(isLegal(s, { type: 'deployShip', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal for the wrong side', () => {
    const s = makeState();
    s.phase = 'deploy';
    const def = shipDef({ id: 'player1:a', side: 'player1' });
    addGroup(s, def, [shipInstance()]);
    expect(isLegal(s, { type: 'deployShip', gid: 'player1:a', si: 0 }, 'player2')).toBe(false);
  });
  it('illegal for an unknown group', () => {
    const s = makeState();
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'deployShip', gid: 'ghost', si: 0 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// undoDeploy
// ---------------------------------------------------------------------------

describe('isLegal — undoDeploy', () => {
  it('legal in play phase when the group has not acted', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'undoDeploy', gid: 'player1:a' }, 'player1')).toBe(true);
  });
  it('illegal in play phase when the group is activated', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].activated = true;
    expect(isLegal(s, { type: 'undoDeploy', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal in play phase when a ship has fired', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].firedThisActivation = true;
    expect(isLegal(s, { type: 'undoDeploy', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal when all ships are off-table (nothing on the table to undo)', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].offTable = true;
    expect(isLegal(s, { type: 'undoDeploy', gid: 'player1:a' }, 'player1')).toBe(false);
  });
  it('illegal for the wrong side', () => {
    const s = playState();
    expect(isLegal(s, { type: 'undoDeploy', gid: 'player1:a' }, 'player2')).toBe(false);
  });
  it('illegal for an unknown group', () => {
    expect(isLegal(playState(), { type: 'undoDeploy', gid: 'ghost' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// arriveShip
// ---------------------------------------------------------------------------

describe('isLegal — arriveShip', () => {
  it('legal for an off-table ship', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].offTable = true;
    expect(isLegal(s, { type: 'arriveShip', gid: 'player1:a', si: 0 }, 'player1')).toBe(true);
  });
  it('legal for a justArrived ship (repositionable)', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].justArrived = true;
    expect(isLegal(s, { type: 'arriveShip', gid: 'player1:a', si: 0 }, 'player1')).toBe(true);
  });
  it('illegal for an on-table ship that is not justArrived', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'arriveShip', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the group is activated', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].offTable = true;
    s.groups['player1:a'].activated = true;
    expect(isLegal(s, { type: 'arriveShip', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the ship has already moved', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].offTable = true;
    s.groups['player1:a'].ships[0].movedThisRound = true;
    expect(isLegal(s, { type: 'arriveShip', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal for the wrong side', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].offTable = true;
    expect(isLegal(s, { type: 'arriveShip', gid: 'player1:a', si: 0 }, 'player2')).toBe(false);
  });
  it('illegal outside the play phase', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].offTable = true;
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'arriveShip', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deployDone
// ---------------------------------------------------------------------------

describe('isLegal — deployDone', () => {
  it('legal for player1 when not yet confirmed', () => {
    const s = makeState();
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'deployDone', side: 'player1' }, 'player1')).toBe(true);
  });
  it('illegal when already confirmed', () => {
    const s = makeState();
    s.phase = 'deploy';
    s.deployDone = { player1: true };
    expect(isLegal(s, { type: 'deployDone', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal outside the deploy phase', () => {
    expect(isLegal(playState(), { type: 'deployDone', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when intent.side does not match the acting side', () => {
    const s = makeState();
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'deployDone', side: 'player1' }, 'player2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// adjustDropsiteDamage
// ---------------------------------------------------------------------------

describe('isLegal — adjustDropsiteDamage', () => {
  it('legal to increase damage in play phase', () => {
    expect(isLegal(dropsiteState(), { type: 'adjustDropsiteDamage', dsId: 'ds1', delta: 1 }, 'player1')).toBe(true);
  });
  it('legal to decrease damage when damage > 0', () => {
    const s = dropsiteState();
    s.scenarioData.dropsites[0].damage = 2;
    expect(isLegal(s, { type: 'adjustDropsiteDamage', dsId: 'ds1', delta: -1 }, 'player1')).toBe(true);
  });
  it('illegal to decrease when damage is 0', () => {
    expect(isLegal(dropsiteState(), { type: 'adjustDropsiteDamage', dsId: 'ds1', delta: -1 }, 'player1')).toBe(false);
  });
  it('illegal for a destroyed dropsite', () => {
    const s = dropsiteState();
    s.scenarioData.dropsites[0].destroyed = true;
    expect(isLegal(s, { type: 'adjustDropsiteDamage', dsId: 'ds1', delta: 1 }, 'player1')).toBe(false);
  });
  it('illegal for an unknown dropsite', () => {
    expect(isLegal(dropsiteState(), { type: 'adjustDropsiteDamage', dsId: 'ghost', delta: 1 }, 'player1')).toBe(false);
  });
  it('illegal outside play and da phases', () => {
    const s = dropsiteState();
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'adjustDropsiteDamage', dsId: 'ds1', delta: 1 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// adjustBattalion
// ---------------------------------------------------------------------------

describe('isLegal — adjustBattalion', () => {
  it('legal with a valid dropsite and integer delta', () => {
    expect(isLegal(dropsiteState(), { type: 'adjustBattalion', dsId: 'ds1', side: 'player1', delta: 1 }, 'player1')).toBe(true);
  });
  it('legal with negative delta', () => {
    expect(isLegal(dropsiteState(), { type: 'adjustBattalion', dsId: 'ds1', side: 'player2', delta: -2 }, 'player1')).toBe(true);
  });
  it('illegal with zero delta', () => {
    expect(isLegal(dropsiteState(), { type: 'adjustBattalion', dsId: 'ds1', side: 'player1', delta: 0 }, 'player1')).toBe(false);
  });
  it('illegal with a non-integer delta', () => {
    expect(isLegal(dropsiteState(), { type: 'adjustBattalion', dsId: 'ds1', side: 'player1', delta: 0.5 }, 'player1')).toBe(false);
  });
  it('illegal with an invalid side value', () => {
    expect(isLegal(dropsiteState(), { type: 'adjustBattalion', dsId: 'ds1', side: 'nobody', delta: 1 }, 'player1')).toBe(false);
  });
  it('illegal for an unknown dropsite', () => {
    expect(isLegal(dropsiteState(), { type: 'adjustBattalion', dsId: 'ghost', side: 'player1', delta: 1 }, 'player1')).toBe(false);
  });
  it('illegal outside play and da phases', () => {
    const s = dropsiteState();
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'adjustBattalion', dsId: 'ds1', side: 'player1', delta: 1 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// adjustOrbitalDecay
// ---------------------------------------------------------------------------

describe('isLegal — adjustOrbitalDecay', () => {
  it('legal to add a token', () => {
    expect(isLegal(playState(), { type: 'adjustOrbitalDecay', gid: 'player1:a', si: 0, delta: 1 }, 'player1')).toBe(true);
  });
  it('legal to remove a token when tokens exist', () => {
    const s = playState();
    s.groups['player1:a'].ships[0].orbitalDecayTokens = 2;
    expect(isLegal(s, { type: 'adjustOrbitalDecay', gid: 'player1:a', si: 0, delta: -1 }, 'player1')).toBe(true);
  });
  it('illegal to remove a token when none exist', () => {
    expect(isLegal(playState(), { type: 'adjustOrbitalDecay', gid: 'player1:a', si: 0, delta: -1 }, 'player1')).toBe(false);
  });
  it('illegal for a destroyed ship', () => {
    const s = playState();
    s.groups['player1:a'].ships[0].destroyed = true;
    expect(isLegal(s, { type: 'adjustOrbitalDecay', gid: 'player1:a', si: 0, delta: 1 }, 'player1')).toBe(false);
  });
  it('illegal for an unknown group', () => {
    expect(isLegal(playState(), { type: 'adjustOrbitalDecay', gid: 'ghost', si: 0, delta: 1 }, 'player1')).toBe(false);
  });
  it('illegal with a delta other than ±1', () => {
    expect(isLegal(playState(), { type: 'adjustOrbitalDecay', gid: 'player1:a', si: 0, delta: 2 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// attackSetReroll
// ---------------------------------------------------------------------------

describe('isLegal — attackSetReroll', () => {
  function rerollState({ step = 'hit', attackerSide = 'player1' } = {}) {
    const s = playState({ activeSide: attackerSide });
    const atkDef = shipDef({ id: `${attackerSide}:atk`, side: attackerSide });
    addGroup(s, atkDef, [shipInstance()]);
    s.attackModal = { step, attackerGid: `${attackerSide}:atk`, bomber: false,
                      shots: [], shotIdx: 0 };
    return s;
  }
  it('attacker can adjust hit rerolls during the hit step', () => {
    const s = rerollState({ step: 'hit', attackerSide: 'player1' });
    expect(isLegal(s, { type: 'attackSetReroll', delta: 1 }, 'player1')).toBe(true);
    expect(isLegal(s, { type: 'attackSetReroll', delta: -1 }, 'player1')).toBe(true);
  });
  it('defender can adjust save rerolls during the save step', () => {
    const s = rerollState({ step: 'save', attackerSide: 'player1' });
    expect(isLegal(s, { type: 'attackSetReroll', delta: 1 }, 'player2')).toBe(true);
  });
  it('attacker cannot act in the save step', () => {
    const s = rerollState({ step: 'save', attackerSide: 'player1' });
    expect(isLegal(s, { type: 'attackSetReroll', delta: 1 }, 'player1')).toBe(false);
  });
  it('illegal delta value (not ±1)', () => {
    const s = rerollState({ step: 'hit' });
    expect(isLegal(s, { type: 'attackSetReroll', delta: 2 }, 'player1')).toBe(false);
    expect(isLegal(s, { type: 'attackSetReroll', delta: 0 }, 'player1')).toBe(false);
  });
  it('illegal outside hit / save steps', () => {
    const s = rerollState({ step: 'intro' });
    expect(isLegal(s, { type: 'attackSetReroll', delta: 1 }, 'player1')).toBe(false);
  });
  it('illegal without an attackModal', () => {
    expect(isLegal(playState(), { type: 'attackSetReroll', delta: 1 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// attackStep / attackDeclare — ownership
// ---------------------------------------------------------------------------

describe('isLegal — attackStep / attackDeclare ownership', () => {
  // activeSide drives atk; no attackerGid needed since activeSide is the fallback.
  function modalState({ step = 'intro' } = {}) {
    const s = playState({ activeSide: 'player1' });
    s.attackModal = { step, bomber: false, attackerGid: null, shots: [], shotIdx: 0 };
    return s;
  }
  it('attacker can advance to a non-apply step', () => {
    expect(isLegal(modalState({ step: 'intro' }), { type: 'attackStep', to: 'hit' }, 'player1')).toBe(true);
  });
  it('defender can advance to the apply step', () => {
    expect(isLegal(modalState({ step: 'save' }), { type: 'attackStep', to: 'apply' }, 'player2')).toBe(true);
  });
  it('attacker cannot advance to the apply step', () => {
    expect(isLegal(modalState({ step: 'save' }), { type: 'attackStep', to: 'apply' }, 'player1')).toBe(false);
  });
  it('defender can declare shield', () => {
    expect(isLegal(modalState({ step: 'save' }), { type: 'attackDeclare', what: 'shield' }, 'player2')).toBe(true);
  });
  it('attacker cannot declare shield', () => {
    expect(isLegal(modalState({ step: 'save' }), { type: 'attackDeclare', what: 'shield' }, 'player1')).toBe(false);
  });
  it('attacker can declare overcharge', () => {
    expect(isLegal(modalState({ step: 'intro' }), { type: 'attackDeclare', what: 'overcharge' }, 'player1')).toBe(true);
  });
  it('illegal without an attackModal', () => {
    expect(isLegal(playState(), { type: 'attackStep', to: 'hit' }, 'player1')).toBe(false);
    expect(isLegal(playState(), { type: 'finishAttack' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DA intents (daFinishDropsite / daSwitchSide / daEnd)
// ---------------------------------------------------------------------------

describe('isLegal — daFinishDropsite', () => {
  it('legal when DA is active and the dropsite is not yet done', () => {
    expect(isLegal(daState(), { type: 'daFinishDropsite', dsId: 'ds1' }, 'player1')).toBe(true);
  });
  it('illegal when dropsiteActivation is null', () => {
    const s = daState();
    s.dropsiteActivation = null;
    expect(isLegal(s, { type: 'daFinishDropsite', dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal when the dropsite is already in the done list', () => {
    const s = daState();
    s.dropsiteActivation.done = ['ds1'];
    expect(isLegal(s, { type: 'daFinishDropsite', dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal when no dsId is provided', () => {
    expect(isLegal(daState(), { type: 'daFinishDropsite' }, 'player1')).toBe(false);
  });
});

describe('isLegal — daSwitchSide', () => {
  it('legal when dropsiteActivation is active', () => {
    expect(isLegal(daState(), { type: 'daSwitchSide' }, 'player1')).toBe(true);
  });
  it('illegal when dropsiteActivation is null', () => {
    const s = daState();
    s.dropsiteActivation = null;
    expect(isLegal(s, { type: 'daSwitchSide' }, 'player1')).toBe(false);
  });
});

describe('isLegal — daEnd', () => {
  it('legal when dropsiteActivation is active', () => {
    expect(isLegal(daState(), { type: 'daEnd' }, 'player1')).toBe(true);
  });
  it('illegal when dropsiteActivation is null', () => {
    const s = daState();
    s.dropsiteActivation = null;
    expect(isLegal(s, { type: 'daEnd' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// beginLaunch
// ---------------------------------------------------------------------------

describe('isLegal — beginLaunch', () => {
  it('legal when the ship has a launch slot at that index', () => {
    const s = playState({ activeSide: 'player1' });
    // Splice a launch slot onto the existing def
    const def = s.activeFleets.player1[0];
    def.launch = [{ name: 'Fighter', n: 2 }];
    expect(isLegal(s, { type: 'beginLaunch', gid: 'player1:a', si: 0, li: 0 }, 'player1')).toBe(true);
  });
  it('illegal when there is no launch entry at that index', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'beginLaunch', gid: 'player1:a', si: 0, li: 0 }, 'player1')).toBe(false);
  });
  it('illegal for wrong side', () => {
    const s = playState({ activeSide: 'player1' });
    const def = s.activeFleets.player1[0];
    def.launch = [{ name: 'Fighter', n: 2 }];
    expect(isLegal(s, { type: 'beginLaunch', gid: 'player1:a', si: 0, li: 0 }, 'player2')).toBe(false);
  });
  it('illegal when group is activated', () => {
    const s = playState({ activeSide: 'player1' });
    const def = s.activeFleets.player1[0];
    def.launch = [{ name: 'Fighter', n: 2 }];
    s.groups['player1:a'].activated = true;
    expect(isLegal(s, { type: 'beginLaunch', gid: 'player1:a', si: 0, li: 0 }, 'player1')).toBe(false);
  });
  it('illegal outside play phase', () => {
    const s = playState({ activeSide: 'player1' });
    const def = s.activeFleets.player1[0];
    def.launch = [{ name: 'Fighter', n: 2 }];
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'beginLaunch', gid: 'player1:a', si: 0, li: 0 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectGate / cancelLaunch
// ---------------------------------------------------------------------------

describe('isLegal — selectGate', () => {
  it('legal when state.launching matches gid and si', () => {
    const s = playState();
    s.launching = { gid: 'player1:a', si: 0 };
    expect(isLegal(s, { type: 'selectGate', gid: 'player1:a', si: 0 }, 'player1')).toBe(true);
  });
  it('illegal when there is no active launch', () => {
    expect(isLegal(playState(), { type: 'selectGate', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal when gid does not match the active launch', () => {
    const s = playState();
    s.launching = { gid: 'player2:b', si: 0 };
    expect(isLegal(s, { type: 'selectGate', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
});

describe('isLegal — cancelLaunch', () => {
  it('legal when state.launching matches', () => {
    const s = playState();
    s.launching = { gid: 'player1:a', si: 0 };
    expect(isLegal(s, { type: 'cancelLaunch', gid: 'player1:a', si: 0 }, 'player1')).toBe(true);
  });
  it('illegal when there is no active launch', () => {
    expect(isLegal(playState(), { type: 'cancelLaunch', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal for wrong side', () => {
    const s = playState();
    s.launching = { gid: 'player1:a', si: 0 };
    expect(isLegal(s, { type: 'cancelLaunch', gid: 'player1:a', si: 0 }, 'player2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// launchAsset
// ---------------------------------------------------------------------------

describe('isLegal — launchAsset', () => {
  it('legal with a valid ship, kind, and count', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'launchAsset', gid: 'player1:a', si: 0, kind: 'fighter', count: 2 }, 'player1')).toBe(true);
  });
  it('illegal when the ship has assessed', () => {
    const s = playState({ activeSide: 'player1' });
    s.groups['player1:a'].ships[0].hasAssessed = true;
    expect(isLegal(s, { type: 'launchAsset', gid: 'player1:a', si: 0, kind: 'fighter', count: 2 }, 'player1')).toBe(false);
  });
  it('illegal with no kind', () => {
    expect(isLegal(playState(), { type: 'launchAsset', gid: 'player1:a', si: 0, kind: '', count: 2 }, 'player1')).toBe(false);
  });
  it('illegal with count of 0', () => {
    expect(isLegal(playState(), { type: 'launchAsset', gid: 'player1:a', si: 0, kind: 'fighter', count: 0 }, 'player1')).toBe(false);
  });
  it('illegal for wrong side', () => {
    expect(isLegal(playState(), { type: 'launchAsset', gid: 'player1:a', si: 0, kind: 'fighter', count: 1 }, 'player2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// launchGroundAsset
// ---------------------------------------------------------------------------

describe('isLegal — launchGroundAsset', () => {
  it('legal with no gateSel restriction', () => {
    const s = playState({ activeSide: 'player1' });
    expect(isLegal(s, { type: 'launchGroundAsset', gid: 'player1:a', si: 0 }, 'player1')).toBe(true);
  });
  it('illegal when the selected voidgate is on MT order', () => {
    const s = playState({ activeSide: 'player1' });
    const gateDef = shipDef({ id: 'player1:gate', side: 'player1' });
    addGroup(s, gateDef, [shipInstance()]);
    s.groups['player1:gate'].order = 'MT';
    expect(isLegal(s, { type: 'launchGroundAsset', gid: 'player1:a', si: 0,
                        gateSel: { gid: 'player1:gate' } }, 'player1')).toBe(false);
  });
  it('illegal when the selected voidgate is on WF order', () => {
    const s = playState({ activeSide: 'player1' });
    const gateDef = shipDef({ id: 'player1:gate', side: 'player1' });
    addGroup(s, gateDef, [shipInstance()]);
    s.groups['player1:gate'].order = 'WF';
    expect(isLegal(s, { type: 'launchGroundAsset', gid: 'player1:a', si: 0,
                        gateSel: { gid: 'player1:gate' } }, 'player1')).toBe(false);
  });
  it('legal when selected voidgate is on GQ order', () => {
    const s = playState({ activeSide: 'player1' });
    const gateDef = shipDef({ id: 'player1:gate', side: 'player1' });
    addGroup(s, gateDef, [shipInstance()]);
    s.groups['player1:gate'].order = 'GQ';
    expect(isLegal(s, { type: 'launchGroundAsset', gid: 'player1:a', si: 0,
                        gateSel: { gid: 'player1:gate' } }, 'player1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deployPayload
// ---------------------------------------------------------------------------

describe('isLegal — deployPayload', () => {
  function payloadState() {
    const s = playState({ activeSide: 'player1' });
    // Porter ship
    const porterDef = shipDef({ id: 'player1:porter', side: 'player1' });
    addGroup(s, porterDef, [shipInstance({ x: 200, y: 200 })]);
    // Payload ship — off-table, attached to porter ship 0
    const payDef = shipDef({ id: 'player1:payload', side: 'player1' });
    addGroup(s, payDef, [shipInstance({ offTable: true,
                                        attachedTo: { gid: 'player1:porter', si: 0 } })]);
    return s;
  }
  it('legal when payload is attached to porter and within 3" (36px)', () => {
    const s = payloadState();
    expect(isLegal(s, { type: 'deployPayload', gid: 'player1:payload', si: 0,
                        porterGid: 'player1:porter', porterSi: 0, x: 220, y: 200 }, 'player1')).toBe(true);
  });
  it('illegal when payload is not off-table', () => {
    const s = payloadState();
    s.groups['player1:payload'].ships[0].offTable = false;
    expect(isLegal(s, { type: 'deployPayload', gid: 'player1:payload', si: 0,
                        porterGid: 'player1:porter', porterSi: 0, x: 220, y: 200 }, 'player1')).toBe(false);
  });
  it('illegal when payload is not attached to the porter', () => {
    const s = payloadState();
    s.groups['player1:payload'].ships[0].attachedTo = { gid: 'other', si: 0 };
    expect(isLegal(s, { type: 'deployPayload', gid: 'player1:payload', si: 0,
                        porterGid: 'player1:porter', porterSi: 0, x: 220, y: 200 }, 'player1')).toBe(false);
  });
  it('illegal when the deploy point is too far from the porter (>3" + 2px)', () => {
    const s = payloadState();
    // 3 * INCH + 2 = 38px; place at 39px away
    expect(isLegal(s, { type: 'deployPayload', gid: 'player1:payload', si: 0,
                        porterGid: 'player1:porter', porterSi: 0, x: 200, y: 239 }, 'player1')).toBe(false);
  });
  it('illegal when porter is activated', () => {
    const s = payloadState();
    s.groups['player1:porter'].activated = true;
    expect(isLegal(s, { type: 'deployPayload', gid: 'player1:payload', si: 0,
                        porterGid: 'player1:porter', porterSi: 0, x: 220, y: 200 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// attackSetFighterSpend
// ---------------------------------------------------------------------------

describe('isLegal — attackSetFighterSpend', () => {
  function fighterSpendState({ step = 'save' } = {}) {
    const s = playState({ activeSide: 'player1' });
    const tgtDef = shipDef({ id: 'player2:tgt', side: 'player2' });
    addGroup(s, tgtDef, [shipInstance()]);
    s.attackModal = { step, bomber: false, attackerGid: null,
                      shots: [{ wi: 0, w: {}, targetGid: 'player2:tgt', targetSi: 0 }],
                      shotIdx: 0 };
    return s;
  }
  it('legal for the defender at the save step', () => {
    expect(isLegal(fighterSpendState({ step: 'save' }), { type: 'attackSetFighterSpend', delta: 1 }, 'player2')).toBe(true);
  });
  it('illegal for the attacker', () => {
    expect(isLegal(fighterSpendState({ step: 'save' }), { type: 'attackSetFighterSpend', delta: 1 }, 'player1')).toBe(false);
  });
  it('illegal outside the save step', () => {
    expect(isLegal(fighterSpendState({ step: 'hit' }), { type: 'attackSetFighterSpend', delta: 1 }, 'player2')).toBe(false);
  });
  it('illegal with delta other than ±1', () => {
    expect(isLegal(fighterSpendState({ step: 'save' }), { type: 'attackSetFighterSpend', delta: 2 }, 'player2')).toBe(false);
  });
  it('illegal without an attackModal', () => {
    expect(isLegal(playState(), { type: 'attackSetFighterSpend', delta: 1 }, 'player2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// attackSelectShot
// ---------------------------------------------------------------------------

describe('isLegal — attackSelectShot', () => {
  function selectState() {
    const s = playState({ activeSide: 'player1' });
    s.attackModal = { step: 'select', shots: [{}, {}], resolvedShots: [0] };
    return s;
  }
  it('legal for an unresolved shot index', () => {
    expect(isLegal(selectState(), { type: 'attackSelectShot', shotIdx: 1 }, 'player1')).toBe(true);
  });
  it('illegal when step is not select', () => {
    const s = selectState();
    s.attackModal.step = 'hit';
    expect(isLegal(s, { type: 'attackSelectShot', shotIdx: 1 }, 'player1')).toBe(false);
  });
  it('illegal when shotIdx is out of range', () => {
    expect(isLegal(selectState(), { type: 'attackSelectShot', shotIdx: 5 }, 'player1')).toBe(false);
  });
  it('illegal when the shot is already resolved', () => {
    expect(isLegal(selectState(), { type: 'attackSelectShot', shotIdx: 0 }, 'player1')).toBe(false);
  });
  it('illegal without an attackModal', () => {
    expect(isLegal(playState(), { type: 'attackSelectShot', shotIdx: 0 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// openDAFeatureAttack
// ---------------------------------------------------------------------------

describe('isLegal — openDAFeatureAttack', () => {
  function featureState({ firedFeatures = [], destroyedFeatures = [] } = {}) {
    const s = daState();
    s.scenarioData.dropsites[0].features = { 0: 'military_outpost' };
    s.scenarioData.dropsites[0].firedFeatures = firedFeatures;
    s.scenarioData.dropsites[0].destroyedFeatures = destroyedFeatures;
    return s;
  }
  it('legal when DA is active and the feature has a weapon', () => {
    expect(isLegal(featureState(), { type: 'openDAFeatureAttack', dsId: 'ds1', fi: 0 }, 'player1')).toBe(true);
  });
  it('illegal when dropsiteActivation is null', () => {
    const s = featureState();
    s.dropsiteActivation = null;
    expect(isLegal(s, { type: 'openDAFeatureAttack', dsId: 'ds1', fi: 0 }, 'player1')).toBe(false);
  });
  it('illegal for wrong DA side', () => {
    expect(isLegal(featureState(), { type: 'openDAFeatureAttack', dsId: 'ds1', fi: 0 }, 'player2')).toBe(false);
  });
  it('illegal when the feature has already fired this activation', () => {
    expect(isLegal(featureState({ firedFeatures: [0] }), { type: 'openDAFeatureAttack', dsId: 'ds1', fi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the feature is destroyed', () => {
    expect(isLegal(featureState({ destroyedFeatures: [0] }), { type: 'openDAFeatureAttack', dsId: 'ds1', fi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when there is no matching feature key', () => {
    expect(isLegal(featureState(), { type: 'openDAFeatureAttack', dsId: 'ds1', fi: 99 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// daPickDropsite
// ---------------------------------------------------------------------------

describe('isLegal — daPickDropsite', () => {
  it('legal when DA is active and the dropsite exists', () => {
    expect(isLegal(daState(), { type: 'daPickDropsite', dsId: 'ds1' }, 'player1')).toBe(true);
  });
  it('illegal when dropsiteActivation is null', () => {
    const s = daState();
    s.dropsiteActivation = null;
    expect(isLegal(s, { type: 'daPickDropsite', dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal for wrong DA side', () => {
    expect(isLegal(daState(), { type: 'daPickDropsite', dsId: 'ds1' }, 'player2')).toBe(false);
  });
  it('illegal for an unknown dropsite id', () => {
    expect(isLegal(daState(), { type: 'daPickDropsite', dsId: 'ghost' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// launchDropsiteAsset
// ---------------------------------------------------------------------------

describe('isLegal — launchDropsiteAsset', () => {
  it('legal when DA is active and fromDropsite resolves', () => {
    const s = daState();
    expect(isLegal(s, { type: 'launchDropsiteAsset', fromDropsite: 'ds1' }, 'player1')).toBe(true);
  });
  it('illegal when dropsiteActivation is null', () => {
    const s = daState();
    s.dropsiteActivation = null;
    expect(isLegal(s, { type: 'launchDropsiteAsset', fromDropsite: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal when fromDropsite does not resolve to a known dropsite', () => {
    expect(isLegal(daState(), { type: 'launchDropsiteAsset', fromDropsite: 'ghost' }, 'player1')).toBe(false);
  });
  it('illegal when no fromDropsite is provided', () => {
    expect(isLegal(daState(), { type: 'launchDropsiteAsset' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setNomination / confirmNominations
// ---------------------------------------------------------------------------

describe('isLegal — setNomination', () => {
  it('legal in the nominations phase for the correct side', () => {
    const s = makeState();
    s.phase = 'nominations';
    expect(isLegal(s, { type: 'setNomination', side: 'player1', key: 'obj1' }, 'player1')).toBe(true);
  });
  it('illegal outside the nominations phase', () => {
    expect(isLegal(playState(), { type: 'setNomination', side: 'player1', key: 'obj1' }, 'player1')).toBe(false);
  });
  it('illegal when side does not match', () => {
    const s = makeState();
    s.phase = 'nominations';
    expect(isLegal(s, { type: 'setNomination', side: 'player1', key: 'obj1' }, 'player2')).toBe(false);
  });
  it('illegal when key is missing', () => {
    const s = makeState();
    s.phase = 'nominations';
    expect(isLegal(s, { type: 'setNomination', side: 'player1', key: '' }, 'player1')).toBe(false);
  });
});

describe('isLegal — confirmNominations', () => {
  it('legal when nominations phase and not yet confirmed', () => {
    const s = makeState();
    s.phase = 'nominations';
    expect(isLegal(s, { type: 'confirmNominations', side: 'player1' }, 'player1')).toBe(true);
  });
  it('illegal outside the nominations phase', () => {
    expect(isLegal(playState(), { type: 'confirmNominations', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when already confirmed', () => {
    const s = makeState();
    s.phase = 'nominations';
    s.nominationsReady = { player1: true };
    expect(isLegal(s, { type: 'confirmNominations', side: 'player1' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setProtectNom / confirmProtectNom
// ---------------------------------------------------------------------------

describe('isLegal — setProtectNom', () => {
  it('legal in the protect phase', () => {
    const s = makeState();
    s.phase = 'protect';
    expect(isLegal(s, { type: 'setProtectNom', side: 'player1' }, 'player1')).toBe(true);
  });
  it('illegal outside the protect phase', () => {
    expect(isLegal(playState(), { type: 'setProtectNom', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when intent.side does not match the acting side', () => {
    const s = makeState();
    s.phase = 'protect';
    expect(isLegal(s, { type: 'setProtectNom', side: 'player2' }, 'player1')).toBe(false);
  });
});

describe('isLegal — confirmProtectNom', () => {
  it('legal when protect phase and not yet confirmed', () => {
    const s = makeState();
    s.phase = 'protect';
    expect(isLegal(s, { type: 'confirmProtectNom', side: 'player1' }, 'player1')).toBe(true);
  });
  it('illegal outside the protect phase', () => {
    expect(isLegal(playState(), { type: 'confirmProtectNom', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when already confirmed', () => {
    const s = makeState();
    s.phase = 'protect';
    s.protectNomReady = { player1: true };
    expect(isLegal(s, { type: 'confirmProtectNom', side: 'player1' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// holdPosition
// ---------------------------------------------------------------------------

describe('isLegal — holdPosition', () => {
  it('legal under CC order before moving', () => {
    const s = playState({ activeSide: 'player1', order: 'CC' });
    expect(isLegal(s, { type: 'holdPosition', gid: 'player1:a', si: 0 }, 'player1')).toBe(true);
  });
  it('legal under DC order before moving', () => {
    const s = playState({ activeSide: 'player1', order: 'DC' });
    expect(isLegal(s, { type: 'holdPosition', gid: 'player1:a', si: 0 }, 'player1')).toBe(true);
  });
  it('illegal under WF order', () => {
    const s = playState({ activeSide: 'player1', order: 'WF' });
    expect(isLegal(s, { type: 'holdPosition', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal after the ship has already moved', () => {
    const s = playState({ activeSide: 'player1', order: 'CC' });
    s.groups['player1:a'].ships[0].movedThisRound = true;
    // gate returns null (falsy) when state.aiming is null and short-circuits; toBeFalsy covers both
    expect(isLegal(s, { type: 'holdPosition', gid: 'player1:a', si: 0 }, 'player1')).toBeFalsy();
  });
  it('illegal after the ship has fired', () => {
    const s = playState({ activeSide: 'player1', order: 'CC' });
    s.groups['player1:a'].ships[0].firedThisActivation = true;
    expect(isLegal(s, { type: 'holdPosition', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal when group is already activated', () => {
    const s = playState({ activeSide: 'player1', order: 'CC' });
    s.groups['player1:a'].activated = true;
    expect(isLegal(s, { type: 'holdPosition', gid: 'player1:a', si: 0 }, 'player1')).toBe(false);
  });
  it('illegal for wrong side', () => {
    const s = playState({ activeSide: 'player1', order: 'CC' });
    expect(isLegal(s, { type: 'holdPosition', gid: 'player1:a', si: 0 }, 'player2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractRecon / surveySite / objectivesFlyoff / breakthroughFlyoff
// ---------------------------------------------------------------------------

describe('isLegal — extractRecon (shared objective action guard)', () => {
  // These four intent types share the same gate body.
  // We test extractRecon as representative; the other three behave identically.
  function reconState() {
    const s = makeState();
    s.phase = 'play';
    const def = shipDef({ id: 'player1:trans', side: 'player1',
                          special: 'Transport-6' }); // transport keyword for transportValue
    addGroup(s, def, [shipInstance({ x: 200, y: 200 })]);
    s.activeSide = 'player1';
    s.scenarioData = {
      dropsites: [{ id: 'ds1', x: 200 / 12, y: 200 / 12, reconOps: 1,
                    damage: 0, destroyed: false }],
    };
    return s;
  }
  it('illegal when the dropsite has no reconOps remaining', () => {
    const s = reconState();
    s.scenarioData.dropsites[0].reconOps = 0;
    expect(isLegal(s, { type: 'extractRecon', gid: 'player1:trans', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal when the ship has already fired', () => {
    const s = reconState();
    s.groups['player1:trans'].ships[0].firedThisActivation = true;
    expect(isLegal(s, { type: 'extractRecon', gid: 'player1:trans', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal outside the play phase', () => {
    const s = reconState();
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'extractRecon', gid: 'player1:trans', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal for wrong side', () => {
    const s = reconState();
    expect(isLegal(s, { type: 'extractRecon', gid: 'player1:trans', si: 0, dsId: 'ds1' }, 'player2')).toBe(false);
  });
  it('surveySite uses the same gate', () => {
    const s = reconState();
    s.scenarioData.dropsites[0].reconOps = 0;
    expect(isLegal(s, { type: 'surveySite', gid: 'player1:trans', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assessDropsite
// ---------------------------------------------------------------------------

describe('isLegal — assessDropsite', () => {
  it('illegal when the side\'s objective is not assess', () => {
    const s = dropsiteState();
    // objectiveForSide returns null/undefined with no scenario objectives set
    const def = shipDef({ id: 'player1:cap', side: 'player1', tonnage: 'H', special: 'Capital' });
    addGroup(s, def, [shipInstance({ x: 120, y: 120 })]);
    s.groups['player1:cap'].order = 'GQ';
    s.scenarioData.dropsites[0].siteRules = ['assess'];
    s.scenarioData.dropsites[0].x = 10; s.scenarioData.dropsites[0].y = 10;
    expect(isLegal(s, { type: 'assessDropsite', gid: 'player1:cap', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal when the group does not have GQ order', () => {
    const s = dropsiteState();
    s.scenario = { objectives: { player1: 'assess', player2: 'assess' } };
    const def = shipDef({ id: 'player1:cap', side: 'player1', tonnage: 'H', special: 'Capital' });
    addGroup(s, def, [shipInstance({ x: 120, y: 120 })]);
    s.groups['player1:cap'].order = 'WF';
    s.scenarioData.dropsites[0].siteRules = ['assess'];
    expect(isLegal(s, { type: 'assessDropsite', gid: 'player1:cap', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal outside the play phase', () => {
    const s = dropsiteState();
    s.phase = 'deploy';
    const def = shipDef({ id: 'player1:cap', side: 'player1' });
    addGroup(s, def, [shipInstance()]);
    expect(isLegal(s, { type: 'assessDropsite', gid: 'player1:cap', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assetStageDone / assetPhaseDone
// ---------------------------------------------------------------------------

describe('isLegal — assetStageDone', () => {
  function assetPhaseState({ assetType = 'fighter', activeSide = 'player1' } = {}) {
    const s = makeState();
    s.phase = 'play';
    s.assetPhase = { step: 'assets', assetType };
    s.assetActiveSide = activeSide;
    return s;
  }
  it('legal when asset phase is active for the correct side and type', () => {
    const s = assetPhaseState();
    expect(isLegal(s, { type: 'assetStageDone', side: 'player1', assetType: 'fighter' }, 'player1')).toBe(true);
  });
  it('illegal when assetPhase is null', () => {
    const s = makeState();
    expect(isLegal(s, { type: 'assetStageDone', side: 'player1', assetType: 'fighter' }, 'player1')).toBe(false);
  });
  it('illegal when assetActiveSide does not match', () => {
    const s = assetPhaseState({ activeSide: 'player2' });
    expect(isLegal(s, { type: 'assetStageDone', side: 'player1', assetType: 'fighter' }, 'player1')).toBe(false);
  });
  it('illegal when assetType does not match', () => {
    const s = assetPhaseState({ assetType: 'bomber' });
    expect(isLegal(s, { type: 'assetStageDone', side: 'player1', assetType: 'fighter' }, 'player1')).toBe(false);
  });
});

describe('isLegal — assetPhaseDone', () => {
  function assetDoneState() {
    const s = makeState();
    s.phase = 'play';
    s.assetPhase = { step: 'assets', doneSides: [] };
    s.assetActiveSide = null; // no more active side — both sides confirming
    return s;
  }
  it('legal when no side is active and this side has not yet confirmed', () => {
    expect(isLegal(assetDoneState(), { type: 'assetPhaseDone', side: 'player1' }, 'player1')).toBe(true);
  });
  it('illegal when assetActiveSide is still set', () => {
    const s = assetDoneState();
    s.assetActiveSide = 'player1';
    expect(isLegal(s, { type: 'assetPhaseDone', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when the side has already confirmed', () => {
    const s = assetDoneState();
    s.assetPhase.doneSides = ['player1'];
    expect(isLegal(s, { type: 'assetPhaseDone', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when _pendingBomberResolve is set', () => {
    const s = assetDoneState();
    s.assetPhase._pendingBomberResolve = true;
    expect(isLegal(s, { type: 'assetPhaseDone', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when assetPhase is null', () => {
    expect(isLegal(makeState(), { type: 'assetPhaseDone', side: 'player1' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// placeScenery
// ---------------------------------------------------------------------------

describe('isLegal — placeScenery', () => {
  it('illegal outside the scenery phase', () => {
    expect(isLegal(playState(), { type: 'placeScenery', sceneryType: 'micrometeor', x: 5, y: 5 }, 'player1')).toBe(false);
  });
  it('illegal for an unknown scenery type', () => {
    const s = makeState();
    s.phase = 'scenery';
    expect(isLegal(s, { type: 'placeScenery', sceneryType: 'asteroid', x: 5, y: 5 }, 'player1')).toBe(false);
  });
  it('illegal when it is the other side\'s scenery turn', () => {
    const s = makeState();
    s.phase = 'scenery';
    s.sceneryTurn = 'player2';
    expect(isLegal(s, { type: 'placeScenery', sceneryType: 'micrometeor', x: 5, y: 5 }, 'player1')).toBe(false);
  });
  it('illegal when the quota for this type is already met', () => {
    const s = makeState();
    s.phase = 'scenery';
    s.scenarioData = { placedScenery: [{ type: 'micrometeor' }],
                       sceneryTargets: { micrometeor: 1 } };
    expect(isLegal(s, { type: 'placeScenery', sceneryType: 'micrometeor', x: 5, y: 5 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assetMove
// ---------------------------------------------------------------------------

describe('isLegal — assetMove', () => {
  function assetMoveState() {
    const s = makeState();
    s.phase = 'play';
    s.assetPhase = { step: 'assets', assetType: 'fighter' };
    s.assetActiveSide = 'player1';
    s.launchedAssets = [{
      id: 'a1', side: 'player1', kind: 'fighter', count: 2,
      x: 200, y: 200, moved: false, thrust: 6,
    }];
    return s;
  }
  it('legal when asset is within thrust range', () => {
    const s = assetMoveState();
    // fighters have thrust based on assetThrust; move a tiny distance
    expect(isLegal(s, { type: 'assetMove', assetId: 'a1', x: 204, y: 200 }, 'player1')).toBe(true);
  });
  it('illegal when asset has already moved', () => {
    const s = assetMoveState();
    s.launchedAssets[0].moved = true;
    expect(isLegal(s, { type: 'assetMove', assetId: 'a1', x: 204, y: 200 }, 'player1')).toBe(false);
  });
  it('illegal for a mine (mines cannot move)', () => {
    const s = assetMoveState();
    s.launchedAssets[0].kind = 'mine';
    expect(isLegal(s, { type: 'assetMove', assetId: 'a1', x: 204, y: 200 }, 'player1')).toBe(false);
  });
  it('illegal when assetPhase is null', () => {
    const s = assetMoveState();
    s.assetPhase = null;
    expect(isLegal(s, { type: 'assetMove', assetId: 'a1', x: 204, y: 200 }, 'player1')).toBe(false);
  });
  it('illegal when the asset belongs to the inactive side', () => {
    const s = assetMoveState();
    s.launchedAssets[0].side = 'player2';
    expect(isLegal(s, { type: 'assetMove', assetId: 'a1', x: 204, y: 200 }, 'player2')).toBe(false);
  });
  it('illegal for an unknown asset id', () => {
    expect(isLegal(assetMoveState(), { type: 'assetMove', assetId: 'ghost', x: 204, y: 200 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startAssetMove
// ---------------------------------------------------------------------------

describe('isLegal — startAssetMove', () => {
  it('legal when assetPhase exists but step is not assets', () => {
    const s = makeState();
    s.assetPhase = { step: 'board' };
    expect(isLegal(s, { type: 'startAssetMove' }, 'player1')).toBe(true);
  });
  it('illegal when assetPhase is null', () => {
    expect(isLegal(makeState(), { type: 'startAssetMove' }, 'player1')).toBe(false);
  });
  it('illegal when step is assets', () => {
    const s = makeState();
    s.assetPhase = { step: 'assets' };
    expect(isLegal(s, { type: 'startAssetMove' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assetT2T / selectAssetMove / assetLockTarget / assetUntarget (phase-only gate)
// ---------------------------------------------------------------------------

describe('isLegal — asset targeting passthrough intents', () => {
  for (const type of ['assetT2T', 'selectAssetMove', 'assetLockTarget', 'assetUntarget']) {
    it(`${type}: legal during play phase`, () => {
      expect(isLegal(playState(), { type }, 'player1')).toBe(true);
    });
    it(`${type}: legal during deploy phase`, () => {
      const s = makeState();
      s.phase = 'deploy';
      expect(isLegal(s, { type }, 'player1')).toBe(true);
    });
    it(`${type}: illegal during setup phase`, () => {
      const s = makeState();
      s.phase = 'setup';
      expect(isLegal(s, { type }, 'player1')).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// dismissDogfight
// ---------------------------------------------------------------------------

describe('isLegal — dismissDogfight', () => {
  it('legal when a dogfight result is present', () => {
    const s = makeState();
    s.dogfightResult = { winner: 'player1' };
    expect(isLegal(s, { type: 'dismissDogfight' }, 'player1')).toBe(true);
  });
  it('illegal when there is no dogfight result', () => {
    expect(isLegal(makeState(), { type: 'dismissDogfight' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// beginBomberAttack
// ---------------------------------------------------------------------------

describe('isLegal — beginBomberAttack', () => {
  function bomberState() {
    const s = makeState();
    s.phase = 'play';
    s.assetPhase = { step: 'assets' };
    return s;
  }
  it('legal when asset phase is active, correct side, no attackModal', () => {
    expect(isLegal(bomberState(), { type: 'beginBomberAttack', side: 'player1' }, 'player1')).toBe(true);
  });
  it('illegal when intent.side does not match the acting side', () => {
    expect(isLegal(bomberState(), { type: 'beginBomberAttack', side: 'player2' }, 'player1')).toBe(false);
  });
  it('illegal when an attackModal is already open', () => {
    const s = bomberState();
    s.attackModal = { step: 'intro' };
    expect(isLegal(s, { type: 'beginBomberAttack', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when assetPhase is null', () => {
    expect(isLegal(makeState(), { type: 'beginBomberAttack', side: 'player1' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bulk phase-passthrough intents (play or deploy only)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// commitScenario / readySetup / unreadySetup
// ---------------------------------------------------------------------------

describe('isLegal — commitScenario', () => {
  function readyScenario(overrides = {}) {
    const s = makeState();
    s.phase = 'setup';
    s.fleetChoices = { f1: 'ucm', f2: 'scourge' };
    s.scenario = { deployment: 'diagonal', approach: 'direct',
                   layout: 'layout1', variant: 'standard', objective: 'supremacy', ...overrides };
    return s;
  }
  it('legal when all required scenario fields are present', () => {
    expect(isLegal(readyScenario(), { type: 'commitScenario' }, 'player1')).toBe(true);
  });
  it('illegal when a required scenario field is missing', () => {
    const s = readyScenario({ deployment: null });
    expect(isLegal(s, { type: 'commitScenario' }, 'player1')).toBe(false);
  });
  it('illegal when fleet choices are incomplete', () => {
    const s = readyScenario();
    s.fleetChoices = { f1: 'ucm' };
    expect(isLegal(s, { type: 'commitScenario' }, 'player1')).toBe(false);
  });
  it('illegal when no objective is set', () => {
    const s = readyScenario({ objective: null });
    expect(isLegal(s, { type: 'commitScenario' }, 'player1')).toBe(false);
  });
  it('legal with per-side objectives instead of a shared one', () => {
    const s = readyScenario({ objective: null,
                               objectives: { player1: 'assess', player2: 'supremacy' } });
    expect(isLegal(s, { type: 'commitScenario' }, 'player1')).toBe(true);
  });
  it('illegal outside the setup phase', () => {
    expect(isLegal(playState(), { type: 'commitScenario' }, 'player1')).toBe(false);
  });
});

describe('isLegal — readySetup', () => {
  function readyState() {
    const s = makeState();
    s.phase = 'setup';
    s.fleetChoices = { f1: 'ucm', f2: 'scourge' };
    s.scenario = { deployment: 'diagonal', approach: 'direct',
                   layout: 'layout1', variant: 'standard', objective: 'supremacy' };
    return s;
  }
  it('legal when all fields are present and not yet ready', () => {
    expect(isLegal(readyState(), { type: 'readySetup', side: 'player1' }, 'player1')).toBe(true);
  });
  it('illegal when already marked ready', () => {
    const s = readyState();
    s.setupReady = { player1: true };
    expect(isLegal(s, { type: 'readySetup', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when intent.side does not match acting side', () => {
    expect(isLegal(readyState(), { type: 'readySetup', side: 'player2' }, 'player1')).toBe(false);
  });
  it('illegal when a required scenario field is missing', () => {
    const s = readyState();
    s.scenario.deployment = null;
    expect(isLegal(s, { type: 'readySetup', side: 'player1' }, 'player1')).toBe(false);
  });
});

describe('isLegal — unreadySetup', () => {
  it('legal when the side is marked ready', () => {
    const s = makeState();
    s.phase = 'setup';
    s.setupReady = { player1: true };
    expect(isLegal(s, { type: 'unreadySetup', side: 'player1' }, 'player1')).toBe(true);
  });
  it('illegal when not yet ready', () => {
    const s = makeState();
    s.phase = 'setup';
    expect(isLegal(s, { type: 'unreadySetup', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal outside the setup phase', () => {
    const s = makeState();
    s.setupReady = { player1: true };
    // phase defaults to 'play' in makeState
    expect(isLegal(s, { type: 'unreadySetup', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when intent.side does not match', () => {
    const s = makeState();
    s.phase = 'setup';
    s.setupReady = { player1: true };
    expect(isLegal(s, { type: 'unreadySetup', side: 'player2' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// commitScenery
// ---------------------------------------------------------------------------

describe('isLegal — commitScenery', () => {
  it('legal in scenery phase before marking ready', () => {
    const s = makeState();
    s.phase = 'scenery';
    expect(isLegal(s, { type: 'commitScenery', side: 'player1' }, 'player1')).toBe(true);
  });
  it('illegal when side already marked scenery-ready', () => {
    const s = makeState();
    s.phase = 'scenery';
    s.sceneryReady = { player1: true };
    expect(isLegal(s, { type: 'commitScenery', side: 'player1' }, 'player1')).toBe(false);
  });
  it('illegal when intent.side does not match the acting side', () => {
    const s = makeState();
    s.phase = 'scenery';
    expect(isLegal(s, { type: 'commitScenery', side: 'player2' }, 'player1')).toBe(false);
  });
  it('illegal outside the scenery phase', () => {
    expect(isLegal(playState(), { type: 'commitScenery', side: 'player1' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useDetector
// ---------------------------------------------------------------------------

describe('isLegal — useDetector', () => {
  function detectorState() {
    const s = makeState();
    s.phase = 'play';
    s.activeSide = 'player1';
    const atkDef = shipDef({ id: 'player1:det', side: 'player1',
                             weapons: [weapon({ arc: 'LoS', name: 'Detector' })] });
    const tgtDef = shipDef({ id: 'player2:tgt', side: 'player2' });
    addGroup(s, atkDef, [shipInstance({ x: 200, y: 200 })]);
    addGroup(s, tgtDef, [shipInstance({ x: 240, y: 200 })]);
    return s;
  }
  it('legal for a LoS weapon targeting an enemy ship', () => {
    const s = detectorState();
    expect(isLegal(s, { type: 'useDetector', gid: 'player1:det', si: 0, wi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(true);
  });
  it('illegal when the ship has already used its detector this activation', () => {
    const s = detectorState();
    s.groups['player1:det'].ships[0].detectorUsed = true;
    expect(isLegal(s, { type: 'useDetector', gid: 'player1:det', si: 0, wi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the ship has already fired', () => {
    const s = detectorState();
    s.groups['player1:det'].ships[0].firedThisActivation = true;
    expect(isLegal(s, { type: 'useDetector', gid: 'player1:det', si: 0, wi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when targeting a friendly ship', () => {
    const s = detectorState();
    const friendDef = shipDef({ id: 'player1:ally', side: 'player1' });
    addGroup(s, friendDef, [shipInstance({ x: 220, y: 200 })]);
    expect(isLegal(s, { type: 'useDetector', gid: 'player1:det', si: 0, wi: 0,
                        targetGid: 'player1:ally', targetSi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the target is destroyed', () => {
    const s = detectorState();
    s.groups['player2:tgt'].ships[0].destroyed = true;
    expect(isLegal(s, { type: 'useDetector', gid: 'player1:det', si: 0, wi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(false);
  });
  it('illegal outside play phase', () => {
    const s = detectorState();
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'useDetector', gid: 'player1:det', si: 0, wi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when group is activated', () => {
    const s = detectorState();
    s.groups['player1:det'].activated = true;
    expect(isLegal(s, { type: 'useDetector', gid: 'player1:det', si: 0, wi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assessDropsite — happy path
// ---------------------------------------------------------------------------

describe('isLegal — assessDropsite (happy path)', () => {
  function assessState() {
    const s = makeState();
    s.phase = 'play';
    s.activeSide = 'player1';
    s.scenario = { objectives: { player1: 'assess', player2: 'assess' } };
    const def = shipDef({ id: 'player1:cap', side: 'player1', tonnage: 'H' });
    addGroup(s, def, [shipInstance({ x: 120, y: 120 })]);
    s.groups['player1:cap'].order = 'GQ';
    s.scenarioData = {
      dropsites: [{ id: 'ds1', x: 10, y: 10,  // 10*12=120px → distance = 0
                    damage: 0, destroyed: false, siteRules: ['assess'] }],
    };
    return s;
  }
  it('legal when all conditions are satisfied', () => {
    expect(isLegal(assessState(), { type: 'assessDropsite', gid: 'player1:cap', si: 0, dsId: 'ds1' }, 'player1')).toBe(true);
  });
  it('illegal when the ship is off-table', () => {
    const s = assessState();
    s.groups['player1:cap'].ships[0].offTable = true;
    expect(isLegal(s, { type: 'assessDropsite', gid: 'player1:cap', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal when this dropsite has already been assessed by this side', () => {
    const s = assessState();
    s.assessedDropsites = { player1: ['ds1'] };
    expect(isLegal(s, { type: 'assessDropsite', gid: 'player1:cap', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal when the dropsite has no assess siteRule', () => {
    const s = assessState();
    s.scenarioData.dropsites[0].siteRules = [];
    expect(isLegal(s, { type: 'assessDropsite', gid: 'player1:cap', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal when the ship is out of range (> 6")', () => {
    const s = assessState();
    s.groups['player1:cap'].ships[0].x = 500; // far away
    s.groups['player1:cap'].ships[0].y = 500;
    expect(isLegal(s, { type: 'assessDropsite', gid: 'player1:cap', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal with a non-capital ship (tonnage L)', () => {
    const s = assessState();
    // Override the def with a Light tonnage ship
    const def2 = shipDef({ id: 'player1:light', side: 'player1', tonnage: 'L' });
    addGroup(s, def2, [shipInstance({ x: 120, y: 120 })]);
    s.groups['player1:light'].order = 'GQ';
    expect(isLegal(s, { type: 'assessDropsite', gid: 'player1:light', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractRecon — happy path
// ---------------------------------------------------------------------------

describe('isLegal — extractRecon (happy path)', () => {
  function reconState() {
    const s = makeState();
    s.phase = 'play';
    s.activeSide = 'player1';
    // Lander launch slot gives transportValue > 0
    const def = shipDef({ id: 'player1:trans', side: 'player1',
                          launch: [{ type: 'lander', n: 2, name: 'Lander' }] });
    addGroup(s, def, [shipInstance({ x: 120, y: 120 })]);
    s.scenarioData = {
      dropsites: [{ id: 'ds1', x: 10, y: 10, reconOps: 1,
                    damage: 0, destroyed: false }],
    };
    return s;
  }
  it('legal for a transport ship within 6" of a dropsite with reconOps', () => {
    expect(isLegal(reconState(), { type: 'extractRecon', gid: 'player1:trans', si: 0, dsId: 'ds1' }, 'player1')).toBe(true);
  });
  it('surveySite uses the same gate — also legal', () => {
    expect(isLegal(reconState(), { type: 'surveySite', gid: 'player1:trans', si: 0, dsId: 'ds1' }, 'player1')).toBe(true);
  });
  it('illegal for a ship with no transport capacity', () => {
    const s = reconState();
    s.activeFleets.player1[0].launch = []; // no lander slots
    expect(isLegal(s, { type: 'extractRecon', gid: 'player1:trans', si: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// placeScenery — happy path
// ---------------------------------------------------------------------------

describe('isLegal — placeScenery (happy path)', () => {
  function sceneryState({ placed = 0, target = 2 } = {}) {
    const s = makeState();
    s.phase = 'scenery';
    s.scenarioData = {
      placedScenery: Array.from({ length: placed }, () => ({ type: 'micrometeor', x: 40, y: 40 })),
      largeObjects: [],
      sceneryTargets: { micrometeor: target },
    };
    return s;
  }
  it('legal at the board centre with quota available', () => {
    const s = sceneryState({ placed: 0, target: 2 });
    // x=24, y=24 → centre of 48"×48" board, well clear of all edges and zones
    expect(isLegal(s, { type: 'placeScenery', sceneryType: 'micrometeor', x: 24, y: 24 }, 'player1')).toBe(true);
  });
  it('legal for dense scenery type', () => {
    const s = makeState();
    s.phase = 'scenery';
    s.scenarioData = { placedScenery: [], largeObjects: [],
                       sceneryTargets: { dense: 1 } };
    expect(isLegal(s, { type: 'placeScenery', sceneryType: 'dense', x: 24, y: 24 }, 'player1')).toBe(true);
  });
  it('illegal too close to the board edge (< 4")', () => {
    const s = sceneryState();
    expect(isLegal(s, { type: 'placeScenery', sceneryType: 'micrometeor', x: 2, y: 24 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// giveInitiative / beginActivation — null-side branch
// ---------------------------------------------------------------------------

describe('isLegal — giveInitiative / beginActivation with null side', () => {
  it('giveInitiative legal when side is null (server validation bypassed)', () => {
    const s = playState();
    s.initiative = { winner: 'player1', holder: 'player1' };
    expect(isLegal(s, { type: 'giveInitiative' }, null)).toBe(true);
  });
  it('beginActivation legal when side is null', () => {
    const s = playState();
    s.initiative = { winner: 'player1', holder: 'player1' };
    expect(isLegal(s, { type: 'beginActivation' }, null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fireFeatureWeapon — full validation (stub removed; complete case now runs)
// ---------------------------------------------------------------------------

describe('isLegal — fireFeatureWeapon', () => {
  function ffwState({ phase = 'play' } = {}) {
    const s = makeState();
    s.phase = phase;
    s.activeSide = 'player1';
    s.daActiveSide = 'player1';
    s.dropsiteActivation = { side: 'player1', done: [], dsId: null };
    s.scenarioData = {
      dropsites: [{ id: 'ds1', x: 10, y: 10, damage: 0, destroyed: false,
                    features: { 0: 'military_outpost' }, destroyedFeatures: [] }],
    };
    const tgtDef = shipDef({ id: 'player2:tgt', side: 'player2' });
    addGroup(s, tgtDef, [shipInstance({ x: 300, y: 300 })]);
    return s;
  }
  it('legal when all conditions are satisfied', () => {
    expect(isLegal(ffwState(), { type: 'fireFeatureWeapon', dsId: 'ds1', fi: 0,
                                 targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(true);
  });
  it('legal in da phase', () => {
    expect(isLegal(ffwState({ phase: 'da' }), { type: 'fireFeatureWeapon', dsId: 'ds1', fi: 0,
                                                targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(true);
  });
  it('illegal when no daActiveSide or dropsiteActivation', () => {
    const s = ffwState();
    s.daActiveSide = null;
    s.dropsiteActivation = null;
    expect(isLegal(s, { type: 'fireFeatureWeapon', dsId: 'ds1', fi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when acting side does not match the DA active side', () => {
    expect(isLegal(ffwState(), { type: 'fireFeatureWeapon', dsId: 'ds1', fi: 0,
                                 targetGid: 'player2:tgt', targetSi: 0 }, 'player2')).toBe(false);
  });
  it('illegal when the feature index is invalid', () => {
    expect(isLegal(ffwState(), { type: 'fireFeatureWeapon', dsId: 'ds1', fi: 99,
                                 targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the feature is already destroyed', () => {
    const s = ffwState();
    s.scenarioData.dropsites[0].destroyedFeatures = [0];
    expect(isLegal(s, { type: 'fireFeatureWeapon', dsId: 'ds1', fi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(false);
  });
  it('illegal when the target ship is destroyed', () => {
    const s = ffwState();
    s.groups['player2:tgt'].ships[0].destroyed = true;
    expect(isLegal(s, { type: 'fireFeatureWeapon', dsId: 'ds1', fi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(false);
  });
  it('illegal outside play and da phases', () => {
    const s = ffwState({ phase: 'deploy' });
    expect(isLegal(s, { type: 'fireFeatureWeapon', dsId: 'ds1', fi: 0,
                        targetGid: 'player2:tgt', targetSi: 0 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyShipOrder
// ---------------------------------------------------------------------------

describe('isLegal — applyShipOrder', () => {
  function networkState() {
    const s = makeState();
    s.phase = 'play';
    s.round = 2;
    s.activeSide = 'player1';
    // openNetwork = true enables per-ship orders; deployedRound < round puts it in network
    const def = shipDef({ id: 'player1:net', side: 'player1', openNetwork: true });
    addGroup(s, def, [shipInstance({ deployedRound: 1 })]);
    return s;
  }
  it('legal when ship is in network and order is valid', () => {
    expect(isLegal(networkState(), { type: 'applyShipOrder', gid: 'player1:net', si: 0, order: 'WF' }, 'player1')).toBe(true);
  });
  it('illegal when def.openNetwork is false', () => {
    const s = networkState();
    s.activeFleets.player1[0].openNetwork = false;
    expect(isLegal(s, { type: 'applyShipOrder', gid: 'player1:net', si: 0, order: 'WF' }, 'player1')).toBe(false);
  });
  it('illegal when ship has not yet been deployed long enough (deployedRound >= round)', () => {
    const s = networkState();
    s.groups['player1:net'].ships[0].deployedRound = 2; // same as round — not < round
    expect(isLegal(s, { type: 'applyShipOrder', gid: 'player1:net', si: 0, order: 'WF' }, 'player1')).toBe(false);
  });
  it('illegal with an invalid order key', () => {
    expect(isLegal(networkState(), { type: 'applyShipOrder', gid: 'player1:net', si: 0, order: 'ZZ' }, 'player1')).toBe(false);
  });
  it('illegal when group is activated', () => {
    const s = networkState();
    s.groups['player1:net'].activated = true;
    expect(isLegal(s, { type: 'applyShipOrder', gid: 'player1:net', si: 0, order: 'WF' }, 'player1')).toBe(false);
  });
  it('illegal for wrong side', () => {
    expect(isLegal(networkState(), { type: 'applyShipOrder', gid: 'player1:net', si: 0, order: 'WF' }, 'player2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lockBombardmentTarget
// ---------------------------------------------------------------------------

describe('isLegal — lockBombardmentTarget', () => {
  function bombardState() {
    const s = makeState();
    s.phase = 'play';
    s.activeSide = 'player1';
    const bombWeapon = weapon({ arc: 'ALL', special: 'Bombardment', att: 3, lock: '4+', dmg: 2 });
    const def = shipDef({ id: 'player1:bom', side: 'player1', scan: 20, weapons: [bombWeapon] });
    addGroup(s, def, [shipInstance({ x: 200, y: 200 })]);
    s.scenarioData = {
      dropsites: [{ id: 'ds1', x: 10, y: 10, damage: 0, destroyed: false }],
    };
    return s;
  }
  it('legal for a bombardment weapon with dropsite in arc and scan range', () => {
    // ship at (200,200), dropsite at (120,120)px → ~113px < 240px scan range
    expect(isLegal(bombardState(), { type: 'lockBombardmentTarget', gid: 'player1:bom', si: 0, wi: 0, dsId: 'ds1' }, 'player1')).toBe(true);
  });
  it('illegal for a weapon without the Bombardment special rule', () => {
    const s = bombardState();
    s.activeFleets.player1[0].weapons[0].special = 'Close Action';
    expect(isLegal(s, { type: 'lockBombardmentTarget', gid: 'player1:bom', si: 0, wi: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal when attackModal is open', () => {
    const s = bombardState();
    s.attackModal = { step: 'intro' };
    expect(isLegal(s, { type: 'lockBombardmentTarget', gid: 'player1:bom', si: 0, wi: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal when ship is in atmosphere layer (not orbit)', () => {
    const s = bombardState();
    s.groups['player1:bom'].ships[0].layer = 'atmo';
    expect(isLegal(s, { type: 'lockBombardmentTarget', gid: 'player1:bom', si: 0, wi: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
  it('illegal for an unknown dropsite', () => {
    expect(isLegal(bombardState(), { type: 'lockBombardmentTarget', gid: 'player1:bom', si: 0, wi: 0, dsId: 'ghost' }, 'player1')).toBe(false);
  });
  it('illegal outside play phase', () => {
    const s = bombardState();
    s.phase = 'deploy';
    expect(isLegal(s, { type: 'lockBombardmentTarget', gid: 'player1:bom', si: 0, wi: 0, dsId: 'ds1' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveBombardCollateral
// ---------------------------------------------------------------------------

describe('isLegal — resolveBombardCollateral', () => {
  function collateralState() {
    const s = makeState();
    s.phase = 'play';
    s.attackModal = {
      step: 'bombardCollateral',
      bombardCollateralQueue: [{ side: 'player1', dsId: 'ds1' }],
    };
    s.scenarioData = {
      dropsites: [{ id: 'ds1', x: 10, y: 10, damage: 0, destroyed: false,
                    battalions: { ground: { player1: 2, player2: 1 } } }],
    };
    return s;
  }
  it('legal when queue head matches and battalions exist at the location', () => {
    expect(isLegal(collateralState(), { type: 'resolveBombardCollateral', dsId: 'ds1', loc: 'ground' }, 'player1')).toBe(true);
  });
  it('illegal when modal step is not bombardCollateral', () => {
    const s = collateralState();
    s.attackModal.step = 'hit';
    expect(isLegal(s, { type: 'resolveBombardCollateral', dsId: 'ds1', loc: 'ground' }, 'player1')).toBe(false);
  });
  it('illegal when the queue is empty', () => {
    const s = collateralState();
    s.attackModal.bombardCollateralQueue = [];
    expect(isLegal(s, { type: 'resolveBombardCollateral', dsId: 'ds1', loc: 'ground' }, 'player1')).toBe(false);
  });
  it('illegal when intent.dsId does not match the queue head', () => {
    expect(isLegal(collateralState(), { type: 'resolveBombardCollateral', dsId: 'other', loc: 'ground' }, 'player1')).toBe(false);
  });
  it('illegal when acting side does not match the queue head side', () => {
    expect(isLegal(collateralState(), { type: 'resolveBombardCollateral', dsId: 'ds1', loc: 'ground' }, 'player2')).toBe(false);
  });
  it('illegal when the location has no friendly battalions', () => {
    const s = collateralState();
    s.scenarioData.dropsites[0].battalions.ground.player1 = 0;
    expect(isLegal(s, { type: 'resolveBombardCollateral', dsId: 'ds1', loc: 'ground' }, 'player1')).toBe(false);
  });
  it('illegal without an attackModal', () => {
    const s = collateralState();
    s.attackModal = null;
    expect(isLegal(s, { type: 'resolveBombardCollateral', dsId: 'ds1', loc: 'ground' }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('isLegal — bulk play/deploy passthrough intents', () => {
  const types = ['assetResetMove', 'skipBattalionCombat', 'resolveBoarding',
                 'startBattalionCombat', 'bcPickDropsite', 'bcAssignGround',
                 'bcSkipAssign', 'bcToDestroy', 'bcFinish', 'daDestroyFeature'];
  for (const type of types) {
    it(`${type}: legal in play phase`, () => {
      expect(isLegal(playState(), { type }, 'player1')).toBe(true);
    });
    it(`${type}: legal in deploy phase`, () => {
      const s = makeState();
      s.phase = 'deploy';
      expect(isLegal(s, { type }, 'player1')).toBe(true);
    });
    it(`${type}: illegal outside play and deploy`, () => {
      const s = makeState();
      s.phase = 'setup'; // makeState defaults to 'play'; must override explicitly
      expect(isLegal(s, { type }, 'player1')).toBe(false);
    });
  }
});
