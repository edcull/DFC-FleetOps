/**
 * End-of-activation hazard damage (atmosphere / orbital decay / Expansive
 * Atmosphere): finishActivation rolls the damage, pauses on a confirmation
 * report (state.atmoDamage) that freezes all other intents, and
 * confirmEndActivation clears it and hands the activation to the next player.
 */
import { describe, it, expect } from 'vitest';
import { finishActivation, confirmEndActivation } from '../../src/engine/mutators.js';
import { isLegal } from '../../src/engine/gating.js';
import { makeState, seqRng, addGroup, shipDef, shipInstance } from './helpers.js';

function twoSides(atkSpec = {}, atkShip = {}) {
  const state = makeState();
  state.activeSide = 'player1';
  addGroup(state, shipDef({ id: 'player1:a', side: 'player1', hull: 6, ...atkSpec }),
           [shipInstance({ hull: 6, ...atkShip })]);
  // Give player2 a pending activation so advancing would switch sides.
  addGroup(state, shipDef({ id: 'player2:b', side: 'player2', hull: 6 }),
           [shipInstance({ hull: 6 })]);
  state.groups['player1:a'].order = 'SR';
  return state;
}

describe('finishActivation — end-of-activation hazard damage', () => {
  it('non-Descent ship in atmosphere takes D3, freezes play, and confirm advances', () => {
    const state = twoSides({}, { layer: 'atmosphere' });
    finishActivation(state, seqRng(6), 'player1:a'); // d6 6 → D3 3

    // Damage applied and reported, activation paused on the finishing side.
    expect(state.groups['player1:a'].ships[0].hull).toBe(3);
    expect(state.atmoDamage.side).toBe('player1');
    expect(state.atmoDamage.ships[0].total).toBe(3);
    expect(state.atmoDamage.ships[0].sources[0].label).toBe('Atmosphere');
    expect(state.activeSide).toBe('player1');

    // Only the owning side's confirmation is legal while the report is up.
    expect(isLegal(state, { type: 'pass' }, 'player1')).toBe(false);
    expect(isLegal(state, { type: 'confirmEndActivation' }, 'player2')).toBe(false);
    expect(isLegal(state, { type: 'confirmEndActivation' }, 'player1')).toBe(true);

    confirmEndActivation(state);
    expect(state.atmoDamage).toBeNull();
    expect(state.activeSide).toBe('player2');
  });

  it('Descent / orbit ships take no damage and advance immediately', () => {
    const descent = twoSides({ special: 'Descent' }, { layer: 'atmosphere' });
    finishActivation(descent, seqRng(6), 'player1:a');
    expect(descent.atmoDamage).toBeFalsy();
    expect(descent.groups['player1:a'].ships[0].hull).toBe(6);
    expect(descent.activeSide).toBe('player2');

    const orbit = twoSides({}, { layer: 'orbit' });
    finishActivation(orbit, seqRng(6), 'player1:a');
    expect(orbit.atmoDamage).toBeFalsy();
    expect(orbit.groups['player1:a'].ships[0].hull).toBe(6);
  });
});
