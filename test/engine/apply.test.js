/**
 * Intent → apply() integration tests.
 *
 * CLAUDE.md invariant: "Every apply() case must have a matching isLegal case."
 * These tests run the full authoritative path — gate the intent with isLegal,
 * then apply() it and assert the resulting state change. They also confirm
 * apply() is a no-op for intents the gate would have rejected.
 */
import { describe, it, expect } from 'vitest';
import { apply } from '../../src/engine/mutators.js';
import { isLegal } from '../../src/engine/gating.js';
import { makeState, shipDef, shipInstance, addGroup, seqRng } from './helpers.js';

function game({ activeSide = 'player1' } = {}) {
  const state = makeState();
  addGroup(state, shipDef({ id: 'player1:a', side: 'player1', thrust: 6, name: 'Alpha' }),
           [shipInstance({ x: 200, y: 200, heading: 0, hull: 6 })]);
  addGroup(state, shipDef({ id: 'player2:b', side: 'player2', thrust: 6, name: 'Beta' }),
           [shipInstance({ x: 400, y: 400, heading: 0, hull: 6 })]);
  state.activeSide = activeSide;
  return state;
}

// Convenience: assert legal, then apply.
function dispatch(state, intent, side, rng = seqRng(3)) {
  expect(isLegal(state, intent, side)).toBe(true);
  return apply(state, intent, rng);
}

describe('apply — adjustAP', () => {
  it('increments and clamps AP at zero', () => {
    const s = game();
    s.planning.ap.player1 = 2;
    dispatch(s, { type: 'adjustAP', side: 'player1', delta: 1 }, 'player1');
    expect(s.planning.ap.player1).toBe(3);
    dispatch(s, { type: 'adjustAP', side: 'player1', delta: -10 }, 'player1');
    expect(s.planning.ap.player1).toBe(0);    // clamped, never negative
  });
});

describe('apply — adjustSpike', () => {
  it('clamps spikes to the 0–4 range', () => {
    const s = game();
    s.groups['player1:a'].spikes = 4;
    dispatch(s, { type: 'adjustSpike', gid: 'player1:a', delta: 1 }, 'player1');
    expect(s.groups['player1:a'].spikes).toBe(4);   // capped
    dispatch(s, { type: 'adjustSpike', gid: 'player1:a', delta: -1 }, 'player1');
    expect(s.groups['player1:a'].spikes).toBe(3);
  });
});

describe('apply — adjustHull', () => {
  it('reduces hull and destroys at zero, then revives on repair', () => {
    const s = game();
    const ship = s.groups['player1:a'].ships[0];
    ship.hull = 1;
    dispatch(s, { type: 'adjustHull', gid: 'player1:a', si: 0, delta: -1 }, 'player1');
    expect(ship.hull).toBe(0);
    expect(ship.destroyed).toBe(true);
    // Healing back above zero clears the destroyed flag.
    dispatch(s, { type: 'adjustHull', gid: 'player1:a', si: 0, delta: 1 }, 'player1');
    expect(ship.hull).toBe(1);
    expect(ship.destroyed).toBe(false);
  });
  it('does not exceed maxHull', () => {
    const s = game();
    const ship = s.groups['player1:a'].ships[0];
    ship.hull = ship.maxHull;
    dispatch(s, { type: 'adjustHull', gid: 'player1:a', si: 0, delta: 1 }, 'player1');
    expect(ship.hull).toBe(ship.maxHull);
  });
});

describe('apply — applyOrder', () => {
  it('sets the group order and removes 2 spikes on General Quarters', () => {
    const s = game();
    s.groups['player1:a'].spikes = 3;
    dispatch(s, { type: 'applyOrder', gid: 'player1:a', order: 'GQ' }, 'player1');
    expect(s.groups['player1:a'].order).toBe('GQ');
    expect(s.groups['player1:a'].spikes).toBe(1);   // 3 − 2
  });
  it('Silent Running clears all spikes', () => {
    const s = game();
    s.groups['player1:a'].spikes = 4;
    dispatch(s, { type: 'applyOrder', gid: 'player1:a', order: 'SR' }, 'player1');
    expect(s.groups['player1:a'].spikes).toBe(0);
  });
});

describe('apply — pass', () => {
  it('spends a pass token and hands the turn to the opponent', () => {
    const s = game({ activeSide: 'player1' });
    s.planning.passTokens.player1 = 1;
    // give player2 something to do so the active side flips to them
    s.groups['player2:b'].ships[0].movedThisRound = false;
    dispatch(s, { type: 'pass' }, 'player1');
    expect(s.planning.passTokens.player1).toBe(0);
    expect(s.activeSide).toBe('player2');
  });
});

describe('apply — gate rejects then no-op', () => {
  it('an illegal moveShip is never applied (ship stays put)', () => {
    const s = game();
    s.groups['player1:a'].order = 'WF';
    const ship = s.groups['player1:a'].ships[0];
    const intent = { type: 'moveShip', gid: 'player1:a', si: 0, x: 900, y: 200 }; // far out of range
    expect(isLegal(s, intent, 'player1')).toBe(false);
    // commitMove independently validates the cone, so even a forced apply is a no-op.
    apply(s, intent, seqRng(3));
    expect(ship.x).toBe(200);
    expect(ship.y).toBe(200);
    expect(ship.movedThisRound).toBeFalsy();
  });
});
