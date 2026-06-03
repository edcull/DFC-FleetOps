/**
 * Pure geometry / profile-helper tests for the engine.
 *
 * These functions have no DOM or state dependencies (or only read a tiny def/ship
 * object), so they're tested in isolation. Covers headings, angles, firing arcs,
 * weapon/save parsing, tonnage rules, spikes, scan/move modifiers.
 */
import { describe, it, expect } from 'vitest';
import {
  headingVec, headingToward, angleDelta, clampHeading, arcWedges,
  pointInWeaponArc, lockVal, saveVal, isCapital, explosionRangeIn,
  spikeCap, addGroupSpikes, addShipSpikes, shipPoints, hasShields,
  shieldSaveVal, baseSaveForType, transportValue, dropsiteSizeKey,
  fireLimit, effectiveScan, effectiveMaxMovePx,
} from '../../src/engine/mutators.js';
import { INCH } from '../../src/engine/constants.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------
// Headings & angles
// ---------------------------------------------------------------------------

describe('headingVec', () => {
  it('0° points along +x', () => {
    const v = headingVec(0);
    expect(close(v.x, 1)).toBe(true);
    expect(close(v.y, 0)).toBe(true);
  });
  it('90° points along +y (down in SVG)', () => {
    const v = headingVec(90);
    expect(close(v.x, 0)).toBe(true);
    expect(close(v.y, 1)).toBe(true);
  });
  it('180° points along -x', () => {
    const v = headingVec(180);
    expect(close(v.x, -1)).toBe(true);
    expect(close(v.y, 0)).toBe(true);
  });
});

describe('headingToward', () => {
  it('east of origin → 0°', () => expect(close(headingToward(0, 0, 10, 0), 0)).toBe(true));
  it('south of origin → 90°', () => expect(close(headingToward(0, 0, 0, 10), 90)).toBe(true));
  it('west of origin → 180°', () => expect(close(Math.abs(headingToward(0, 0, -10, 0)), 180)).toBe(true));
  it('north of origin → -90°', () => expect(close(headingToward(0, 0, 0, -10), -90)).toBe(true));
});

describe('angleDelta', () => {
  it('wraps to the shortest signed angle', () => {
    expect(angleDelta(350, 10)).toBe(20);    // forward across 360
    expect(angleDelta(10, 350)).toBe(-20);   // backward across 0
    expect(angleDelta(0, 90)).toBe(90);
    expect(angleDelta(90, 0)).toBe(-90);
  });
  it('keeps exact ±180 in range (−180, 180]', () => {
    expect(angleDelta(0, 180)).toBe(180);
    expect(angleDelta(0, 181)).toBe(-179);
  });
});

describe('clampHeading', () => {
  it('does not clamp within the limit', () => expect(clampHeading(0, 30, 45)).toBe(30));
  it('clamps a left turn to the limit', () => expect(clampHeading(0, 90, 45)).toBe(45));
  it('clamps a right turn to the limit', () => expect(clampHeading(0, -90, 45)).toBe(-45));
});

// ---------------------------------------------------------------------------
// Firing arcs
// ---------------------------------------------------------------------------

describe('arcWedges', () => {
  it('Fore arc is a single 90°-wide wedge centred ahead', () => {
    expect(arcWedges('F')).toEqual([{ centre: 0, half: 45 }]);
  });
  it('Rear arc is centred behind', () => {
    expect(arcWedges('R')).toEqual([{ centre: 180, half: 45 }]);
  });
  it('Side/Broadside arc yields two wedges at ±90°', () => {
    expect(arcWedges('S')).toEqual([{ centre: 90, half: 45 }, { centre: -90, half: 45 }]);
  });
  it('Narrow arcs are 22.5° wide (half 11.25)', () => {
    expect(arcWedges('FN')).toEqual([{ centre: 0, half: 11.25 }]);
    expect(arcWedges('RN')).toEqual([{ centre: 180, half: 11.25 }]);
  });
  it('combined arc string F/S yields all three wedges', () => {
    expect(arcWedges('F/S')).toHaveLength(3);
  });
});

describe('pointInWeaponArc', () => {
  const ship = { x: 0, y: 0, heading: 0 };  // facing +x
  it('Fore weapon hits a target dead ahead', () => {
    expect(pointInWeaponArc(ship, { arc: 'F' }, 10, 0)).toBe(true);
  });
  it('Fore weapon misses a target behind', () => {
    expect(pointInWeaponArc(ship, { arc: 'F' }, -10, 0)).toBe(false);
  });
  it('Rear weapon hits a target behind', () => {
    expect(pointInWeaponArc(ship, { arc: 'R' }, -10, 0)).toBe(true);
  });
  it('Side weapon hits abeam but not ahead', () => {
    expect(pointInWeaponArc(ship, { arc: 'S' }, 0, 10)).toBe(true);
    expect(pointInWeaponArc(ship, { arc: 'S' }, 10, 0)).toBe(false);
  });
  it('arcless weapon (no wedges) is all-round', () => {
    expect(pointInWeaponArc(ship, { arc: 'LoS' }, -10, -10)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Profile parsing helpers
// ---------------------------------------------------------------------------

describe('lockVal / saveVal', () => {
  it('parses lock values, defaulting to 7 when absent', () => {
    expect(lockVal({ lock: '3+' })).toBe(3);
    expect(lockVal({ lock: '6+' })).toBe(6);
    expect(lockVal({ lock: undefined })).toBe(7);
  });
  it('parses save values, dash and missing → null', () => {
    expect(saveVal('4+')).toBe(4);
    expect(saveVal('—')).toBe(null);
    expect(saveVal(null)).toBe(null);
    expect(saveVal('')).toBe(null);
  });
});

describe('isCapital / explosionRangeIn', () => {
  it('Medium and larger are Capital ships', () => {
    expect(isCapital({ tonnage: 'M' })).toBe(true);
    expect(isCapital({ tonnage: 'H' })).toBe(true);
    expect(isCapital({ tonnage: 'C' })).toBe(true);
    expect(isCapital({ tonnage: 'L' })).toBe(false);
  });
  it('explosion range scales with tonnage', () => {
    expect(explosionRangeIn({ tonnage: 'C' })).toBe(9);
    expect(explosionRangeIn({ tonnage: 'H' })).toBe(6);
    expect(explosionRangeIn({ tonnage: 'M' })).toBe(3);
    expect(explosionRangeIn({ tonnage: 'L' })).toBe(3);
  });
});

describe('spikes', () => {
  it('default cap is 4, Cloak-X lowers it', () => {
    expect(spikeCap({ special: '' })).toBe(4);
    expect(spikeCap({ special: 'Cloak-2' })).toBe(2);
    expect(spikeCap({})).toBe(4);
  });
  it('addGroupSpikes respects the cap', () => {
    const grp = { spikes: 3 };
    addGroupSpikes(grp, { special: '' }, 5);
    expect(grp.spikes).toBe(4);            // clamped to 4
  });
  it('addGroupSpikes respects a Cloak cap', () => {
    const grp = { spikes: 0 };
    addGroupSpikes(grp, { special: 'Cloak-1' }, 3);
    expect(grp.spikes).toBe(1);
  });
  it('addShipSpikes respects the cap', () => {
    const ship = { spikes: 0 };
    addShipSpikes(ship, { special: '' }, 10);
    expect(ship.spikes).toBe(4);
  });
});

describe('shipPoints', () => {
  it('divides group points across the group size and rounds', () => {
    expect(shipPoints({ pts: 120, groupSize: 3 })).toBe(40);
    expect(shipPoints({ pts: 100, groupSize: 3 })).toBe(33);
    expect(shipPoints({ pts: 50 })).toBe(50);          // groupSize defaults to 1
    expect(shipPoints({})).toBe(0);
  });
});

describe('shields', () => {
  it('detects Shield specials', () => {
    expect(hasShields({ special: 'Shield-4' })).toBe(true);
    expect(hasShields({ special: 'Shield' })).toBe(true);
    expect(hasShields({ special: 'Aegis-2' })).toBe(false);
    expect(hasShields({ special: '' })).toBe(false);
  });
  it('reads the shield save value', () => {
    expect(shieldSaveVal({ special: 'Shield-3' })).toBe(3);
    expect(shieldSaveVal({ special: 'Shield' })).toBe(null);
    expect(shieldSaveVal({ special: '' })).toBe(null);
  });
});

describe('baseSaveForType', () => {
  const td = { es: '4+', ks: '5+', special: '' };
  const ts = {};
  it('Energy hits use the Energy save', () => expect(baseSaveForType(td, ts, 'E', false)).toBe(4));
  it('Kinetic hits use the Kinetic save', () => expect(baseSaveForType(td, ts, 'K', false)).toBe(5));
  it('Core hits have no save without a shield', () => expect(baseSaveForType(td, ts, 'C', false)).toBe(null));
  it('a raised Shield replaces ES/KS for all types', () => {
    const shielded = { es: '4+', ks: '5+', special: 'Shield-3' };
    expect(baseSaveForType(shielded, ts, 'E', true)).toBe(3);
    expect(baseSaveForType(shielded, ts, 'K', true)).toBe(3);
    expect(baseSaveForType(shielded, ts, 'C', true)).toBe(3);   // shield saves vs Core
  });
  it('Defence-Systems-Offline crippling worsens the save by 1', () => {
    const crippled = { crippling: ['defence'] };
    expect(baseSaveForType(td, crippled, 'E', false)).toBe(5);  // 4 → 5
  });
});

describe('transportValue', () => {
  it('is 0 with no launch capacity', () => {
    expect(transportValue({})).toBe(0);
    expect(transportValue({ launch: [{ type: 'fighter', n: 4 }] })).toBe(0);
  });
  it('returns the largest transport-type launch count', () => {
    expect(transportValue({ launch: [{ type: 'lander', n: 6 }] })).toBe(6);
    expect(transportValue({ launch: [
      { type: 'dropship', n: 2 }, { type: 'lander', n: 5 }, { type: 'fighter', n: 9 },
    ] })).toBe(5);
  });
});

describe('dropsiteSizeKey', () => {
  it('normalises base.size to S/M/L', () => {
    expect(dropsiteSizeKey({ base: { size: 'small' } })).toBe('S');
    expect(dropsiteSizeKey({ base: { size: 'large' } })).toBe('L');
    expect(dropsiteSizeKey({ base: { size: 'medium' } })).toBe('M');
  });
  it('falls back to ds.size and defaults to M', () => {
    expect(dropsiteSizeKey({ size: 'L' })).toBe('L');
    expect(dropsiteSizeKey({})).toBe('M');
  });
});

// ---------------------------------------------------------------------------
// Order-derived limits
// ---------------------------------------------------------------------------

describe('fireLimit', () => {
  const def = { weapons: [{}, {}, {}, {}] };   // 4 weapons
  it('Weapons Free fires all weapons', () => expect(fireLimit('WF', def)).toBe(4));
  it('General Quarters fires half (rounded up)', () => expect(fireLimit('GQ', def)).toBe(2));
  it('Course Change fires one', () => expect(fireLimit('CC', def)).toBe(1));
  it('Silent Running fires none', () => expect(fireLimit('SR', def)).toBe(0));
  it('Max Thrust fires none', () => expect(fireLimit('MT', def)).toBe(0));
  it('Stealth lets a ship fire one weapon on Silent Running', () => {
    expect(fireLimit('SR', { weapons: [{}, {}], special: 'Stealth' })).toBe(1);
  });
  it('no order → 0', () => expect(fireLimit(null, def)).toBe(0));
});

describe('effectiveScan', () => {
  it('returns the def scan normally', () => {
    expect(effectiveScan({ scan: 8 }, {})).toBe(8);
  });
  it('drops to 1 with Scanners-Offline crippling', () => {
    expect(effectiveScan({ scan: 8 }, { crippling: ['scanners'] })).toBe(1);
  });
});

describe('effectiveMaxMovePx', () => {
  const def = { thrust: 6 };
  it('scales order moveMax by thrust, in pixels', () => {
    // WF moveMax 1 → 1 * 6 thrust * INCH
    expect(effectiveMaxMovePx(def, {}, 'WF')).toBe(6 * INCH);
    // CC moveMax 0.5 → 3 * INCH
    expect(effectiveMaxMovePx(def, {}, 'CC')).toBe(3 * INCH);
    // MT moveMax 2 → 12 * INCH
    expect(effectiveMaxMovePx(def, {}, 'MT')).toBe(12 * INCH);
  });
  it('Navigation-Offline crippling caps movement at 2 inches', () => {
    expect(effectiveMaxMovePx(def, { crippling: ['navigation'] }, 'MT')).toBe(2 * INCH);
  });
  it('Arrest-X reduces effective thrust for the next activation', () => {
    // thrust 6 − arrest 2 = 4; WF moveMax 1 → 4 * INCH
    expect(effectiveMaxMovePx(def, { arrestNext: 2 }, 'WF')).toBe(4 * INCH);
  });
  it('an unknown order yields no movement', () => {
    expect(effectiveMaxMovePx(def, {}, 'NOPE')).toBe(0);
  });
});
