import { describe, it, expect } from 'vitest';
import { FLEET_DB, findShipDef, applyHardpointOptions } from '../../src/fleet/db.js';

const FACTIONS = ['ucm', 'scourge', 'phr', 'shaltari', 'resistance', 'bioficer'];
const VALID_TONNAGES = new Set(['L', 'M', 'H', 'C']);

// ---------------------------------------------------------------------------
// FLEET_DB structural integrity
// ---------------------------------------------------------------------------

describe('FLEET_DB — all factions present', () => {
  it('exports entries for every expected faction', () => {
    for (const f of FACTIONS) {
      expect(FLEET_DB[f], `faction ${f} missing`).toBeDefined();
      expect(Object.keys(FLEET_DB[f]).length).toBeGreaterThan(0);
    }
  });
});

describe('FLEET_DB — required fields on every ship', () => {
  for (const faction of FACTIONS) {
    const db = FLEET_DB[faction];
    for (const [name, def] of Object.entries(db)) {
      it(`${faction}/${name} has all required fields`, () => {
        expect(def.role,      `${name}.role`).toBeTruthy();
        expect(typeof def.pts).toBe('number');
        expect(def.pts).toBeGreaterThan(0);
        expect(VALID_TONNAGES.has(def.tonnage), `${name}.tonnage "${def.tonnage}"`).toBe(true);
        expect(def.groupSize).toBeGreaterThanOrEqual(1);
        expect(def.thrust).toBeGreaterThanOrEqual(0);
        expect(def.hull).toBeGreaterThan(0);
        expect(Array.isArray(def.weapons), `${name}.weapons not array`).toBe(true);
        expect(def.special).toBeDefined();
      });
    }
  }
});

describe('FLEET_DB — weapon entries are valid', () => {
  for (const faction of FACTIONS) {
    const db = FLEET_DB[faction];
    for (const [name, def] of Object.entries(db)) {
      for (const w of def.weapons) {
        it(`${faction}/${name} weapon "${w.name}" has required fields`, () => {
          expect(w.name).toBeTruthy();
          expect(w.arc).toBeTruthy();
          expect(typeof w.att).toBe('number');
          expect(w.att).toBeGreaterThanOrEqual(0);
          expect(typeof w.dmg).toBe('number');
          expect(['K', 'E', 'C']).toContain(w.type);
        });
      }
    }
  }
});

describe('FLEET_DB — launch entries are valid when present', () => {
  for (const faction of FACTIONS) {
    const db = FLEET_DB[faction];
    for (const [name, def] of Object.entries(db)) {
      if (!def.launch) continue;
      it(`${faction}/${name} launch entries are well-formed`, () => {
        expect(Array.isArray(def.launch)).toBe(true);
        for (const l of def.launch) {
          expect(l.name).toBeTruthy();
          expect(typeof l.n).toBe('number');
          expect(l.n).toBeGreaterThan(0);
          expect(l.type).toBeTruthy();
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// findShipDef
// ---------------------------------------------------------------------------

describe('findShipDef', () => {
  it('finds a ship by exact name', () => {
    const def = findShipDef('ucm', 'Rio Cruiser');
    expect(def).not.toBeNull();
    expect(def.role).toBe('Cruiser');
  });

  it('finds a ship case-insensitively', () => {
    const def = findShipDef('ucm', 'rio cruiser');
    expect(def).not.toBeNull();
  });

  it('finds by prefix (short name resolves to full)', () => {
    const def = findShipDef('ucm', 'Rio');
    expect(def).not.toBeNull();
  });

  it('strips parenthetical and still matches', () => {
    const def = findShipDef('resistance', 'Cruiser (Vent Cannon Turret)');
    expect(def).not.toBeNull();
  });

  it('returns null for unknown faction', () => {
    expect(findShipDef('unknown', 'Rio Cruiser')).toBeNull();
  });

  it('returns null for unknown ship', () => {
    expect(findShipDef('ucm', 'Totally Fake Ship')).toBeNull();
  });

  it('finds Scourge ships', () => {
    const def = findShipDef('scourge', 'Harpy Frigate');
    expect(def).not.toBeNull();
    expect(def.role).toBe('Frigate');
  });

  it('finds PHR ships', () => {
    const def = findShipDef('phr', 'Achilles');
    expect(def).not.toBeNull();
    expect(def.tonnage).toBe('M');
  });

  it('finds Shaltari ships', () => {
    const def = findShipDef('shaltari', 'Voidgate');
    expect(def).not.toBeNull();
  });

  it('finds Bioficer ships', () => {
    const def = findShipDef('bioficer', 'Fugue');
    expect(def).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyHardpointOptions
// ---------------------------------------------------------------------------

describe('applyHardpointOptions', () => {
  function clone(faction, name) {
    const def = findShipDef(faction, name);
    return JSON.parse(JSON.stringify(def));
  }

  it('no-ops on undefined options', () => {
    const c = clone('ucm', 'Rio Cruiser');
    const before = JSON.stringify(c);
    applyHardpointOptions(c, undefined);
    expect(JSON.stringify(c)).toBe(before);
  });

  it('no-ops on empty options array', () => {
    const c = clone('ucm', 'Rio Cruiser');
    const before = JSON.stringify(c);
    applyHardpointOptions(c, []);
    expect(JSON.stringify(c)).toBe(before);
  });

  it('Scanner Array increases scan by 4', () => {
    const c = clone('resistance', 'Cruiser');
    const scanBefore = c.scan;
    applyHardpointOptions(c, ['Scanner Array']);
    expect(c.scan).toBe(scanBefore + 4);
  });

  it('Drive Refit increases thrust by 3', () => {
    const c = clone('resistance', 'Cruiser');
    const thrustBefore = c.thrust;
    applyHardpointOptions(c, ['Drive Refit']);
    expect(c.thrust).toBe(thrustBefore + 3);
  });

  it('Ablative Armour improves ES and KS saves by 1', () => {
    const c = clone('resistance', 'Cruiser'); // es:'4+', ks:'5+'
    applyHardpointOptions(c, ['Ablative Armour']);
    expect(c.es).toBe('3+');
    expect(c.ks).toBe('4+');
  });

  it('Ablative Armour adds Reinforced Armour to special', () => {
    const c = clone('resistance', 'Cruiser');
    applyHardpointOptions(c, ['Ablative Armour']);
    expect(c.special).toContain('Reinforced Armour');
  });

  it('Sensor Dome adds Detector to special', () => {
    const c = clone('resistance', 'Cruiser');
    applyHardpointOptions(c, ['Sensor Dome']);
    expect(c.special).toContain('Detector');
  });

  it('Laser Refit replaces UF-4200 weapons and adds Cobra Heavy Laser Pair', () => {
    const c = clone('ucm', 'Rio Cruiser');
    applyHardpointOptions(c, ['Laser Refit']);
    expect(c.weapons.some(w => w.name === 'Cobra Heavy Laser Pair')).toBe(true);
    expect(c.weapons.some(w => /UF-4200/.test(w.name))).toBe(false);
  });

  it('Vent Cannon Turret adds weapon to Resistance Cruiser', () => {
    const c = clone('resistance', 'Cruiser');
    applyHardpointOptions(c, ['Vent Cannon Turret']);
    expect(c.weapons.some(w => w.name === 'Vent Cannon Turret')).toBe(true);
  });

  it('Fighters & Bombers option adds a launch entry', () => {
    const c = clone('resistance', 'Cruiser');
    if (!c.launch) c.launch = [];
    const before = c.launch.length;
    applyHardpointOptions(c, ['Fighters & Bombers']);
    expect(c.launch.length).toBe(before + 1);
    expect(c.launch.some(l => l.type === 'fighter_bomber')).toBe(true);
  });

  it('case-insensitive option matching works', () => {
    const c = clone('resistance', 'Cruiser');
    const scanBefore = c.scan;
    applyHardpointOptions(c, ['SCANNER ARRAY']);
    expect(c.scan).toBe(scanBefore + 4);
  });

  it('applies multiple options in sequence', () => {
    const c = clone('resistance', 'Cruiser');
    const scanBefore = c.scan;
    const thrustBefore = c.thrust;
    applyHardpointOptions(c, ['Scanner Array', 'Drive Refit']);
    expect(c.scan).toBe(scanBefore + 4);
    expect(c.thrust).toBe(thrustBefore + 3);
  });
});
