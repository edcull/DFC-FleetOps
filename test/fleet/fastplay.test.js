/**
 * Fastplay list tests.
 *
 * Each faction exports a raw fleet-list string. These tests parse every list
 * through parseNewRecruit and assert the ship groups come out correctly. This
 * also exercises the fastplay string modules themselves (coverage).
 */
import { describe, it, expect } from 'vitest';
import { parseNewRecruit } from '../../src/fleet/parser.js';
import { FASTPLAY_LISTS } from '../../src/fleet/fastplay/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupsNamed(groups, name) {
  return groups.filter(g => g.name === name);
}

function find(groups, name) {
  return groups.find(g => g.name === name);
}

// ---------------------------------------------------------------------------
// UCM
// ---------------------------------------------------------------------------

describe('fastplay — UCM', () => {
  const r = parseNewRecruit(FASTPLAY_LISTS.ucm);

  it('parses without error and detects faction', () => {
    expect(r.valid).toBe(true);
    expect(r.faction).toBe('ucm');
  });

  it('has 6 groups', () => {
    expect(r.groups).toHaveLength(6);
  });

  it('contains 1× Bruges Cruiser', () => {
    const g = find(r.groups, 'Bruges Cruiser');
    expect(g).toBeDefined();
    expect(g.count).toBe(1);
  });

  it('contains Edmonton Heavy Carrier and San Francisco Troopship as singles', () => {
    expect(find(r.groups, 'Edmonton Heavy Carrier')?.count).toBe(1);
    expect(find(r.groups, 'San Francisco Troopship')?.count).toBe(1);
  });

  it('contains 2× each frigate / strike carrier type', () => {
    expect(find(r.groups, 'Lima Detector Frigate')?.count).toBe(2);
    expect(find(r.groups, 'New Orleans Strike Carrier')?.count).toBe(2);
    expect(find(r.groups, 'Toulon Frigate')?.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Shaltari
// ---------------------------------------------------------------------------

describe('fastplay — Shaltari', () => {
  const r = parseNewRecruit(FASTPLAY_LISTS.shaltari);

  it('parses without error and detects faction', () => {
    expect(r.valid).toBe(true);
    expect(r.faction).toBe('shaltari');
  });

  it('has 6 groups', () => {
    expect(r.groups).toHaveLength(6);
  });

  it('contains heavy cruiser and fleet carrier as singles', () => {
    expect(find(r.groups, 'Basalt Fleet Carrier')?.count).toBe(1);
    expect(find(r.groups, 'Emerald Mothership')?.count).toBe(1);
    expect(find(r.groups, 'Obsidian Heavy Cruiser')?.count).toBe(1);
  });

  it('contains 2× frigates and 3× Voidgates', () => {
    expect(find(r.groups, 'Opal Shielding Frigate')?.count).toBe(2);
    expect(find(r.groups, 'Topaz Frigate')?.count).toBe(2);
    expect(find(r.groups, 'Voidgate')?.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// PHR
// ---------------------------------------------------------------------------

describe('fastplay — PHR', () => {
  const r = parseNewRecruit(FASTPLAY_LISTS.phr);

  it('parses without error and detects faction', () => {
    expect(r.valid).toBe(true);
    expect(r.faction).toBe('phr');
  });

  it('has 5 groups', () => {
    expect(r.groups).toHaveLength(5);
  });

  it('contains the medium ships', () => {
    expect(find(r.groups, 'Ikarus Vanguard Carrier')?.count).toBe(1);
    expect(find(r.groups, 'Orpheus Assault Troopship')?.count).toBe(1);
    expect(find(r.groups, 'Theseus Light Cruiser')?.count).toBe(1);
  });

  it('contains 2× each light ship', () => {
    expect(find(r.groups, 'Medea Strike Carrier')?.count).toBe(2);
    expect(find(r.groups, 'Pandora Frigate')?.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Resistance
// ---------------------------------------------------------------------------

describe('fastplay — Resistance', () => {
  const r = parseNewRecruit(FASTPLAY_LISTS.resistance);

  it('parses without error and detects faction', () => {
    expect(r.valid).toBe(true);
    expect(r.faction).toBe('resistance');
  });

  it('has 5 groups', () => {
    expect(r.groups).toHaveLength(5);
  });

  it('has three distinct Cruiser groups with different hardpoint options', () => {
    const cruisers = groupsNamed(r.groups, 'Cruiser');
    expect(cruisers).toHaveLength(3);
    // Each Cruiser has a unique set of options
    const optSets = cruisers.map(g => (g.options ?? []).join(','));
    expect(new Set(optSets).size).toBe(3);
  });

  it('contains 2× Heavy Frigate with options and 2× Strike Carrier', () => {
    const hf = find(r.groups, 'Heavy Frigate');
    expect(hf?.count).toBe(2);
    expect(hf?.options).toContain('NC-16 Missile Turret');
    expect(find(r.groups, 'Strike Carrier')?.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scourge
// ---------------------------------------------------------------------------

describe('fastplay — Scourge', () => {
  const r = parseNewRecruit(FASTPLAY_LISTS.scourge);

  it('parses without error and detects faction', () => {
    expect(r.valid).toBe(true);
    expect(r.faction).toBe('scourge');
  });

  it('has 5 groups', () => {
    expect(r.groups).toHaveLength(5);
  });

  it('contains the single-ship medium groups', () => {
    expect(find(r.groups, 'Chimera Troopship')?.count).toBe(1);
    expect(find(r.groups, 'Hydra Fleet Carrier')?.count).toBe(1);
    expect(find(r.groups, 'Sphinx Cruiser')?.count).toBe(1);
  });

  it('contains 2× each light group', () => {
    expect(find(r.groups, 'Gargoyle Strike Carrier')?.count).toBe(2);
    expect(find(r.groups, 'Harpy Frigate')?.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Bioficer
// ---------------------------------------------------------------------------

describe('fastplay — Bioficer', () => {
  const r = parseNewRecruit(FASTPLAY_LISTS.bioficer);

  it('parses without error and detects faction', () => {
    expect(r.valid).toBe(true);
    expect(r.faction).toBe('bioficer');
  });

  it('has 8 groups including payload', () => {
    expect(r.groups).toHaveLength(8);
  });

  it('contains the medium ships', () => {
    expect(find(r.groups, 'Catastrophe Heavy Cruiser')?.count).toBe(1);
    expect(find(r.groups, 'Cavern Fleet Carrier')?.count).toBe(1);
    expect(find(r.groups, 'Comet Cruiser')?.count).toBe(1);
  });

  it('contains 2× each light group', () => {
    expect(find(r.groups, 'Foray Frigate')?.count).toBe(2);
    expect(find(r.groups, 'Fulcrum Frigate')?.count).toBe(2);
  });

  it('contains payload groups', () => {
    expect(find(r.groups, 'Invasion Cell')?.count).toBe(2);
    expect(find(r.groups, 'Lander Cell')?.count).toBe(2);
    expect(find(r.groups, 'Prism Cell')?.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FASTPLAY_LISTS index — all six factions present
// ---------------------------------------------------------------------------

describe('FASTPLAY_LISTS index', () => {
  it('exports exactly the six expected faction keys', () => {
    expect(Object.keys(FASTPLAY_LISTS).sort()).toEqual(
      ['bioficer', 'phr', 'resistance', 'scourge', 'shaltari', 'ucm'],
    );
  });

  it('every entry is a non-empty string', () => {
    for (const [key, text] of Object.entries(FASTPLAY_LISTS)) {
      expect(typeof text, key).toBe('string');
      expect(text.trim().length, key).toBeGreaterThan(0);
    }
  });
});
