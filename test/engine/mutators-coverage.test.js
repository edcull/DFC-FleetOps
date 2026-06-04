/**
 * Coverage tests for src/engine/mutators.js
 *
 * Focuses on pure helpers and simple apply() cases that are untested by the
 * other mutator test files (mutators.test.js, combat.test.js, etc.).
 */
import { describe, it, expect } from 'vitest';
import { makeState, shipDef, shipInstance, addGroup, seqRng, weapon } from './helpers.js';
import {
  // Geometry
  headingVec, headingToward, angleDelta, clampHeading, arcWedges,
  pointInWeaponArc,
  // Weapon helpers
  lockVal, saveVal, isCapital, explosionRangeIn, spikeCap,
  addGroupSpikes, addShipSpikes,
  effectiveScan, effectiveMaxMovePx, fireLimit,
  weaponGroupKey, linkedPartners, targetKey,
  parseWeaponSpecials, hasShields, shieldSaveVal, baseSaveForType,
  // Score / log
  shipPoints, logEvent, awardVP, recordKill,
  dropsiteSizeKey, objectiveForSide, objAny,
  // Dropsite / battalion
  dsBattalions, dsSideBattalions, dsEnemyBattalions,
  dropsiteContested, dropsiteController, transportValue,
  // Misc
  coherencyInches, kindsForAssetType, targetingRangePx,
  // Crippling
  crippleFor, makeCrippleRoll, rollCrippleEffect,
  makeExplosionRoll, rollExplosionEffect,
  // Deployment
  approachFor, canDeployNow, isGroupUndeployed,
  allShipsDeployed, nextUndeployedShipIdx,
  // Turn management
  admiralAlive, advanceActiveSide, anyRepairWork,
  // Apply dispatcher (for inline cases)
  apply,
  applyGiveInitiative, applyBeginActivation, passActivation,
} from '../../src/engine/mutators.js';

const rng = seqRng(3);

// ── Geometry helpers ──────────────────────────────────────────────────────────

describe('headingVec', () => {
  it('heading 0 points right (+x)', () => {
    const v = headingVec(0);
    expect(v.x).toBeCloseTo(1); expect(v.y).toBeCloseTo(0);
  });
  it('heading 90 points down (+y)', () => {
    const v = headingVec(90);
    expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(1);
  });
  it('heading 180 points left (−x)', () => {
    const v = headingVec(180);
    expect(v.x).toBeCloseTo(-1); expect(v.y).toBeCloseTo(0);
  });
  it('heading 270 points up (−y)', () => {
    const v = headingVec(270);
    expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(-1);
  });
});

describe('headingToward', () => {
  it('returns 0 for a point directly to the right', () => {
    expect(headingToward(0, 0, 100, 0)).toBeCloseTo(0);
  });
  it('returns 90 for a point directly below', () => {
    expect(headingToward(0, 0, 0, 100)).toBeCloseTo(90);
  });
  it('returns −90 for a point directly above', () => {
    expect(headingToward(0, 0, 0, -100)).toBeCloseTo(-90);
  });
});

describe('angleDelta', () => {
  it('positive delta for clockwise turn', () => {
    expect(angleDelta(10, 30)).toBeCloseTo(20);
  });
  it('negative delta for counter-clockwise turn', () => {
    expect(angleDelta(30, 10)).toBeCloseTo(-20);
  });
  it('wraps through 360 correctly', () => {
    expect(angleDelta(350, 10)).toBeCloseTo(20);
    expect(angleDelta(10, 350)).toBeCloseTo(-20);
  });
  it('returns 0 for equal headings', () => {
    expect(angleDelta(45, 45)).toBe(0);
  });
  it('clamps to (−180, 180] range', () => {
    expect(angleDelta(0, 181)).toBeCloseTo(-179);
    expect(angleDelta(0, 180)).toBeCloseTo(180);
  });
});

describe('clampHeading', () => {
  it('returns desired when within limit', () => {
    expect(clampHeading(0, 20, 45)).toBeCloseTo(20);
  });
  it('clamps to +limitDeg when desired is too far right', () => {
    expect(clampHeading(0, 60, 45)).toBeCloseTo(45);
  });
  it('clamps to −limitDeg when desired is too far left', () => {
    expect(clampHeading(0, -60, 45)).toBeCloseTo(-45);
  });
});

describe('arcWedges', () => {
  it('F returns one front wedge ±45°', () => {
    const w = arcWedges('F');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ centre: 0, half: 45 });
  });
  it('R returns one rear wedge at 180°', () => {
    const w = arcWedges('R');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ centre: 180, half: 45 });
  });
  it('S (Broadside) returns both side wedges', () => {
    const w = arcWedges('S');
    expect(w).toHaveLength(2);
    expect(w.map(x => x.centre).sort()).toEqual([-90, 90]);
  });
  it('B is same as S', () => {
    expect(arcWedges('B')).toEqual(arcWedges('S'));
  });
  it('FN returns narrow front wedge ±11.25°', () => {
    const w = arcWedges('FN');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ centre: 0, half: 11.25 });
  });
  it('F/S/R returns four wedges', () => {
    expect(arcWedges('F/S/R')).toHaveLength(4);
  });
  it('unknown arc returns empty array', () => {
    expect(arcWedges('X')).toHaveLength(0);
  });
});

describe('pointInWeaponArc', () => {
  const ship = { x: 0, y: 0, heading: 0 };
  it('target directly in front is in F arc', () => {
    expect(pointInWeaponArc(ship, { arc: 'F' }, 100, 0)).toBe(true);
  });
  it('target directly behind is not in F arc', () => {
    expect(pointInWeaponArc(ship, { arc: 'F' }, -100, 0)).toBe(false);
  });
  it('target directly in front is in F/S/R arc', () => {
    expect(pointInWeaponArc(ship, { arc: 'F/S/R' }, 100, 0)).toBe(true);
  });
  it('arcless weapon hits everywhere', () => {
    expect(pointInWeaponArc(ship, { arc: '' }, -100, -100)).toBe(true);
  });
});

// ── Weapon / save helpers ─────────────────────────────────────────────────────

describe('lockVal', () => {
  it('parses "3+" → 3', () => expect(lockVal({ lock: '3+' })).toBe(3));
  it('parses "6+" → 6', () => expect(lockVal({ lock: '6+' })).toBe(6));
  it('returns 7 for "—" (no lock)', () => expect(lockVal({ lock: '—' })).toBe(7));
});

describe('saveVal', () => {
  it('parses "4+" → 4', () => expect(saveVal('4+')).toBe(4));
  it('parses "3+" → 3', () => expect(saveVal('3+')).toBe(3));
  it('returns null for "—"', () => expect(saveVal('—')).toBeNull());
  it('returns null for null', () => expect(saveVal(null)).toBeNull());
});

describe('isCapital', () => {
  it('L tonnage is not capital', () => expect(isCapital({ tonnage: 'L' })).toBe(false));
  it('M tonnage is capital', () => expect(isCapital({ tonnage: 'M' })).toBe(true));
  it('H tonnage is capital', () => expect(isCapital({ tonnage: 'H' })).toBe(true));
  it('C tonnage is capital', () => expect(isCapital({ tonnage: 'C' })).toBe(true));
});

describe('explosionRangeIn', () => {
  it('L → 3"', () => expect(explosionRangeIn({ tonnage: 'L' })).toBe(3));
  it('M → 3"', () => expect(explosionRangeIn({ tonnage: 'M' })).toBe(3));
  it('H → 6"', () => expect(explosionRangeIn({ tonnage: 'H' })).toBe(6));
  it('C → 9"', () => expect(explosionRangeIn({ tonnage: 'C' })).toBe(9));
});

describe('spikeCap', () => {
  it('default cap is 4', () => expect(spikeCap({ special: '' })).toBe(4));
  it('Cloak-1 gives cap of 1', () => expect(spikeCap({ special: 'Cloak-1, Descent' })).toBe(1));
  it('Cloak-3 gives cap of 3', () => expect(spikeCap({ special: 'Cloak-3' })).toBe(3));
});

describe('addGroupSpikes', () => {
  it('increments group spikes', () => {
    const grp = { spikes: 1 };
    addGroupSpikes(grp, { special: '' }, 2);
    expect(grp.spikes).toBe(3);
  });
  it('clamps to spikeCap', () => {
    const grp = { spikes: 3 };
    addGroupSpikes(grp, { special: 'Cloak-3' }, 5);
    expect(grp.spikes).toBe(3);
  });
  it('treats missing spikes as 0', () => {
    const grp = {};
    addGroupSpikes(grp, { special: '' }, 1);
    expect(grp.spikes).toBe(1);
  });
});

describe('addShipSpikes', () => {
  it('increments ship spikes', () => {
    const ship = { spikes: 0 };
    addShipSpikes(ship, { special: '' }, 2);
    expect(ship.spikes).toBe(2);
  });
  it('clamps to spikeCap', () => {
    const ship = { spikes: 4 };
    addShipSpikes(ship, { special: '' }, 3);
    expect(ship.spikes).toBe(4);
  });
});

describe('effectiveScan', () => {
  it('returns def.scan normally', () => {
    expect(effectiveScan({ scan: 8 }, {})).toBe(8);
  });
  it('returns 1 when Scanners Offline', () => {
    expect(effectiveScan({ scan: 8 }, { crippling: ['scanners'] })).toBe(1);
  });
  it('returns def.scan when ship has other crippling', () => {
    expect(effectiveScan({ scan: 6 }, { crippling: ['fire'] })).toBe(6);
  });
});

describe('effectiveMaxMovePx', () => {
  it('navigation crippling caps move to 2" (24px with INCH=12)', () => {
    const def = { thrust: 10 };
    const ship = { crippling: ['navigation'] };
    expect(effectiveMaxMovePx(def, ship, 'WF')).toBe(24); // 2 * INCH(12)
  });
  it('reduces effective thrust by arrestNext', () => {
    const def = { thrust: 10 };
    const withArrest = effectiveMaxMovePx(def, { arrestNext: 3 }, 'WF');
    const without   = effectiveMaxMovePx(def, {}, 'WF');
    expect(withArrest).toBeLessThan(without);
  });
});

describe('fireLimit', () => {
  const three = { weapons: [{}, {}, {}] };
  it('WF allows all weapons', () => expect(fireLimit('WF', three)).toBe(3));
  it('CC allows one weapon', () => expect(fireLimit('CC', three)).toBe(1));
  it('SR allows 0 (no fire) for normal ships', () => expect(fireLimit('SR', three)).toBe(0));
  it('Stealth ship on SR may fire 1', () => {
    expect(fireLimit('SR', { weapons: [{}, {}], special: 'Stealth Drop' })).toBe(1);
  });
  it('null order returns 0', () => expect(fireLimit(null, three)).toBe(0));
  it('unknown order returns 0', () => expect(fireLimit('XX', three)).toBe(0));
});

describe('weaponGroupKey', () => {
  it('unlocked weapon returns W:index key', () => {
    const def = { weapons: [{ special: '' }] };
    expect(weaponGroupKey(def, 0)).toBe('W:0');
  });
  it('Linked weapon returns L:X key', () => {
    const def = { weapons: [{ special: 'Linked-A' }] };
    expect(weaponGroupKey(def, 0)).toBe('L:A');
  });
  it('Alt weapon returns A:X key', () => {
    const def = { weapons: [{ special: 'Alt-1' }] };
    expect(weaponGroupKey(def, 0)).toBe('A:1');
  });
});

describe('linkedPartners', () => {
  it('non-linked weapon returns only itself', () => {
    const def = { weapons: [{ special: '' }, { special: '' }] };
    expect(linkedPartners(def, 0)).toEqual([0]);
  });
  it('linked weapons include all matching indices', () => {
    const def = { weapons: [
      { special: 'Linked-A' },
      { special: '' },
      { special: 'Linked-A' },
    ]};
    expect(linkedPartners(def, 0)).toEqual([0, 2]);
  });
});

describe('targetKey', () => {
  it('returns gid#si string', () => {
    expect(targetKey('ucm:g1', 2)).toBe('ucm:g1#2');
  });
});

describe('parseWeaponSpecials', () => {
  it('returns zeros/false for empty specials', () => {
    const sp = parseWeaponSpecials({ special: '' });
    expect(sp.scald).toBe(0); expect(sp.penetrator).toBe(false);
    expect(sp.closeAction).toBe(false); expect(sp.fusillade).toBe(0);
  });
  it('parses numeric specials', () => {
    const sp = parseWeaponSpecials({ special: 'Scald-2, Critical-1, Burnthrough-3, Bloom-1, Fusillade-2' });
    expect(sp.scald).toBe(2); expect(sp.critical).toBe(1);
    expect(sp.burnthrough).toBe(3); expect(sp.bloom).toBe(1);
    expect(sp.fusillade).toBe(2);
  });
  it('parses boolean specials', () => {
    const sp = parseWeaponSpecials({ special: 'Penetrator, Focused, Close Action, Mauler, Crippling, Overcharge' });
    expect(sp.penetrator).toBe(true); expect(sp.focused).toBe(true);
    expect(sp.closeAction).toBe(true); expect(sp.mauler).toBe(true);
    expect(sp.crippling).toBe(true); expect(sp.overcharge).toBe(true);
  });
  it('parses Calibre-X', () => {
    const sp = parseWeaponSpecials({ special: 'Calibre-H/C' });
    expect(sp.calibre).toBe('H/C');
  });
  it('parses Linked-X and Alt-X', () => {
    const sp = parseWeaponSpecials({ special: 'Linked-A, Alt-1' });
    expect(sp.linked).toBe('A');
    expect(sp.alt).toBe('1');
  });
  it('parses Volley-N, Arrest-N, Impel-N, Corruptor-N', () => {
    const sp = parseWeaponSpecials({ special: 'Volley-2, Arrest-3, Impel-1, Corruptor-2' });
    expect(sp.volley).toBe(2); expect(sp.arrest).toBe(3);
    expect(sp.impel).toBe(1); expect(sp.corruptor).toBe(2);
  });
  it('parses Low Power, High Power, Sustained Fire', () => {
    const sp = parseWeaponSpecials({ special: 'Low Power, High Power, Sustained Fire' });
    expect(sp.lowPower).toBe(true); expect(sp.highPower).toBe(true);
    expect(sp.sustained).toBe(true);
  });
});

describe('hasShields / shieldSaveVal', () => {
  it('hasShields true for Shield-3', () => {
    expect(hasShields({ special: 'Shield-3, Command Ship-1' })).toBe(true);
  });
  it('hasShields false without shield', () => {
    expect(hasShields({ special: 'Aegis-3' })).toBe(false);
  });
  it('shieldSaveVal extracts the number', () => {
    expect(shieldSaveVal({ special: 'Shield-4' })).toBe(4);
  });
  it('shieldSaveVal returns null if no shield', () => {
    expect(shieldSaveVal({ special: 'Aegis-2' })).toBeNull();
  });
});

describe('baseSaveForType', () => {
  const def = { es: '4+', ks: '5+' };
  const defShield = { es: '4+', ks: '5+', special: 'Shield-3' };

  it('E damage uses ES save', () => expect(baseSaveForType(def, {}, 'E', false)).toBe(4));
  it('K damage uses KS save', () => expect(baseSaveForType(def, {}, 'K', false)).toBe(5));
  it('C (Core) damage has no save', () => expect(baseSaveForType(def, {}, 'C', false)).toBeNull());
  it('Defence Offline worsens save by 1', () => {
    expect(baseSaveForType(def, { crippling: ['defence'] }, 'E', false)).toBe(5);
  });
  it('shieldUp returns shield save for E/K/C', () => {
    expect(baseSaveForType(defShield, {}, 'C', true)).toBe(3);
    expect(baseSaveForType(defShield, {}, 'K', true)).toBe(3);
  });
});

// ── Score / log helpers ───────────────────────────────────────────────────────

describe('shipPoints', () => {
  it('divides pts by groupSize', () => {
    expect(shipPoints({ pts: 100, groupSize: 2 })).toBe(50);
  });
  it('returns full pts for groupSize 1', () => {
    expect(shipPoints({ pts: 85, groupSize: 1 })).toBe(85);
  });
  it('handles missing pts gracefully', () => {
    expect(shipPoints({ groupSize: 1 })).toBe(0);
  });
});

describe('logEvent', () => {
  it('appends an entry to state.eventLog', () => {
    const s = makeState();
    s.round = 2;
    logEvent(s, 'something happened');
    expect(s.eventLog).toHaveLength(1);
    expect(s.eventLog[0].text).toBe('something happened');
    expect(s.eventLog[0].round).toBe(2);
  });
  it('creates eventLog if missing', () => {
    const s = makeState();
    delete s.eventLog;
    logEvent(s, 'x');
    expect(Array.isArray(s.eventLog)).toBe(true);
  });
  it('is a no-op for empty text', () => {
    const s = makeState();
    logEvent(s, '');
    expect(s.eventLog ?? []).toHaveLength(0);
  });
  it('caps log at 400 entries', () => {
    const s = makeState();
    for (let i = 0; i < 405; i++) logEvent(s, `event ${i}`);
    expect(s.eventLog.length).toBeLessThanOrEqual(401); // shifts after 400
  });
});

describe('awardVP', () => {
  it('adds VP to the right side', () => {
    const s = makeState();
    awardVP(s, 'player1', 3, 'Standard Scoring R4', 4);
    expect(s.score.player1.vp).toBe(3);
  });
  it('records a scoreLog entry', () => {
    const s = makeState();
    awardVP(s, 'player2', 2, 'Focal Points R6', 6);
    expect(s.scoreLog).toBeDefined();
    expect(s.scoreLog.some(e => e.vp === 2 && e.side === 'player2')).toBe(true);
  });
  it('returns a descriptive string', () => {
    const s = makeState();
    const result = awardVP(s, 'player1', 1, 'test', 1);
    expect(typeof result).toBe('string');
    expect(result).toContain('+1');
  });
  it('returns null for 0 VP', () => {
    const s = makeState();
    expect(awardVP(s, 'player1', 0, 'nothing', 1)).toBeNull();
  });
});

describe('recordKill', () => {
  it('adds ship points to killer KP', () => {
    const s = makeState();
    const def = { name: 'Rio Cruiser', pts: 85, groupSize: 1, side: 'player2', tonnage: 'M' };
    recordKill(s, def, 'player1', false, null);
    expect(s.score.player1.kp).toBe(85);
  });
  it('doubles points for a capture', () => {
    const s = makeState();
    const def = { name: 'Frigate', pts: 40, groupSize: 1, side: 'player2', tonnage: 'L' };
    recordKill(s, def, 'player1', true, null);
    expect(s.score.player1.kp).toBe(80);
  });
  it('tracks recon operative kills', () => {
    const s = makeState();
    s.shipReconOps = { 'g1#0': 2 };
    const def = { name: 'Frigate', pts: 30, groupSize: 1, side: 'player2', tonnage: 'L' };
    recordKill(s, def, 'player1', false, 'g1#0');
    expect(s.reconKills.player1).toBe(1);
    expect(s.shipReconOps['g1#0']).toBe(0);
  });
});

describe('dropsiteSizeKey', () => {
  it('large → L', () => expect(dropsiteSizeKey({ base: { size: 'large' } })).toBe('L'));
  it('small → S', () => expect(dropsiteSizeKey({ size: 'small' })).toBe('S'));
  it('medium → M', () => expect(dropsiteSizeKey({ size: 'medium' })).toBe('M'));
  it('defaults to M for unknown', () => expect(dropsiteSizeKey({})).toBe('M'));
  it('S alias → S', () => expect(dropsiteSizeKey({ size: 's' })).toBe('S'));
  it('L alias → L', () => expect(dropsiteSizeKey({ size: 'l' })).toBe('L'));
});

describe('objectiveForSide / objAny', () => {
  it('returns shared objective for both sides', () => {
    const s = makeState();
    s.scenario = { objective: 'normal' };
    expect(objectiveForSide(s, 'player1')).toBe('normal');
    expect(objectiveForSide(s, 'player2')).toBe('normal');
  });
  it('returns side-specific objective when set', () => {
    const s = makeState();
    s.scenario = { objectives: { player1: 'raze', player2: 'protect' } };
    expect(objectiveForSide(s, 'player1')).toBe('raze');
    expect(objectiveForSide(s, 'player2')).toBe('protect');
  });
  it('returns null with no scenario', () => {
    const s = makeState();
    s.scenario = null;
    expect(objectiveForSide(s, 'player1')).toBeNull();
  });
  it('objAny returns true if either side has the key', () => {
    const s = makeState();
    s.scenario = { objectives: { player1: 'raze', player2: 'protect' } };
    expect(objAny(s, 'raze')).toBe(true);
    expect(objAny(s, 'protect')).toBe(true);
    expect(objAny(s, 'normal')).toBe(false);
  });
});

// ── Dropsite / battalion helpers ──────────────────────────────────────────────

describe('dsBattalions', () => {
  it('initialises battalions on first call', () => {
    const ds = { features: [] };
    const b = dsBattalions(ds);
    expect(b.ground).toEqual({ player1: 0, player2: 0 });
  });
  it('creates feature slots for each feature', () => {
    const ds = { features: ['city', 'power_plant'] };
    const b = dsBattalions(ds);
    expect(b.feat0).toEqual({ player1: 0, player2: 0 });
    expect(b.feat1).toEqual({ player1: 0, player2: 0 });
  });
  it('returns existing battalions on subsequent calls', () => {
    const ds = { features: [] };
    dsBattalions(ds).ground.player1 = 3;
    expect(dsBattalions(ds).ground.player1).toBe(3);
  });
});

describe('dsSideBattalions / dsEnemyBattalions', () => {
  function dsWithBattalions(p1Ground, p2Ground) {
    const ds = { features: [] };
    const b = dsBattalions(ds);
    b.ground.player1 = p1Ground;
    b.ground.player2 = p2Ground;
    return ds;
  }

  it('counts all player1 battalions', () => {
    expect(dsSideBattalions(dsWithBattalions(3, 1), 'player1')).toBe(3);
  });
  it('counts all player2 battalions', () => {
    expect(dsSideBattalions(dsWithBattalions(1, 4), 'player2')).toBe(4);
  });
  it('enemy battalions are the other side', () => {
    expect(dsEnemyBattalions(dsWithBattalions(2, 5), 'player1')).toBe(5);
    expect(dsEnemyBattalions(dsWithBattalions(2, 5), 'player2')).toBe(2);
  });
});

describe('dropsiteContested / dropsiteController', () => {
  it('contested when both sides have battalions', () => {
    const ds = { features: [] };
    dsBattalions(ds).ground = { player1: 1, player2: 1 };
    expect(dropsiteContested(ds)).toBe(true);
  });
  it('not contested when only one side present', () => {
    const ds = { features: [] };
    dsBattalions(ds).ground = { player1: 2, player2: 0 };
    expect(dropsiteContested(ds)).toBe(false);
  });
  it('controller is the solo side', () => {
    const ds = { features: [] };
    dsBattalions(ds).ground = { player1: 0, player2: 3 };
    expect(dropsiteController(ds)).toBe('player2');
  });
  it('controller is null when empty', () => {
    const ds = { features: [] };
    expect(dropsiteController(ds)).toBeNull();
  });
  it('controller is null when contested', () => {
    const ds = { features: [] };
    dsBattalions(ds).ground = { player1: 2, player2: 1 };
    expect(dropsiteController(ds)).toBeNull();
  });
});

describe('transportValue', () => {
  it('returns 0 when no launch', () => {
    expect(transportValue({ launch: null })).toBe(0);
    expect(transportValue({})).toBe(0);
  });
  it('returns max dropship count', () => {
    const def = { launch: [{ type: 'dropship', n: 3 }, { type: 'fighter_bomber', n: 2 }] };
    expect(transportValue(def)).toBe(3);
  });
  it('counts bulk_lander as transport', () => {
    const def = { launch: [{ type: 'bulk_lander', n: 4 }] };
    expect(transportValue(def)).toBe(4);
  });
});

// ── Misc helpers ──────────────────────────────────────────────────────────────

describe('coherencyInches', () => {
  it('L tonnage → 3"', () => expect(coherencyInches({ tonnage: 'L' })).toBe(3));
  it('M tonnage → 6"', () => expect(coherencyInches({ tonnage: 'M' })).toBe(6));
  it('H tonnage → 6"', () => expect(coherencyInches({ tonnage: 'H' })).toBe(6));
  it('C tonnage → 6"', () => expect(coherencyInches({ tonnage: 'C' })).toBe(6));
});

describe('kindsForAssetType', () => {
  it('fighter → [fighter]', () => expect(kindsForAssetType('fighter')).toEqual(['fighter']));
  it('bomber → [bomber, fireship]', () => expect(kindsForAssetType('bomber')).toEqual(['bomber', 'fireship']));
  it('torpedo → [torpedo]', () => expect(kindsForAssetType('torpedo')).toEqual(['torpedo']));
  it('unknown → []', () => expect(kindsForAssetType('dropship')).toEqual([]));
});

// ── Crippling / explosion helpers ─────────────────────────────────────────────

describe('crippleFor', () => {
  it('1-3 → energy', () => {
    expect(crippleFor(2).key).toBe('energy');
    expect(crippleFor(3).key).toBe('energy');
  });
  it('4-5 → structural', () => {
    expect(crippleFor(4).key).toBe('structural');
    expect(crippleFor(5).key).toBe('structural');
  });
  it('6 → fire', () => expect(crippleFor(6).key).toBe('fire'));
  it('7 → defence', () => expect(crippleFor(7).key).toBe('defence'));
  it('8 → scanners', () => expect(crippleFor(8).key).toBe('scanners'));
  it('9 → weapons', () => expect(crippleFor(9).key).toBe('weapons'));
  it('10 → navigation', () => expect(crippleFor(10).key).toBe('navigation'));
  it('11+ → decay', () => expect(crippleFor(11).key).toBe('decay'));
});

describe('makeCrippleRoll', () => {
  it('returns a roll entry with the correct shape', () => {
    const c = makeCrippleRoll('g1', 0, { name: 'Rio Cruiser' });
    expect(c).toMatchObject({ gid: 'g1', si: 0, name: 'Rio Cruiser', rolled: false, braced: false });
  });
});

describe('rollCrippleEffect', () => {
  it('uses forced value when supplied', () => {
    const c = makeCrippleRoll('g1', 0, { name: 'X' });
    rollCrippleEffect(rng, c, 7);
    expect(c.total).toBe(7);
    expect(c.effectKey).toBe('defence');
    expect(c.rolled).toBe(true);
  });
  it('rolls 2D6 when no forced value', () => {
    const c = makeCrippleRoll('g1', 0, { name: 'X' });
    rollCrippleEffect(seqRng(3, 4), c, undefined);
    expect(c.d1).toBe(3); expect(c.d2).toBe(4);
    expect(c.total).toBe(7);
    expect(c.effectKey).toBe('defence');
  });
});

describe('makeExplosionRoll', () => {
  it('creates an explosion entry for a Light ship', () => {
    const def = { tonnage: 'L', side: 'player1' };
    const ship = { x: 100, y: 200, layer: 'orbit' };
    const ex = makeExplosionRoll('g1', 0, def, ship);
    expect(ex).toMatchObject({ gid: 'g1', si: 0, mod: 0, rolled: false, contained: false, rangeIn: 3 });
  });
  it('adds +1 mod for Heavy', () => {
    const ex = makeExplosionRoll('g', 0, { tonnage: 'H', side: 'p1' }, { x: 0, y: 0 });
    expect(ex.mod).toBe(1);
  });
  it('adds +2 mod for Colossal', () => {
    const ex = makeExplosionRoll('g', 0, { tonnage: 'C', side: 'p1' }, { x: 0, y: 0 });
    expect(ex.mod).toBe(2);
  });
});

describe('rollExplosionEffect', () => {
  it('uses forced roll value', () => {
    const ex = makeExplosionRoll('g', 0, { tonnage: 'L', side: 'p1' }, { x: 0, y: 0 });
    rollExplosionEffect(rng, ex, 3);
    expect(ex.total).toBe(3); expect(ex.effectName).toBe('Shredded'); expect(ex.rolled).toBe(true);
  });
  it('result ≥6 triggers Foldspace Catastrophe', () => {
    const ex = makeExplosionRoll('g', 0, { tonnage: 'L', side: 'p1' }, { x: 0, y: 0 });
    rollExplosionEffect(rng, ex, 6);
    expect(ex.effectName).toBe('Foldspace Catastrophe');
  });
  it('roll 1 → Burn Up (no effect)', () => {
    const ex = makeExplosionRoll('g', 0, { tonnage: 'L', side: 'p1' }, { x: 0, y: 0 });
    rollExplosionEffect(rng, ex, 1);
    expect(ex.effKind).toBe('none');
  });
  it('roll 2 → Reactor Rupture (spike2x)', () => {
    const ex = makeExplosionRoll('g', 0, { tonnage: 'L', side: 'p1' }, { x: 0, y: 0 });
    rollExplosionEffect(rng, ex, 2);
    expect(ex.effKind).toBe('spike2x');
  });
});

// ── Deployment helpers ────────────────────────────────────────────────────────

describe('isGroupUndeployed / allShipsDeployed / nextUndeployedShipIdx', () => {
  it('isGroupUndeployed true when all ships offTable', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance({ offTable: true })]);
    expect(isGroupUndeployed(s, 'p1:a')).toBe(true);
  });
  it('isGroupUndeployed false when any ship on table', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance({ offTable: false })]);
    expect(isGroupUndeployed(s, 'p1:a')).toBe(false);
  });
  it('isGroupUndeployed false for unknown gid', () => {
    const s = makeState();
    expect(isGroupUndeployed(s, 'unknown')).toBe(false);
  });
  it('nextUndeployedShipIdx returns first offTable index', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [
      shipInstance({ offTable: false }),
      shipInstance({ offTable: true }),
    ]);
    expect(nextUndeployedShipIdx(s, 'p1:a')).toBe(1);
  });
  it('nextUndeployedShipIdx returns -1 when all on table', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance({ offTable: false })]);
    expect(nextUndeployedShipIdx(s, 'p1:a')).toBe(-1);
  });
  it('nextUndeployedShipIdx returns -1 for unknown gid', () => {
    const s = makeState();
    expect(nextUndeployedShipIdx(s, 'unknown')).toBe(-1);
  });
  it('allShipsDeployed true when nextUndeployed is -1', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance({ offTable: false })]);
    expect(allShipsDeployed(s, 'p1:a')).toBe(true);
  });
  it('allShipsDeployed false when ship still offTable', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance({ offTable: true })]);
    expect(allShipsDeployed(s, 'p1:a')).toBe(false);
  });
});

describe('approachFor', () => {
  it('returns "close" when no scenario', () => {
    const s = makeState();
    s.scenario = null;
    expect(approachFor(s, 'player1')).toBe('close');
  });
});

describe('canDeployNow', () => {
  it('vanguard ships can always deploy', () => {
    const s = makeState();
    s.scenario = null;
    expect(canDeployNow(s, { vanguard: 4, side: 'player1' })).toBe(true);
  });
});

// ── Turn management helpers ───────────────────────────────────────────────────

describe('admiralAlive', () => {
  it('returns false when fleet has no on-table ships', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance({ offTable: true })]);
    expect(admiralAlive(s, 'player1')).toBe(false);
  });
  it('returns true when at least one ship is on table', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance({ offTable: false })]);
    expect(admiralAlive(s, 'player1')).toBe(true);
  });
});

describe('advanceActiveSide', () => {
  it('switches to the other side when it has pending activations', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance()]);
    addGroup(s, shipDef({ id: 'p2:b', side: 'player2' }), [shipInstance()]);
    s.activeSide = 'player1';
    s.groups['p1:a'].activated = true; // player1 done
    advanceActiveSide(s);
    expect(s.activeSide).toBe('player2');
  });
  it('sets activeSide to null when both sides are done', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance()]);
    addGroup(s, shipDef({ id: 'p2:b', side: 'player2' }), [shipInstance()]);
    s.activeSide = 'player1';
    s.groups['p1:a'].activated = true;
    s.groups['p2:b'].activated = true;
    advanceActiveSide(s);
    expect(s.activeSide).toBeNull();
  });
});

describe('anyRepairWork', () => {
  it('returns false when no ships have fire or crippling', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance()]);
    expect(anyRepairWork(s)).toBe(false);
  });
  it('returns true when a ship has fire tokens', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance({ fireTokens: 1 })]);
    expect(anyRepairWork(s)).toBe(true);
  });
  it('returns true when a ship has a repairable crippling', () => {
    const s = makeState();
    addGroup(s, shipDef({ id: 'p1:a', side: 'player1' }), [shipInstance({ crippling: ['fire'] })]);
    expect(anyRepairWork(s)).toBe(true);
  });
});

// ── Simple apply() inline intent cases ───────────────────────────────────────

function game() {
  const s = makeState();
  addGroup(s, shipDef({ id: 'p1:a', side: 'player1', hull: 6 }), [shipInstance({ hull: 6 })]);
  addGroup(s, shipDef({ id: 'p2:b', side: 'player2', hull: 6 }), [shipInstance({ hull: 6 })]);
  s.activeSide = 'player1';
  return s;
}

describe('apply — readySetup / unreadySetup', () => {
  it('readySetup marks a side ready', () => {
    const s = game();
    apply(s, { type: 'readySetup', side: 'player1' }, rng);
    expect(s.setupReady.player1).toBe(true);
  });
  it('unreadySetup clears a side', () => {
    const s = game();
    apply(s, { type: 'readySetup', side: 'player1' }, rng);
    apply(s, { type: 'unreadySetup', side: 'player1' }, rng);
    expect(s.setupReady.player1).toBe(false);
  });
});

describe('apply — holdPosition', () => {
  it('marks the ship as movedThisRound', () => {
    const s = game();
    apply(s, { type: 'holdPosition', gid: 'p1:a', si: 0 }, rng);
    expect(s.groups['p1:a'].ships[0].movedThisRound).toBe(true);
  });
  it('clears aiming when mode is course_change for the same group', () => {
    const s = game();
    s.aiming = { mode: 'course_change', gid: 'p1:a' };
    apply(s, { type: 'holdPosition', gid: 'p1:a', si: 0 }, rng);
    expect(s.aiming).toBeNull();
  });
  it('does not clear aiming for a different group', () => {
    const s = game();
    s.aiming = { mode: 'course_change', gid: 'p2:b' };
    apply(s, { type: 'holdPosition', gid: 'p1:a', si: 0 }, rng);
    expect(s.aiming).not.toBeNull();
  });
});

describe('apply — endVectoredMove', () => {
  it('clears vectoredSecondMove and hoverPoint', () => {
    const s = game();
    s.vectoredSecondMove = { x: 100, y: 100 };
    s.hoverPoint = { x: 50 };
    apply(s, { type: 'endVectoredMove' }, rng);
    expect(s.vectoredSecondMove).toBeNull();
    expect(s.hoverPoint).toBeNull();
  });
});

describe('apply — adjustHull', () => {
  it('increases hull', () => {
    const s = game();
    s.groups['p1:a'].ships[0].hull = 3;
    s.groups['p1:a'].ships[0].maxHull = 6;
    apply(s, { type: 'adjustHull', gid: 'p1:a', si: 0, delta: 2 }, rng);
    expect(s.groups['p1:a'].ships[0].hull).toBe(5);
  });
  it('clamps to maxHull', () => {
    const s = game();
    s.groups['p1:a'].ships[0].hull = 5;
    s.groups['p1:a'].ships[0].maxHull = 6;
    apply(s, { type: 'adjustHull', gid: 'p1:a', si: 0, delta: 5 }, rng);
    expect(s.groups['p1:a'].ships[0].hull).toBe(6);
  });
  it('marks destroyed when hull reaches 0', () => {
    const s = game();
    s.groups['p1:a'].ships[0].hull = 1;
    s.groups['p1:a'].ships[0].maxHull = 6;
    apply(s, { type: 'adjustHull', gid: 'p1:a', si: 0, delta: -1 }, rng);
    expect(s.groups['p1:a'].ships[0].destroyed).toBe(true);
  });
  it('unmarks destroyed when hull is healed above 0', () => {
    const s = game();
    s.groups['p1:a'].ships[0].hull = 0;
    s.groups['p1:a'].ships[0].maxHull = 6;
    s.groups['p1:a'].ships[0].destroyed = true;
    apply(s, { type: 'adjustHull', gid: 'p1:a', si: 0, delta: 2 }, rng);
    expect(s.groups['p1:a'].ships[0].destroyed).toBe(false);
  });
});

describe('apply — adjustAP', () => {
  it('increases planning AP', () => {
    const s = game();
    apply(s, { type: 'adjustAP', side: 'player1', delta: 2 }, rng);
    expect(s.planning.ap.player1).toBe(7);
  });
  it('clamps AP to minimum 0', () => {
    const s = game();
    apply(s, { type: 'adjustAP', side: 'player1', delta: -20 }, rng);
    expect(s.planning.ap.player1).toBe(0);
  });
});

describe('apply — adjustSpike', () => {
  it('increases group spikes', () => {
    const s = game();
    apply(s, { type: 'adjustSpike', gid: 'p1:a', delta: 2 }, rng);
    expect(s.groups['p1:a'].spikes).toBe(2);
  });
  it('clamps spikes to 0', () => {
    const s = game();
    apply(s, { type: 'adjustSpike', gid: 'p1:a', delta: -5 }, rng);
    expect(s.groups['p1:a'].spikes).toBe(0);
  });
});

describe('apply — giveInitiative', () => {
  it('updates the holder when initiative exists', () => {
    const s = game();
    s.initiative = { holder: 'player1', red: 4, blue: 2 };
    apply(s, { type: 'giveInitiative', to: 'player2' }, rng);
    expect(s.initiative.holder).toBe('player2');
  });
  it('no-ops when initiative is null', () => {
    const s = game();
    s.initiative = null;
    apply(s, { type: 'giveInitiative', to: 'player2' }, rng);
    expect(s.initiative).toBeNull();
  });
});

describe('apply — beginActivation', () => {
  it('sets activeSide from initiative holder and clears initiative', () => {
    const s = game();
    s.initiative = { holder: 'player2', red: 2, blue: 4 };
    apply(s, { type: 'beginActivation' }, rng);
    expect(s.activeSide).toBe('player2');
    expect(s.initiative).toBeNull();
  });
  it('no-ops when initiative is null', () => {
    const s = game();
    s.initiative = null;
    const prevSide = s.activeSide;
    apply(s, { type: 'beginActivation' }, rng);
    expect(s.activeSide).toBe(prevSide);
  });
});

describe('apply — pass (passActivation)', () => {
  it('consumes a pass token and transfers activeSide', () => {
    const s = game();
    addGroup(s, shipDef({ id: 'p2:extra', side: 'player2' }), [shipInstance()]);
    s.planning.passTokens.player1 = 1;
    s.activeSide = 'player1';
    apply(s, { type: 'pass' }, rng);
    expect(s.planning.passTokens.player1).toBe(0);
    expect(s.activeSide).toBe('player2');
  });
  it('no-ops when passer has no pass tokens', () => {
    const s = game();
    s.planning.passTokens.player1 = 0;
    s.activeSide = 'player1';
    const apBefore = s.planning.ap.player1;
    apply(s, { type: 'pass' }, rng);
    expect(s.planning.ap.player1).toBe(apBefore); // unchanged
  });
});

describe('apply — dismissDogfight', () => {
  it('clears dogfightResult', () => {
    const s = game();
    s.dogfightResult = { winner: 'player1' };
    apply(s, { type: 'dismissDogfight' }, rng);
    expect(s.dogfightResult).toBeNull();
  });
});

describe('apply — daPickDropsite', () => {
  it('stores the dsId on dropsiteActivation', () => {
    const s = game();
    s.dropsiteActivation = { side: 'player1', done: [], dsId: null };
    apply(s, { type: 'daPickDropsite', dsId: 'ds_alpha' }, rng);
    expect(s.dropsiteActivation.dsId).toBe('ds_alpha');
  });
  it('no-ops when dropsiteActivation is null', () => {
    const s = game();
    s.dropsiteActivation = null;
    apply(s, { type: 'daPickDropsite', dsId: 'ds_alpha' }, rng);
    expect(s.dropsiteActivation).toBeNull();
  });
});

describe('apply — setNomination', () => {
  it('stores a secondary nomination for a side', () => {
    const s = game();
    apply(s, { type: 'setNomination', side: 'player1', key: 'annihilate', nom: 'p2:b' }, rng);
    expect(s.secondaryNominations.player1.annihilate).toBe('p2:b');
  });
});

describe('apply — setProtectNom', () => {
  it('stores a protect nomination for a side', () => {
    const s = game();
    apply(s, { type: 'setProtectNom', side: 'player1', dsId: 'ds_01' }, rng);
    expect(s.protectNom.player1).toBe('ds_01');
  });
});

describe('apply — openDAFeatureAttack', () => {
  it('sets featureAttack when dropsiteActivation is active', () => {
    const s = game();
    s.dropsiteActivation = { side: 'player2', done: [], dsId: 'ds1' };
    apply(s, { type: 'openDAFeatureAttack', dsId: 'ds1', fi: 0 }, rng);
    expect(s.featureAttack).toMatchObject({ dsId: 'ds1', fi: 0, side: 'player2' });
  });
});

describe('apply — bcToDestroy / bcFinish-like', () => {
  it('bcToDestroy advances battle combat stage to destroy', () => {
    const s = game();
    s.battalionCombat = { stage: 'pick', dsId: null, done: [], log: [] };
    apply(s, { type: 'bcToDestroy' }, rng);
    expect(s.battalionCombat.stage).toBe('destroy');
  });
  it('bcPickDropsite sets dsId and stage', () => {
    const s = game();
    s.battalionCombat = { stage: 'pick', dsId: null, done: [], log: [] };
    apply(s, { type: 'bcPickDropsite', dsId: 'ds99' }, rng);
    expect(s.battalionCombat.dsId).toBe('ds99');
    expect(s.battalionCombat.stage).toBe('init');
  });
  it('skipBattalionCombat marks assetPhase resolved', () => {
    const s = game();
    s.assetPhase = { resolved: false, step: 'bc' };
    apply(s, { type: 'skipBattalionCombat' }, rng);
    expect(s.assetPhase.resolved).toBe(true);
  });
  it('startBattalionCombat initialises bc state', () => {
    const s = game();
    apply(s, { type: 'startBattalionCombat' }, rng);
    expect(s.battalionCombat).not.toBeNull();
    expect(s.battalionCombat.stage).toBe('pick');
  });
});

describe('apply — assetT2T', () => {
  it('marks an asset as T2T and clears moved flag', () => {
    const s = game();
    s.launchedAssets = [{ id: 'f1', kind: 'fighter', moved: true, t2t: false, side: 'player1', count: 3, x: 0, y: 0 }];
    apply(s, { type: 'assetT2T', assetId: 'f1' }, rng);
    expect(s.launchedAssets[0].t2t).toBe(true);
    expect(s.launchedAssets[0].moved).toBe(false);
  });
});

describe('apply — assetLockTarget / assetUntarget', () => {
  it('assetLockTarget stores bomber target', () => {
    const s = game();
    s.launchedAssets = [{ id: 'b1', kind: 'bomber', side: 'player1', count: 2, bomberTarget: null, x: 0, y: 0 }];
    apply(s, { type: 'assetLockTarget', assetId: 'b1', gid: 'p2:b', si: 0 }, rng);
    expect(s.launchedAssets[0].bomberTarget).toEqual({ gid: 'p2:b', si: 0 });
  });
  it('assetUntarget clears bomber target', () => {
    const s = game();
    s.launchedAssets = [{ id: 'b1', kind: 'bomber', side: 'player1', count: 2, bomberTarget: { gid: 'p2:b', si: 0 }, x: 0, y: 0 }];
    apply(s, { type: 'assetUntarget', assetId: 'b1' }, rng);
    expect(s.launchedAssets[0].bomberTarget).toBeNull();
  });
});

describe('apply — daDestroyFeature', () => {
  it('records a destroyed feature index on the dropsite', () => {
    const s = game();
    s.scenarioData = { dropsites: [{ id: 'ds1', base: { name: 'City' }, features: ['city'], destroyedFeatures: [] }] };
    apply(s, { type: 'daDestroyFeature', dsId: 'ds1', fi: 0 }, rng);
    expect(s.scenarioData.dropsites[0].destroyedFeatures).toContain(0);
  });
  it('does not duplicate feature indices', () => {
    const s = game();
    s.scenarioData = { dropsites: [{ id: 'ds1', base: { name: 'City' }, features: ['city'], destroyedFeatures: [0] }] };
    apply(s, { type: 'daDestroyFeature', dsId: 'ds1', fi: 0 }, rng);
    expect(s.scenarioData.dropsites[0].destroyedFeatures.filter(x => x === 0)).toHaveLength(1);
  });
});
