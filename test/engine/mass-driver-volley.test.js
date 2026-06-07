import { describe, it, expect } from 'vitest';
import { rollHits, apply, groupHasMassDriver } from '../../src/engine/mutators.js';
import { isLegal } from '../../src/engine/gating.js';
import { makeState, shipDef, shipInstance, addGroup, weapon, fixedRng } from './helpers.js';

const MD6400 = () => weapon({ name: 'UF-6400 Mass Driver Turrets', arc: 'F/S', att: 4, lock: '3+', dmg: 1, type: 'K', special: 'Critical-1' });
const MD4200 = () => weapon({ name: 'UF-4200 Mass Driver Turrets', arc: 'F/S', att: 4, lock: '4+', dmg: 1, type: 'K', special: 'Fusillade-2' });
const LASER   = () => weapon({ name: 'Cobra Heavy Laser', arc: 'FN', att: 4, lock: '3+', dmg: 1, type: 'E', special: 'Focused' });

function combatState(weapons) {
  const s = makeState();
  s.activeSide = 'player1';
  addGroup(s, shipDef({ id: 'player1:a', side: 'player1', faction: 'ucm', weapons }), [shipInstance({ x: 200, y: 200, heading: 0 })]);
  addGroup(s, shipDef({ id: 'player2:b', side: 'player2', hull: 6 }), [Object.assign(shipInstance({ x: 240, y: 200 }), { maxHull: 6, hull: 6 })]);
  return s;
}
function shotFor(w) {
  return { wi: 0, w: { ...w }, targetGid: 'player2:b', targetSi: 0, fusilladeBaked: true };
}

describe('Mass Driver Volley — Lock +1 in rollHits', () => {
  it('improves a Mass Driver weapon Lock by 1 when the volley is active', () => {
    const s = combatState([MD6400()]);
    const mk = (volley) => ({ attackerGid: 'player1:a', attackerSi: 0, bomber: false,
                              shots: [shotFor(MD6400())], shotIdx: 0, massDriverVolley: volley });
    const off = mk(false); rollHits(s, fixedRng(1), off);
    const on  = mk(true);  rollHits(s, fixedRng(1), on);
    expect(off.hitResult.lock).toBe(3);   // 3+
    expect(on.hitResult.lock).toBe(2);    // improved to 2+
  });

  it('does NOT affect non-Mass-Driver weapons', () => {
    const s = combatState([LASER()]);
    const M = { attackerGid: 'player1:a', attackerSi: 0, bomber: false,
                shots: [shotFor(LASER())], shotIdx: 0, massDriverVolley: true };
    rollHits(s, fixedRng(1), M);
    expect(M.hitResult.lock).toBe(3); // unchanged
  });
});

describe('setMassDriverVolley — apply + gating', () => {
  function openModal(s, weapons) {
    s.attackModal = { attackerGid: 'player1:a', attackerSi: 0, bomber: false,
                      shots: [shotFor(weapons[0])], shotIdx: 0, resolvedShots: [], hitResult: null };
  }

  it('spends 2 AP and flags the modal', () => {
    const s = combatState([MD6400()]);
    s.planning = { ap: { player1: 3, player2: 0 } };
    openModal(s, [MD6400()]);
    expect(isLegal(s, { type: 'setMassDriverVolley' }, 'player1')).toBe(true);
    apply(s, { type: 'setMassDriverVolley' }, fixedRng(1));
    expect(s.attackModal.massDriverVolley).toBe(true);
    expect(s.planning.ap.player1).toBe(1); // 3 − 2
  });

  it('is illegal with fewer than 2 AP', () => {
    const s = combatState([MD6400()]);
    s.planning = { ap: { player1: 1, player2: 0 } };
    openModal(s, [MD6400()]);
    expect(isLegal(s, { type: 'setMassDriverVolley' }, 'player1')).toBe(false);
  });

  it('is illegal for a group with no Mass Driver weapon', () => {
    const s = combatState([LASER()]);
    s.planning = { ap: { player1: 3, player2: 0 } };
    openModal(s, [LASER()]);
    expect(isLegal(s, { type: 'setMassDriverVolley' }, 'player1')).toBe(false);
  });

  it('is illegal once hits have been rolled', () => {
    const s = combatState([MD6400()]);
    s.planning = { ap: { player1: 3, player2: 0 } };
    openModal(s, [MD6400()]);
    s.attackModal.hitResult = { dice: [], hits: 0, crits: 0, lock: 3 };
    expect(isLegal(s, { type: 'setMassDriverVolley' }, 'player1')).toBe(false);
  });

  it('is illegal for the non-attacking side', () => {
    const s = combatState([MD6400()]);
    s.planning = { ap: { player1: 3, player2: 3 } };
    openModal(s, [MD6400()]);
    expect(isLegal(s, { type: 'setMassDriverVolley' }, 'player2')).toBe(false);
  });
});

describe('groupHasMassDriver', () => {
  it('detects Mass Driver weapons by name', () => {
    expect(groupHasMassDriver({ weapons: [MD4200()] })).toBe(true);
    expect(groupHasMassDriver({ weapons: [LASER()] })).toBe(false);
    expect(groupHasMassDriver({ weapons: [] })).toBe(false);
  });
});
