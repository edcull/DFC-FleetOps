/**
 * End-of-activation atmosphere damage tests.
 *
 * A non-Descent ship that ends its activation in the atmosphere takes D3 hull
 * damage (2D3 for Colossal). The engine pauses on a confirmation report
 * (state.atmoDamage) before handing the activation to the next player; the
 * `confirmEndActivation` intent clears it and advances.
 *
 * All dice are deterministic via seqRng.
 */
import { describe, it, expect } from 'vitest';
import { finishActivation, confirmEndActivation } from '../../src/engine/mutators.js';
import { isLegal } from '../../src/engine/gating.js';
import { makeState, seqRng, addGroup, shipDef, shipInstance } from './helpers.js';

function baseState() {
  const state = makeState();
  state.activeSide = 'player1';
  return state;
}

describe('finishActivation — atmosphere damage', () => {
  it('non-Descent ship in atmosphere takes D3, pauses for confirmation, does not advance', () => {
    const state = baseState();
    addGroup(state, shipDef({ id: 'player1:a', side: 'player1', hull: 6 }),
             [shipInstance({ hull: 6, layer: 'atmosphere' })]);
    // Give player2 a pending activation so advancing would switch sides.
    addGroup(state, shipDef({ id: 'player2:b', side: 'player2', hull: 6 }),
             [shipInstance({ hull: 6 })]);
    state.groups['player1:a'].order = 'SR';

    finishActivation(state, seqRng(6), 'player1:a'); // d6 6 → D3 3

    expect(state.atmoDamage).toBeTruthy();
    expect(state.atmoDamage.side).toBe('player1');
    expect(state.atmoDamage.ships).toHaveLength(1);
    expect(state.atmoDamage.ships[0].total).toBe(3);
    expect(state.atmoDamage.ships[0].dice).toEqual([{ raw: 6, val: 3 }]);
    expect(state.groups['player1:a'].ships[0].hull).toBe(3);
    expect(state.groups['player1:a'].activated).toBe(true);
    // Activation is frozen on the finishing side until confirmed.
    expect(state.activeSide).toBe('player1');
  });

  it('freezes all other intents until the report is confirmed', () => {
    const state = baseState();
    addGroup(state, shipDef({ id: 'player1:a', side: 'player1', hull: 6 }),
             [shipInstance({ hull: 6, layer: 'atmosphere' })]);
    addGroup(state, shipDef({ id: 'player2:b', side: 'player2', hull: 6 }),
             [shipInstance({ hull: 6 })]);
    state.groups['player1:a'].order = 'SR';
    finishActivation(state, seqRng(6), 'player1:a');

    // Nothing but the confirmation is legal while the report is up.
    expect(isLegal(state, { type: 'pass' }, 'player1')).toBe(false);
    expect(isLegal(state, { type: 'endRound' }, 'player1')).toBe(false);
    // Only the owning side may confirm.
    expect(isLegal(state, { type: 'confirmEndActivation' }, 'player1')).toBe(true);
    expect(isLegal(state, { type: 'confirmEndActivation' }, 'player2')).toBe(false);
  });

  it('confirmEndActivation clears the report and advances to the opponent', () => {
    const state = baseState();
    addGroup(state, shipDef({ id: 'player1:a', side: 'player1', hull: 6 }),
             [shipInstance({ hull: 6, layer: 'atmosphere' })]);
    addGroup(state, shipDef({ id: 'player2:b', side: 'player2', hull: 6 }),
             [shipInstance({ hull: 6 })]);
    state.groups['player1:a'].order = 'SR';
    finishActivation(state, seqRng(6), 'player1:a');

    confirmEndActivation(state);

    expect(state.atmoDamage).toBeNull();
    expect(state.activeSide).toBe('player2');
  });

  it('Descent ship in atmosphere takes no damage and advances immediately', () => {
    const state = baseState();
    addGroup(state, shipDef({ id: 'player1:a', side: 'player1', hull: 6, special: 'Descent' }),
             [shipInstance({ hull: 6, layer: 'atmosphere' })]);
    addGroup(state, shipDef({ id: 'player2:b', side: 'player2', hull: 6 }),
             [shipInstance({ hull: 6 })]);
    state.groups['player1:a'].order = 'SR';

    finishActivation(state, seqRng(6), 'player1:a');

    expect(state.atmoDamage).toBeFalsy();
    expect(state.groups['player1:a'].ships[0].hull).toBe(6);
    expect(state.activeSide).toBe('player2');
  });

  it('orbit ship takes no atmosphere damage', () => {
    const state = baseState();
    addGroup(state, shipDef({ id: 'player1:a', side: 'player1', hull: 6 }),
             [shipInstance({ hull: 6, layer: 'orbit' })]);
    state.groups['player1:a'].order = 'SR';

    finishActivation(state, seqRng(6), 'player1:a');

    expect(state.atmoDamage).toBeFalsy();
    expect(state.groups['player1:a'].ships[0].hull).toBe(6);
  });

  it('Colossal rolls 2D3 in the atmosphere', () => {
    const state = baseState();
    addGroup(state, shipDef({ id: 'player1:a', side: 'player1', hull: 10, tonnage: 'C' }),
             [shipInstance({ hull: 10, layer: 'atmosphere' })]);
    state.groups['player1:a'].order = 'SR';

    finishActivation(state, seqRng(6, 6), 'player1:a'); // 2D3 = 3 + 3 = 6

    expect(state.atmoDamage.ships[0].dice).toHaveLength(2);
    expect(state.atmoDamage.ships[0].total).toBe(6);
    expect(state.groups['player1:a'].ships[0].hull).toBe(4);
    expect(state.atmoDamage.ships[0].destroyed).toBe(false);
  });

  it('reports destruction when atmosphere damage drops hull to zero', () => {
    const state = baseState();
    addGroup(state, shipDef({ id: 'player1:a', side: 'player1', hull: 2 }),
             [shipInstance({ hull: 2, layer: 'atmosphere' })]);
    state.groups['player1:a'].order = 'SR';

    finishActivation(state, seqRng(6), 'player1:a'); // D3 3 ≥ 2 hull

    expect(state.atmoDamage.ships[0].destroyed).toBe(true);
    expect(state.atmoDamage.ships[0].hullAfter).toBe(0);
    expect(state.groups['player1:a'].ships[0].destroyed).toBe(true);
  });
});
