/**
 * Combat engine unit tests.
 *
 * Covers: hit rolling, lock modifiers, save rolling, save modifiers
 * (Scald, Burnthrough, Reave), AP/fighter re-roll mutual exclusion,
 * penetrator, Close Action, shields.
 *
 * All dice are deterministic via seqRng/fixedRng.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { rollHits, rollSaves, attackReroll, attackFighterReroll,
         parseWeaponSpecials } from '../../src/engine/mutators.js';
import { makeState, seqRng, fixedRng, addGroup,
         shipDef, shipInstance, weapon, shot, makeModal } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup({ attackerSpec = {}, defenderSpec = {}, weaponSpec = {},
                 defenderShips = null } = {}) {
  const state = makeState();

  const atkDef = shipDef({ id: 'player1:atk', side: 'player1',
                            hull: 6, ks: '5+', es: '6+', ...attackerSpec });
  const defDef = shipDef({ id: 'player2:def', side: 'player2',
                            hull: 6, ks: '5+', es: '6+', ...defenderSpec });

  addGroup(state, atkDef, [shipInstance({ hull: atkDef.hull })]);
  addGroup(state, defDef, defenderShips ?? [shipInstance({ hull: defDef.hull })]);

  const w = weapon({ ...weaponSpec });
  const M = makeModal('player1:atk', [shot('player2:def', 0, w)]);
  state.attackModal = M;

  return { state, M, atkDef, defDef };
}

// ---------------------------------------------------------------------------
// 1. Hit rolling
// ---------------------------------------------------------------------------

describe('rollHits', () => {
  it('counts hits at the weapon lock value', () => {
    const { state, M } = setup({ weaponSpec: { att: 4, lock: '4+', type: 'K', special: '' } });
    rollHits(state, seqRng(4, 3, 5, 6), M);          // 4,5,6 = hits; 3 = miss; 6 = crit (lock+2=6)
    expect(M.hitResult.hits).toBe(3);
    expect(M.hitResult.crits).toBe(1);               // 6 is lock(4)+critMargin(2) = crit
    expect(M.hitResult.dice).toHaveLength(4);
  });

  it('marks criticals (lock + 2)', () => {
    // lock 4+ → crits on 6+
    const { state, M } = setup({ weaponSpec: { att: 3, lock: '4+', special: '' } });
    rollHits(state, seqRng(6, 5, 4), M);
    expect(M.hitResult.crits).toBe(1);
    expect(M.hitResult.hits).toBe(3);
  });

  it('no hits below lock', () => {
    const { state, M } = setup({ weaponSpec: { att: 3, lock: '5+', special: '' } });
    rollHits(state, fixedRng(4), M);                  // all 4s — miss vs 5+
    expect(M.hitResult.hits).toBe(0);
  });

  it('atmosphere forces 6-only hits when attacker is in atmosphere targeting orbit', () => {
    // Engine rule: attacker in atmo → orbit = forceSix (line 2081 mutators.js)
    // (orbit attacker → atmo target only adds +1 lock, not forceSix)
    const { state, M } = setup({ weaponSpec: { att: 4, lock: '3+', special: '' } });
    state.groups['player1:atk'].ships[0].layer = 'atmosphere';
    state.groups['player2:def'].ships[0].layer = 'orbit';
    rollHits(state, seqRng(5, 4, 6, 3), M);           // only 6 hits in forceSix mode
    expect(M.hitResult.hits).toBe(1);
    expect(M.hitResult.forceSix).toBe(true);
  });

  it('orbit attacker → atmosphere target: lock worsened by 1, not forceSix', () => {
    // Engine adds +1 lock (harder to hit), does NOT set forceSix
    const { state, M } = setup({ weaponSpec: { att: 3, lock: '3+', special: '' } });
    state.groups['player2:def'].ships[0].layer = 'atmosphere';
    rollHits(state, seqRng(3, 4, 5), M);              // lock becomes 4+; 3 misses, 4 and 5 hit
    expect(M.hitResult.hits).toBe(2);
    expect(M.hitResult.forceSix).toBe(false);
    expect(M.hitResult.lock).toBe(4);                 // worsened by 1
  });

  it('Mauler: uses target save as lock value', () => {
    // target KS 4+ → Mauler lock becomes 4
    const { state, M } = setup({
      defenderSpec: { ks: '4+' },
      weaponSpec: { att: 3, lock: '6+', special: 'Mauler', type: 'K' },
    });
    rollHits(state, seqRng(4, 3, 5), M);              // 4,5 hit vs mauler-lock 4
    expect(M.hitResult.hits).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Save rolling — base saves
// ---------------------------------------------------------------------------

describe('rollSaves - base', () => {
  it('saves reduce unsaved hits', () => {
    const { state, M } = setup({ defenderSpec: { ks: '4+' } });
    M.hitResult = { hits: 3, crits: 0, lock: 4,
                    dice: [{ r:5,isHit:true,isCrit:false },
                           { r:4,isHit:true,isCrit:false },
                           { r:6,isHit:true,isCrit:false }] };
    rollSaves(state, seqRng(4, 3, 2), M);             // 4 saves, 3 fails, 2 fails → 1 saved
    expect(M.saveResult.unsaved).toBe(2);
  });

  it('no save for Core damage without shields', () => {
    const { state, M } = setup({
      defenderSpec: { ks: '5+', es: '6+' },
      weaponSpec: { att: 2, lock: '4+', dmg: 1, type: 'C', special: 'Penetrator' },
    });
    M.hitResult = { hits: 2, crits: 0, lock: 4,
                    dice: [{ r:5,isHit:true,isCrit:false },
                           { r:4,isHit:true,isCrit:false }] };
    rollSaves(state, fixedRng(1), M);                 // dice irrelevant — Core has no save
    expect(M.saveResult.unsaved).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Save modifiers
// ---------------------------------------------------------------------------

describe('parseWeaponSpecials', () => {
  it('parses Scald-2', () => {
    expect(parseWeaponSpecials({ special: 'Scald-2' }).scald).toBe(2);
  });
  it('parses Burnthrough-1', () => {
    expect(parseWeaponSpecials({ special: 'Burnthrough-1' }).burnthrough).toBe(1);
  });
  it('parses Reave-1', () => {
    expect(parseWeaponSpecials({ special: 'Reave-1' }).reave).toBe(1);
  });
  it('parses Penetrator', () => {
    expect(parseWeaponSpecials({ special: 'Penetrator' }).penetrator).toBe(true);
  });
  it('parses Mauler', () => {
    expect(parseWeaponSpecials({ special: 'Mauler' }).mauler).toBe(true);
  });
  it('parses Flash-2', () => {
    expect(parseWeaponSpecials({ special: 'Flash-2' }).flash).toBe(2);
  });
  it('parses combined specials', () => {
    const sp = parseWeaponSpecials({ special: 'Burnthrough-1, Scald-2, Flash-3' });
    expect(sp.burnthrough).toBe(1);
    expect(sp.scald).toBe(2);
    expect(sp.flash).toBe(3);
  });
});

describe('rollSaves - Scald', () => {
  // Scald-X: worsen save by X for ALL hits (applied before rolling)
  it('Scald worsens save value by X', () => {
    const { state, M } = setup({
      defenderSpec: { ks: '4+' },                     // save normally 4
      weaponSpec: { att: 2, lock: '3+', type: 'K', special: 'Scald-2' },
    });
    M.hitResult = { hits: 2, crits: 0, lock: 3,
                    dice: [{ r:4,isHit:true,isCrit:false },
                           { r:5,isHit:true,isCrit:false }] };
    // Scald-2 → save becomes 4+2 = 6+ required
    rollSaves(state, seqRng(5, 6), M);                // 5 fails vs 6+; 6 saves
    expect(M.saveResult.unsaved).toBe(1);
    // Verify the effective save recorded
    const modSv = M.saveResult.primDice[0].sv;
    expect(modSv).toBe(6);                            // 4+2
  });
});

describe('rollSaves - Burnthrough', () => {
  // Burnthrough-X: worsens ALL saves by X × numCrits (applied uniformly, not per-hit).
  // Engine: burnReduce = burnthrough × hr.crits → applied to every save die.
  it('Burnthrough worsens ALL saves by (X × crits)', () => {
    const { state, M } = setup({
      defenderSpec: { ks: '4+' },
      weaponSpec: { att: 2, lock: '4+', type: 'K', special: 'Burnthrough-2' },
    });
    // 1 crit → burnReduce = 2×1 = 2; all saves worsened by 2: 4+ becomes 6+
    M.hitResult = { hits: 2, crits: 1, lock: 4,
                    dice: [{ r:6,isHit:true,isCrit:true  },
                           { r:4,isHit:true,isCrit:false }] };
    rollSaves(state, seqRng(5, 4), M);
    // Both hits have save 4+2=6+; roll 5 → miss, roll 4 → miss → both unsaved
    expect(M.saveResult.unsaved).toBe(2);
    expect(M.saveResult.primDice[0].sv).toBe(6);      // worsened for all dice
  });

  it('Burnthrough with 0 crits: no save worsening', () => {
    const { state, M } = setup({
      defenderSpec: { ks: '4+' },
      weaponSpec: { att: 2, lock: '4+', type: 'K', special: 'Burnthrough-2' },
    });
    // 0 crits → burnReduce = 2×0 = 0; save stays at 4+
    M.hitResult = { hits: 2, crits: 0, lock: 4,
                    dice: [{ r:4,isHit:true,isCrit:false },
                           { r:5,isHit:true,isCrit:false }] };
    rollSaves(state, seqRng(4, 5), M);
    // save 4+; 4 saves, 5 saves → 0 unsaved
    expect(M.saveResult.unsaved).toBe(0);
  });
});

describe('rollSaves - Reave', () => {
  // Reave-X: worsen save by X on criticals only (same mechanic as Burnthrough for saves)
  it('Reave worsens save on crits only', () => {
    const { state, M } = setup({
      defenderSpec: { ks: '3+' },
      weaponSpec: { att: 2, lock: '4+', type: 'K', special: 'Reave-2' },
    });
    M.hitResult = { hits: 2, crits: 1, lock: 4,
                    dice: [{ r:6,isHit:true,isCrit:true  },
                           { r:4,isHit:true,isCrit:false }] };
    rollSaves(state, seqRng(4, 3), M);
    // crit → save 3+2=5+; roll 4 → miss  (4 < 5)
    // normal → save 3+; roll 3 → save
    expect(M.saveResult.unsaved).toBe(1);
  });
});

describe('rollSaves - Penetrator', () => {
  // Penetrator: crits count as Core damage (no save unless shielded)
  it('Penetrator crits bypass KS/ES saves', () => {
    const { state, M } = setup({
      defenderSpec: { ks: '2+', es: '2+' },           // excellent saves
      weaponSpec: { att: 2, lock: '4+', type: 'K', special: 'Penetrator' },
    });
    M.hitResult = { hits: 2, crits: 1, lock: 4,
                    dice: [{ r:6,isHit:true,isCrit:true  },
                           { r:4,isHit:true,isCrit:false }] };
    rollSaves(state, seqRng(6, 6), M);                // crit = core → no save die
    // One crit (Core, no save) + one K hit (2+ saves on 6) → 1 normal unsaved
    // Note: penetrator crit has sv=null → always unsaved
    const critHit = M.saveResult.hitsList.find(h => h.isCrit);
    expect(critHit.saved).toBe(false);                // Core, no save
  });
});

// ---------------------------------------------------------------------------
// 4. Re-roll mutual exclusion
// ---------------------------------------------------------------------------

describe('Re-roll mutual exclusion', () => {
  function setupWithSaveResult(failedDice = 2, extraFlags = {}) {
    const { state, M } = setup({
      defenderSpec: { ks: '4+' },
      weaponSpec: { att: 3, lock: '4+', type: 'K' },
    });
    M.hitResult = { hits: 3, crits: 0, lock: 4,
                    dice: [{r:4,isHit:true,isCrit:false},
                           {r:5,isHit:true,isCrit:false},
                           {r:6,isHit:true,isCrit:false}] };
    // Build a saveResult directly with some failed dice
    const allFail = () => ({ r: 2, sv: 4, ok: false });
    const allPass = () => ({ r: 5, sv: 4, ok: true  });
    const primDice = Array.from({ length: failedDice }, allFail)
                         .concat(Array.from({ length: 3 - failedDice }, allPass));
    M.saveResult = {
      primDice,
      hitsList: primDice.map(d => ({ isCrit:false, type:'K', sv:4, dmg:1, saved:d.ok, savedBy:null, noSaveDie:false })),
      backDice: [], backupVal: null, aegisDice: [], aegisY: 0,
      unsaved: failedDice, dmg: failedDice,
      rerolled: false, fighterRerolled: false,
      isBomberAtk: false, isCloseAction: false,
      flash: 0, crippling: false, penetrator: false, status: false, corruptor: 0,
      critDamaged: false,
      ...extraFlags,
    };
    return { state, M };
  }

  it('AP re-roll blocked after fighter re-roll', () => {
    const { state, M } = setupWithSaveResult(2, { fighterRerolled: true });
    const apBefore = state.planning.ap.player2;
    attackReroll(state, fixedRng(6), M, 'save');
    expect(state.planning.ap.player2).toBe(apBefore);  // AP unchanged — blocked
    expect(M.saveResult.rerolled).toBe(false);
  });

  it('Fighter re-roll blocked after AP re-roll', () => {
    const { state, M } = setupWithSaveResult(2, { rerolled: true });
    // Add a fake fighter wing
    const wingId = 'player2:fighter0';
    state.launchedAssets = [{ id: wingId, kind: 'fighter', count: 2, side: 'player2',
                               x: 200, y: 200, moved: false }];
    M.fighterSpend = { [wingId]: 1 };
    attackFighterReroll(state, fixedRng(6), M);
    expect(M.saveResult.fighterRerolled).toBe(false);  // blocked
    expect(state.launchedAssets[0].count).toBe(2);     // fighters not spent
  });

  it('AP re-roll works when no prior re-roll', () => {
    const { state, M } = setupWithSaveResult(2);
    state.planning.ap.player2 = 3;
    attackReroll(state, fixedRng(6), M, 'save');       // roll 6 = save vs 4+
    expect(M.saveResult.rerolled).toBe(true);
    expect(state.planning.ap.player2).toBe(1);         // spent 2 AP
  });

  it('Fighter re-roll works when no prior re-roll', () => {
    const { state, M } = setupWithSaveResult(2, { isCloseAction: true });
    const wingId = 'player2:fighter0';
    state.launchedAssets = [{ id: wingId, kind: 'fighter', count: 3, side: 'player2',
                               x: 200, y: 200, moved: false }];
    M.fighterSpend = { [wingId]: 2 };
    attackFighterReroll(state, fixedRng(6), M);
    expect(M.saveResult.fighterRerolled).toBe(true);
    expect(state.launchedAssets[0].count).toBe(1);     // spent 2 fighters
  });
});

// ---------------------------------------------------------------------------
// 5. Calibre lock modifier
// ---------------------------------------------------------------------------

describe('rollHits - Calibre', () => {
  it('Calibre-H: IMPROVES lock by 1 vs Heavy (easier to hit)', () => {
    // Engine: Calibre-X does lock = Math.max(2, lock - 1) vs matching tonnage
    // lock 4+ against Heavy → becomes 3+ (better)
    const { state, M } = setup({
      defenderSpec: { tonnage: 'H' },
      weaponSpec: { att: 3, lock: '4+', special: 'Calibre-H', type: 'K' },
    });
    rollHits(state, seqRng(3, 4, 5), M);              // lock becomes 3+; all 3+ hit
    expect(M.hitResult.hits).toBe(3);
    expect(M.hitResult.lock).toBe(3);                 // improved by 1
  });

  it('Calibre-H: no bonus vs non-Heavy tonnage', () => {
    const { state, M } = setup({
      defenderSpec: { tonnage: 'L' },
      weaponSpec: { att: 3, lock: '4+', special: 'Calibre-H', type: 'K' },
    });
    rollHits(state, seqRng(3, 4, 5), M);              // lock stays 4+; 3 misses
    expect(M.hitResult.hits).toBe(2);                  // only 4,5 hit
    expect(M.hitResult.lock).toBe(4);                 // unchanged
  });
});

// ---------------------------------------------------------------------------
// 6. Close Action
// ---------------------------------------------------------------------------

describe('rollSaves - Close Action', () => {
  it('Close Action uses KS for Kinetic saves (standard)', () => {
    const { state, M } = setup({
      defenderSpec: { ks: '4+', es: '2+' },
      weaponSpec: { att: 2, lock: '2+', type: 'K', special: 'Close Action' },
    });
    M.hitResult = { hits: 2, crits: 0, lock: 2,
                    dice: [{r:3,isHit:true,isCrit:false},{r:2,isHit:true,isCrit:false}] };
    rollSaves(state, seqRng(3, 5), M);
    // KS 4+: 3 misses, 5 saves → 1 unsaved
    expect(M.saveResult.unsaved).toBe(1);
  });
});
