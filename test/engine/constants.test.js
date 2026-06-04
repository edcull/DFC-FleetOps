/**
 * constants.js coverage.
 *
 * The file is mostly pure data; the testable logic is:
 *  - ds() dropsite descriptor helper (optional fields)
 *  - VARIANTS.apply() functions that compute feature assignments and type
 *    replacements
 */
import { describe, it, expect } from 'vitest';
import {
  ds,
  FACTIONS, ORDERS, DROPSITE_BASE, FEATURES,
  LAYOUTS, DEPLOYMENTS, APPROACHES, APPROACH_BEHAVIOURS,
  VARIANTS,
  FOCAL_HIGH, FOCAL_LOW,
  OBJECTIVES, SECONDARY_OBJECTIVES,
  ASSET_PROFILES,
  INCH, BOARD_IN, BOARD_PX,
} from '../../src/engine/constants.js';

// ─── ds() helper ─────────────────────────────────────────────────────────────

describe('ds()', () => {
  it('returns id, type, x, y when no optional args given', () => {
    const d = ds('ds1', 'small_city', 10, 20);
    expect(d).toEqual({ id: 'ds1', type: 'small_city', x: 10, y: 20 });
    expect(d).not.toHaveProperty('layoutFeatures');
    expect(d).not.toHaveProperty('siteRules');
  });

  it('includes layoutFeatures when features array is provided', () => {
    const d = ds('ds2', 'medium_station', 24, 12, ['comms_station', 'military_outpost']);
    expect(d.layoutFeatures).toEqual(['comms_station', 'military_outpost']);
    expect(d).not.toHaveProperty('siteRules');
  });

  it('includes siteRules when provided', () => {
    const d = ds('ds3', 'large_city', 6, 6, null, ['assess_north', 'demolish_south']);
    expect(d.siteRules).toEqual(['assess_north', 'demolish_south']);
    expect(d).not.toHaveProperty('layoutFeatures');
  });

  it('includes both optional fields when both are provided', () => {
    const d = ds('ds4', 'small_station', 0, 0, ['power_plant'], ['assess']);
    expect(d.layoutFeatures).toEqual(['power_plant']);
    expect(d.siteRules).toEqual(['assess']);
  });
});

// ─── Static data spot-checks ─────────────────────────────────────────────────

describe('FACTIONS', () => {
  it('has the six expected factions', () => {
    expect(Object.keys(FACTIONS)).toEqual(['ucm', 'shaltari', 'phr', 'resistance', 'scourge', 'bioficer']);
  });
});

describe('ORDERS', () => {
  it('contains exactly the six order codes', () => {
    expect(Object.keys(ORDERS)).toEqual(['GQ', 'SR', 'WF', 'CC', 'MT', 'DC']);
  });

  it('GQ allows half-weapon fire and 45° turns', () => {
    expect(ORDERS.GQ.fireRule).toBe('half');
    expect(ORDERS.GQ.turnLimit).toBe(45);
  });

  it('SR has no fire and no turning', () => {
    expect(ORDERS.SR.fireRule).toBe('none');
    expect(ORDERS.SR.turnLimit).toBe(0);
  });

  it('MT allows 1× to 2× thrust with no fire', () => {
    expect(ORDERS.MT.moveMin).toBe(1);
    expect(ORDERS.MT.moveMax).toBe(2);
    expect(ORDERS.MT.fireRule).toBe('none');
  });
});

describe('board constants', () => {
  it('INCH is 12 pixels', () => expect(INCH).toBe(12));
  it('BOARD_IN is 48"', () => expect(BOARD_IN).toBe(48));
  it('BOARD_PX equals BOARD_IN × INCH', () => expect(BOARD_PX).toBe(BOARD_IN * INCH));
});

describe('DROPSITE_BASE', () => {
  it('all six types present', () => {
    expect(Object.keys(DROPSITE_BASE)).toEqual([
      'small_station', 'medium_station', 'large_station',
      'small_city', 'medium_city', 'large_city',
    ]);
  });
  it('large_station has hull 25', () => expect(DROPSITE_BASE.large_station.hull).toBe(25));
  it('cities have sig 0', () => {
    for (const key of ['small_city', 'medium_city', 'large_city']) {
      expect(DROPSITE_BASE[key].sig).toBe(0);
    }
  });
});

describe('FEATURES', () => {
  it('military_outpost has a weapon definition', () => {
    expect(FEATURES.military_outpost.weapon).toBeDefined();
    expect(FEATURES.military_outpost.weapon.lock).toBe('2+');
  });
  it('hangar has a launch array', () => {
    expect(Array.isArray(FEATURES.hangar.launch)).toBe(true);
    expect(FEATURES.hangar.launch[0].type).toBe('fighter_bomber');
  });
  it('comms_station has no weapon and no launch', () => {
    expect(FEATURES.comms_station).not.toHaveProperty('weapon');
    expect(FEATURES.comms_station).not.toHaveProperty('launch');
  });
});

describe('FOCAL_HIGH / FOCAL_LOW', () => {
  it('FOCAL_HIGH increases with tonnage', () => {
    expect(FOCAL_HIGH.L).toBeLessThan(FOCAL_HIGH.M);
    expect(FOCAL_HIGH.M).toBeLessThan(FOCAL_HIGH.H);
    expect(FOCAL_HIGH.H).toBeLessThan(FOCAL_HIGH.C);
  });
  it('FOCAL_LOW L is 0', () => {
    expect(FOCAL_LOW.L).toBe(0);
  });
});

describe('ASSET_PROFILES', () => {
  it('all six factions present', () => {
    expect(Object.keys(ASSET_PROFILES)).toEqual(['ucm', 'shaltari', 'phr', 'scourge', 'resistance', 'bioficer']);
  });
  it('each faction has fighter, bomber, fireship, torpedo, mine', () => {
    for (const faction of Object.values(ASSET_PROFILES)) {
      expect(faction).toHaveProperty('fighter');
      expect(faction).toHaveProperty('bomber');
      expect(faction).toHaveProperty('fireship');
      expect(faction).toHaveProperty('torpedo');
      expect(faction).toHaveProperty('mine');
    }
  });
  it('fighters have thrust and rerolls', () => {
    for (const faction of Object.values(ASSET_PROFILES)) {
      expect(typeof faction.fighter.thrust).toBe('number');
      expect(typeof faction.fighter.rerolls).toBe('number');
    }
  });
});

describe('SECONDARY_OBJECTIVES', () => {
  it('key_site and priority_target nominate a dropsite', () => {
    expect(SECONDARY_OBJECTIVES.key_site.nominate).toBe('dropsite');
    expect(SECONDARY_OBJECTIVES.priority_target.nominate).toBe('dropsite');
  });
  it('long_shot nominates a feature', () => {
    expect(SECONDARY_OBJECTIVES.long_shot.nominate).toBe('feature');
  });
  it('objectives_beyond nominates a ship', () => {
    expect(SECONDARY_OBJECTIVES.objectives_beyond.nominate).toBe('ship');
  });
});

describe('OBJECTIVES', () => {
  it('standard has scoring control_contest', () => {
    expect(OBJECTIVES.standard.scoring).toBe('control_contest');
  });
  it('extract has scoring none (manual)', () => {
    expect(OBJECTIVES.extract.scoring).toBe('none');
  });
  it('all objectives have a name and desc', () => {
    for (const [key, obj] of Object.entries(OBJECTIVES)) {
      expect(typeof obj.name).toBe('string', `OBJECTIVES.${key}.name missing`);
      expect(typeof obj.desc).toBe('string', `OBJECTIVES.${key}.desc missing`);
    }
  });
});

describe('LAYOUTS', () => {
  it('each standard layout has dropsites array', () => {
    for (const [key, layout] of Object.entries(LAYOUTS)) {
      expect(Array.isArray(layout.dropsites), `${key}.dropsites`).toBe(true);
    }
  });
  it('ds() within a layout correctly composes a descriptor', () => {
    const { dropsites } = LAYOUTS.diagonal;
    expect(dropsites[0]).toMatchObject({ id: 'ds1', type: 'small_station', x: 24, y: 12 });
  });
});

// ─── VARIANTS.apply() ─────────────────────────────────────────────────────────

// Minimal set of dropsites covering all size/category combos used by variants.
const BASE = [
  { id: 'ds1', type: 'small_station',  x: 10, y: 10 },
  { id: 'ds2', type: 'medium_station', x: 20, y: 20 },
  { id: 'ds3', type: 'large_station',  x: 30, y: 10 },
  { id: 'ds4', type: 'small_city',     x: 10, y: 30 },
  { id: 'ds5', type: 'medium_city',    x: 20, y: 30 },
  { id: 'ds6', type: 'large_city',     x: 30, y: 30 },
];

describe('VARIANTS.none', () => {
  it('returns identical dropsites, empty features and scenery', () => {
    const result = VARIANTS.none.apply(BASE);
    expect(result.dropsites).toHaveLength(BASE.length);
    expect(result.dropsites[0]).toEqual(BASE[0]);
    expect(result.features).toEqual({});
    expect(result.scenery).toEqual({});
  });
  it('dropsites are copies, not references', () => {
    const result = VARIANTS.none.apply(BASE);
    expect(result.dropsites[0]).not.toBe(BASE[0]);
  });
});

describe('VARIANTS.guarded_sectors', () => {
  it('gives every dropsite at least military_outpost', () => {
    const { features } = VARIANTS.guarded_sectors.apply(BASE, 'standoff');
    for (const d of BASE) {
      expect(features[d.id]).toContain('military_outpost');
    }
  });
  it('adds orbital_defence_gun only to large dropsites', () => {
    const { features } = VARIANTS.guarded_sectors.apply(BASE, 'standoff');
    expect(features.ds3).toContain('orbital_defence_gun'); // large_station
    expect(features.ds6).toContain('orbital_defence_gun'); // large_city
    expect(features.ds1).not.toContain('orbital_defence_gun');
    expect(features.ds5).not.toContain('orbital_defence_gun');
  });
  it('includes a note for attacker_defender deployment', () => {
    const { note } = VARIANTS.guarded_sectors.apply(BASE, 'attacker_defender');
    expect(typeof note).toBe('string');
    expect(note).not.toBeNull();
  });
  it('note is null for non-attacker_defender deployments', () => {
    const { note } = VARIANTS.guarded_sectors.apply(BASE, 'standoff');
    expect(note).toBeNull();
  });
});

describe('VARIANTS.secure_comms_array', () => {
  it('replaces large_city with large_station', () => {
    const { dropsites } = VARIANTS.secure_comms_array.apply(BASE);
    const ds6 = dropsites.find(d => d.id === 'ds6');
    expect(ds6.type).toBe('large_station');
  });
  it('assigns ODG + power_plant to replaced large cities', () => {
    const { features } = VARIANTS.secure_comms_array.apply(BASE);
    expect(features.ds6).toEqual(['orbital_defence_gun', 'power_plant']);
  });
  it('adds comms_station to medium cities when medium cities present', () => {
    const { features } = VARIANTS.secure_comms_array.apply(BASE);
    expect(features.ds5).toEqual(['comms_station']);
  });
  it('falls back to small city when no medium city present', () => {
    const noMedium = BASE.filter(d => d.type !== 'medium_city');
    const { features } = VARIANTS.secure_comms_array.apply(noMedium);
    expect(features.ds4).toEqual(['comms_station']); // small_city
  });
  it('does not change station types', () => {
    const { dropsites } = VARIANTS.secure_comms_array.apply(BASE);
    expect(dropsites.find(d => d.id === 'ds2').type).toBe('medium_station');
  });
});

describe('VARIANTS.battlescarred', () => {
  it('gives medium_city and medium_station two power_plants', () => {
    const { features } = VARIANTS.battlescarred.apply(BASE);
    expect(features.ds2).toEqual(['power_plant', 'power_plant']); // medium_station
    expect(features.ds5).toEqual(['power_plant', 'power_plant']); // medium_city
  });
  it('does not assign features to small or large dropsites', () => {
    const { features } = VARIANTS.battlescarred.apply(BASE);
    expect(features.ds1).toBeUndefined();
    expect(features.ds6).toBeUndefined();
  });
  it('adds scenery bonuses of 2', () => {
    const { scenery } = VARIANTS.battlescarred.apply(BASE);
    expect(scenery.micrometeorBonus).toBe(2);
    expect(scenery.denseBonus).toBe(2);
  });
  it('does not change dropsite types', () => {
    const { dropsites } = VARIANTS.battlescarred.apply(BASE);
    for (let i = 0; i < BASE.length; i++) {
      expect(dropsites[i].type).toBe(BASE[i].type);
    }
  });
});

describe('VARIANTS.gridlocked', () => {
  it('gives every dropsite at least power_plant', () => {
    const { features } = VARIANTS.gridlocked.apply(BASE);
    for (const d of BASE) {
      expect(features[d.id]).toContain('power_plant');
    }
  });
  it('replaces medium_city with medium_station', () => {
    const { dropsites } = VARIANTS.gridlocked.apply(BASE);
    const ds5 = dropsites.find(d => d.id === 'ds5');
    expect(ds5.type).toBe('medium_station');
  });
  it('adds full feature set to replaced medium cities', () => {
    const { features } = VARIANTS.gridlocked.apply(BASE);
    expect(features.ds5).toEqual(['military_outpost', 'orbital_defence_gun', 'hangar', 'power_plant']);
  });
  it('does not change non-medium-city types', () => {
    const { dropsites } = VARIANTS.gridlocked.apply(BASE);
    expect(dropsites.find(d => d.id === 'ds6').type).toBe('large_city');
  });
});

describe('VARIANTS.expansive_atmosphere', () => {
  it('returns unchanged dropsites, empty features and a manual note', () => {
    const result = VARIANTS.expansive_atmosphere.apply(BASE);
    expect(result.dropsites).toHaveLength(BASE.length);
    expect(result.features).toEqual({});
    expect(typeof result.note).toBe('string');
  });
});

describe('VARIANTS.orbital_complex', () => {
  it('converts all city types to matching station types', () => {
    const { dropsites } = VARIANTS.orbital_complex.apply(BASE);
    expect(dropsites.find(d => d.id === 'ds4').type).toBe('small_station');
    expect(dropsites.find(d => d.id === 'ds5').type).toBe('medium_station');
    expect(dropsites.find(d => d.id === 'ds6').type).toBe('large_station');
  });
  it('leaves station types unchanged', () => {
    const { dropsites } = VARIANTS.orbital_complex.apply(BASE);
    expect(dropsites.find(d => d.id === 'ds1').type).toBe('small_station');
    expect(dropsites.find(d => d.id === 'ds3').type).toBe('large_station');
  });
  it('gives every dropsite military_outpost', () => {
    const { features } = VARIANTS.orbital_complex.apply(BASE);
    for (const d of BASE) {
      expect(features[d.id]).toContain('military_outpost');
    }
  });
});

describe('VARIANTS.civic_infrastructure', () => {
  it('adds power_plant, hangar, comms_station to medium_city only', () => {
    const { features } = VARIANTS.civic_infrastructure.apply(BASE);
    expect(features.ds5).toEqual(['power_plant', 'hangar', 'comms_station']);
  });
  it('does not assign features to non-medium-city dropsites', () => {
    const { features } = VARIANTS.civic_infrastructure.apply(BASE);
    expect(features.ds1).toBeUndefined();
    expect(features.ds6).toBeUndefined();
  });
});

describe('VARIANTS.shock_and_yaw (bespoke)', () => {
  it('assigns correct features by type', () => {
    const { features } = VARIANTS.shock_and_yaw.apply(BASE);
    expect(features.ds4).toEqual(['hangar']);                                     // small_city
    expect(features.ds5).toEqual(['military_outpost']);                            // medium_city
    expect(features.ds2).toEqual(['power_plant', 'power_plant']);                  // medium_station
    expect(features.ds3).toEqual(['comms_station', 'orbital_defence_gun']);        // large_station
  });
  it('does not assign features to small_station or large_city', () => {
    const { features } = VARIANTS.shock_and_yaw.apply(BASE);
    expect(features.ds1).toBeUndefined(); // small_station
    expect(features.ds6).toBeUndefined(); // large_city
  });
  it('includes the power plant special note', () => {
    const { note } = VARIANTS.shock_and_yaw.apply(BASE);
    expect(typeof note).toBe('string');
  });
});

describe('VARIANTS.orbital_support (bespoke)', () => {
  it('gives medium_station and large_city two military_outposts', () => {
    const { features } = VARIANTS.orbital_support.apply(BASE);
    expect(features.ds2).toEqual(['military_outpost', 'military_outpost']);
    expect(features.ds6).toEqual(['military_outpost', 'military_outpost']);
  });
  it('gives small_city orbital_defence_gun + military_outpost', () => {
    const { features } = VARIANTS.orbital_support.apply(BASE);
    expect(features.ds4).toEqual(['orbital_defence_gun', 'military_outpost']);
  });
});

describe('VARIANTS.entrapmoont (bespoke)', () => {
  it('gives large_station military_outpost + ODG', () => {
    const { features } = VARIANTS.entrapmoont.apply(BASE);
    expect(features.ds3).toEqual(['military_outpost', 'orbital_defence_gun']);
  });
  it('gives small_city military_outpost', () => {
    const { features } = VARIANTS.entrapmoont.apply(BASE);
    expect(features.ds4).toEqual(['military_outpost']);
  });
  it('includes a manual placement note', () => {
    const { note } = VARIANTS.entrapmoont.apply(BASE);
    expect(typeof note).toBe('string');
  });
});
