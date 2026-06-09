/**
 * apply() mutation tests.
 *
 * Covers the state changes produced by each intent type, independent of
 * combat-modal internals (those live in combat.test.js).  Follows the
 * same dispatch() pattern as apply.test.js: gate with isLegal first so
 * every test also validates gate/mutator lockstep.
 */
import { describe, it, expect } from 'vitest';
import { apply, finishActivation, deployShip, commitMove,
         undoMove } from '../../src/engine/mutators.js';
import { isLegal } from '../../src/engine/gating.js';
import { makeState, shipDef, shipInstance, addGroup, weapon, seqRng } from './helpers.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Assert legal, then apply. Returns state for chaining. */
function dispatch(state, intent, side, rng = seqRng(3)) {
  expect(isLegal(state, intent, side)).toBe(true);
  return apply(state, intent, rng);
}

/** Two-group play state — player1 active, no order set. */
function game({ activeSide = 'player1', thrust = 6 } = {}) {
  const state = makeState();
  addGroup(state, shipDef({ id: 'player1:a', side: 'player1', thrust }),
           [shipInstance({ x: 200, y: 200, heading: 0 })]);
  addGroup(state, shipDef({ id: 'player2:b', side: 'player2', thrust }),
           [shipInstance({ x: 400, y: 400, heading: 0 })]);
  state.activeSide = activeSide;
  return state;
}

// ---------------------------------------------------------------------------
// moveShip
// ---------------------------------------------------------------------------

describe('apply — moveShip', () => {
  it('moves the ship, marks movedThisRound, and records the trail', () => {
    const s = game();
    dispatch(s, { type: 'applyOrder', gid: 'player1:a', order: 'WF' }, 'player1');
    const ship = s.groups['player1:a'].ships[0];
    const prevX = ship.x;

    dispatch(s, { type: 'moveShip', gid: 'player1:a', si: 0, x: 250, y: 200 }, 'player1');

    expect(ship.x).toBe(250);
    expect(ship.y).toBe(200);
    expect(ship.movedThisRound).toBe(true);
    // Move trail records previous position so undoMove can restore it.
    expect(s.groups['player1:a'].moveTrail.some(t => t.si === 0 && t.x === prevX)).toBe(true);
  });

  it('ship cannot be moved again after moving', () => {
    const s = game();
    dispatch(s, { type: 'applyOrder', gid: 'player1:a', order: 'WF' }, 'player1');
    dispatch(s, { type: 'moveShip', gid: 'player1:a', si: 0, x: 250, y: 200 }, 'player1');
    expect(isLegal(s, { type: 'moveShip', gid: 'player1:a', si: 0, x: 260, y: 200 }, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// undoMove
// ---------------------------------------------------------------------------

describe('apply — undoMove / undoMove direct', () => {
  it('undoMove restores the ship to its pre-move position', () => {
    const s = game();
    dispatch(s, { type: 'applyOrder', gid: 'player1:a', order: 'CC' }, 'player1');
    const ship = s.groups['player1:a'].ships[0];

    dispatch(s, { type: 'moveShip', gid: 'player1:a', si: 0, x: 230, y: 200 }, 'player1');
    expect(ship.x).toBe(230);
    expect(ship.movedThisRound).toBe(true);

    dispatch(s, { type: 'undoMove', gid: 'player1:a', si: 0 }, 'player1');
    expect(ship.x).toBe(200);
    expect(ship.y).toBe(200);
    expect(ship.movedThisRound).toBe(false);
  });

  it('undoMove exported function restores position directly', () => {
    const s = game();
    dispatch(s, { type: 'applyOrder', gid: 'player1:a', order: 'CC' }, 'player1');
    const ship = s.groups['player1:a'].ships[0];
    commitMove(s, seqRng(3), 'player1:a', 0, 230, 200);
    expect(ship.x).toBe(230);
    undoMove(s, 'player1:a', 0);
    expect(ship.x).toBe(200);
    expect(ship.movedThisRound).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cancelOrder
// ---------------------------------------------------------------------------

describe('apply — cancelOrder', () => {
  it('restores spikes to their pre-order value', () => {
    const s = game();
    s.groups['player1:a'].spikes = 3;
    dispatch(s, { type: 'applyOrder', gid: 'player1:a', order: 'SR' }, 'player1');
    // SR immediately clears spikes to 0 and saves snapshot with 3.
    expect(s.groups['player1:a'].spikes).toBe(0);

    dispatch(s, { type: 'cancelOrder', gid: 'player1:a' }, 'player1');
    expect(s.groups['player1:a'].spikes).toBe(3);
    expect(s.groups['player1:a'].order).toBeNull();
  });

  it('restores justArrived so a just-deployed Group can be UNDO-DEPLOYED again', () => {
    const s = game();
    const grp = s.groups['player1:a'];
    // Simulate a freshly deployed Group still inside the deploy-adjust window.
    grp.ships.forEach(sh => { sh.justArrived = true; });
    dispatch(s, { type: 'applyOrder', gid: 'player1:a', order: 'GQ' }, 'player1');
    // Taking an order closes the deploy-adjust window.
    expect(grp.ships.every(sh => sh.justArrived === false)).toBe(true);

    dispatch(s, { type: 'cancelOrder', gid: 'player1:a' }, 'player1');
    expect(grp.order).toBeNull();
    expect(grp.ships.every(sh => sh.justArrived === true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nominateLead
// ---------------------------------------------------------------------------

describe('apply — nominateLead', () => {
  it('sets the lead ship index', () => {
    const s = game();
    // Add a second ship so there's something to nominate as lead.
    s.groups['player1:a'].ships.push(shipInstance({ x: 220, y: 200, hull: 6 }));
    dispatch(s, { type: 'nominateLead', gid: 'player1:a', si: 1 }, 'player1');
    expect(s.groups['player1:a'].leadShipIdx).toBe(1);
  });

  it('clears the lead ship when si is null', () => {
    const s = game();
    s.groups['player1:a'].leadShipIdx = 0;
    dispatch(s, { type: 'nominateLead', gid: 'player1:a', si: null }, 'player1');
    expect(s.groups['player1:a'].leadShipIdx).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lockWeaponTarget / unlockWeapon
// ---------------------------------------------------------------------------

describe('apply — lockWeaponTarget + unlockWeapon', () => {
  function weaponGame() {
    const s = makeState();
    const atkDef = shipDef({ id: 'player1:atk', side: 'player1', scan: 20,
                             weapons: [weapon({ arc: 'ALL' })] });
    const tgtDef = shipDef({ id: 'player2:tgt', side: 'player2' });
    addGroup(s, atkDef, [shipInstance({ x: 200, y: 200 })]);
    addGroup(s, tgtDef, [shipInstance({ x: 240, y: 200 })]);
    s.activeSide = 'player1';
    return s;
  }

  it('lockWeaponTarget stores the target in weaponTargets', () => {
    const s = weaponGame();
    dispatch(s, { type: 'lockWeaponTarget', gid: 'player1:atk', si: 0, wi: 0,
                  targetGid: 'player2:tgt', targetSi: 0 }, 'player1');
    const wt = s.groups['player1:atk'].ships[0].weaponTargets;
    expect(wt[0]).toEqual({ gid: 'player2:tgt', si: 0 });
  });

  it('unlockWeapon removes the stored target', () => {
    const s = weaponGame();
    dispatch(s, { type: 'lockWeaponTarget', gid: 'player1:atk', si: 0, wi: 0,
                  targetGid: 'player2:tgt', targetSi: 0 }, 'player1');
    dispatch(s, { type: 'unlockWeapon', gid: 'player1:atk', si: 0, wi: 0 }, 'player1');
    const wt = s.groups['player1:atk'].ships[0].weaponTargets;
    expect(wt[0]).toBeUndefined();
  });

  it('lockWeaponTarget with volleySlot stores to an array slot', () => {
    const s = weaponGame();
    apply(s, { type: 'lockWeaponTarget', gid: 'player1:atk', si: 0, wi: 0,
               targetGid: 'player2:tgt', targetSi: 0, volleySlot: 1 }, seqRng(3));
    const wt = s.groups['player1:atk'].ships[0].weaponTargets[0];
    expect(Array.isArray(wt)).toBe(true);
    expect(wt[1]).toEqual({ gid: 'player2:tgt', si: 0 });
  });

  it('unlockWeapon with volleySlot removes only that slot, keeps others', () => {
    const s = weaponGame();
    const ship = s.groups['player1:atk'].ships[0];
    ship.weaponTargets = { 0: [{ gid: 'player2:tgt', si: 0 }, { gid: 'player2:tgt', si: 0 }] };
    apply(s, { type: 'unlockWeapon', gid: 'player1:atk', si: 0, wi: 0, volleySlot: 0 }, seqRng(3));
    expect(ship.weaponTargets[0][0]).toBeNull();
    expect(ship.weaponTargets[0][1]).not.toBeNull();
  });

  it('unlockWeapon deletes weaponTargets entry when all volley slots cleared', () => {
    const s = weaponGame();
    const ship = s.groups['player1:atk'].ships[0];
    ship.weaponTargets = { 0: [{ gid: 'player2:tgt', si: 0 }] };
    apply(s, { type: 'unlockWeapon', gid: 'player1:atk', si: 0, wi: 0, volleySlot: 0 }, seqRng(3));
    expect(ship.weaponTargets[0]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fireWeapons → attackModal creation
// ---------------------------------------------------------------------------

describe('apply — fireWeapons', () => {
  function firingGame() {
    const s = makeState();
    const atkDef = shipDef({ id: 'player1:atk', side: 'player1', scan: 20,
                             weapons: [weapon({ arc: 'ALL', att: 4, lock: '4+', dmg: 1, type: 'K' })] });
    const tgtDef = shipDef({ id: 'player2:tgt', side: 'player2' });
    addGroup(s, atkDef, [shipInstance({ x: 200, y: 200 })]);
    addGroup(s, tgtDef, [shipInstance({ x: 240, y: 200 })]);
    s.activeSide = 'player1';
    // Lock target first
    s.groups['player1:atk'].ships[0].weaponTargets = { 0: { gid: 'player2:tgt', si: 0 } };
    return s;
  }

  it('opens an attackModal with the locked target as a shot', () => {
    const s = firingGame();
    dispatch(s, { type: 'fireWeapons', gid: 'player1:atk' }, 'player1');
    expect(s.attackModal).not.toBeNull();
    expect(s.attackModal.shots.length).toBeGreaterThan(0);
    expect(s.attackModal.shots[0].targetGid).toBe('player2:tgt');
  });

  it('attackModal starts at intro step', () => {
    const s = firingGame();
    dispatch(s, { type: 'fireWeapons', gid: 'player1:atk' }, 'player1');
    expect(['intro', 'select']).toContain(s.attackModal.step);
  });

  it('attacker group is recorded in attackModal', () => {
    const s = firingGame();
    dispatch(s, { type: 'fireWeapons', gid: 'player1:atk' }, 'player1');
    expect(s.attackModal.attackerGid).toBe('player1:atk');
  });
});

// ---------------------------------------------------------------------------
// finishActivation (the exported function + via apply)
// ---------------------------------------------------------------------------

describe('finishActivation mutator', () => {
  function activationGame(order = 'WF', extra = {}) {
    const s = makeState();
    s.activeSide = 'player1';
    addGroup(s, shipDef({ id: 'player1:a', side: 'player1', hull: 6 }),
             [shipInstance({ hull: 6, ...extra })]);
    addGroup(s, shipDef({ id: 'player2:b', side: 'player2', hull: 6 }),
             [shipInstance({ hull: 6 })]);
    s.groups['player1:a'].order = order;
    return s;
  }

  it('marks the group as activated', () => {
    const s = activationGame('WF');
    finishActivation(s, seqRng(3), 'player1:a');
    expect(s.groups['player1:a'].activated).toBe(true);
  });

  it('WF order adds 2 spikes on activation', () => {
    const s = activationGame('WF');
    s.groups['player1:a'].spikes = 0;
    finishActivation(s, seqRng(3), 'player1:a');
    expect(s.groups['player1:a'].spikes).toBe(2);
  });

  it('CC order adds 1 spike on activation', () => {
    const s = activationGame('CC');
    s.groups['player1:a'].spikes = 0;
    finishActivation(s, seqRng(3), 'player1:a');
    expect(s.groups['player1:a'].spikes).toBe(1);
  });

  it('SR order does not add spikes', () => {
    const s = activationGame('SR');
    s.groups['player1:a'].spikes = 0;
    finishActivation(s, seqRng(3), 'player1:a');
    expect(s.groups['player1:a'].spikes).toBe(0);
  });

  it('advances activeSide to player2 when player2 still has unactivated groups', () => {
    const s = activationGame('WF');
    finishActivation(s, seqRng(3), 'player1:a');
    expect(s.activeSide).toBe('player2');
  });

  it('via apply() route also marks group activated', () => {
    const s = activationGame('WF');
    dispatch(s, { type: 'finishActivation', gid: 'player1:a' }, 'player1');
    expect(s.groups['player1:a'].activated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deployShip (the exported function)
// ---------------------------------------------------------------------------

describe('deployShip mutator', () => {
  it('places an off-table ship at the given coordinates', () => {
    const s = makeState();
    s.phase = 'deploy';
    const def = shipDef({ id: 'player1:a', side: 'player1' });
    addGroup(s, def, [shipInstance({ offTable: true })]);

    deployShip(s, 'player1:a', 0, 300, 300, 90);
    const ship = s.groups['player1:a'].ships[0];
    expect(ship.x).toBe(300);
    expect(ship.y).toBe(300);
    expect(ship.heading).toBe(90);
    expect(ship.offTable).toBe(false);
    expect(ship.deployedRound).toBe(s.round);
  });
});

// ---------------------------------------------------------------------------
// advanceRound
// ---------------------------------------------------------------------------

describe('apply — advanceRound', () => {
  // rollInitiative re-rolls on a tie; use distinct faces so the loop exits in one pass.
  const advRng = () => seqRng(3, 4);

  it('increments the round counter', () => {
    const s = game();
    s.round = 1;
    dispatch(s, { type: 'advanceRound' }, 'player1', advRng());
    expect(s.round).toBe(2);
  });

  it('resets per-round ship flags', () => {
    const s = game();
    s.round = 1;
    const ship = s.groups['player1:a'].ships[0];
    ship.movedThisRound = true;
    ship.firedThisActivation = true;
    ship.weaponTargets = { 0: { gid: 'player2:b', si: 0 } };
    dispatch(s, { type: 'advanceRound' }, 'player1', advRng());
    expect(ship.movedThisRound).toBe(false);
    expect(ship.firedThisActivation).toBe(false);
    expect(ship.weaponTargets).toEqual({});
  });

  it('resets per-round group flags', () => {
    const s = game();
    s.round = 1;
    s.groups['player1:a'].activated = true;
    s.groups['player1:a'].order = 'WF';
    dispatch(s, { type: 'advanceRound' }, 'player1', advRng());
    expect(s.groups['player1:a'].activated).toBe(false);
    expect(s.groups['player1:a'].order).toBeNull();
  });

  it('rolls new initiative for the next round', () => {
    const s = game();
    s.round = 1;
    dispatch(s, { type: 'advanceRound' }, 'player1', advRng());
    expect(s.initiative).not.toBeNull();
    expect(['player1', 'player2']).toContain(s.initiative.winner);
  });
});

// ---------------------------------------------------------------------------
// adjustOrbitalDecay
// ---------------------------------------------------------------------------

describe('apply — adjustOrbitalDecay', () => {
  it('adds a token', () => {
    const s = game();
    dispatch(s, { type: 'adjustOrbitalDecay', gid: 'player1:a', si: 0, delta: 1 }, 'player1');
    expect(s.groups['player1:a'].ships[0].orbitalDecayTokens).toBe(1);
  });

  it('removes a token when one exists', () => {
    const s = game();
    s.groups['player1:a'].ships[0].orbitalDecayTokens = 2;
    dispatch(s, { type: 'adjustOrbitalDecay', gid: 'player1:a', si: 0, delta: -1 }, 'player1');
    expect(s.groups['player1:a'].ships[0].orbitalDecayTokens).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// endRound
// ---------------------------------------------------------------------------

describe('apply — endRound', () => {
  it('opens dropsiteActivation when called by the active side', () => {
    const s = game({ activeSide: 'player1' });
    s.round = 1;
    dispatch(s, { type: 'endRound' }, 'player1');
    expect(s.dropsiteActivation).not.toBeNull();
    expect(s.round).toBe(1);
  });
});
