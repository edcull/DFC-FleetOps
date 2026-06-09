import { describe, it, expect } from 'vitest';
import { parseNewRecruit } from '../../src/fleet/parser.js';
import { FASTPLAY_LISTS } from '../../src/fleet/fastplay/index.js';

// ---------------------------------------------------------------------------
// Faction detection
// ---------------------------------------------------------------------------

describe('parseNewRecruit — faction detection', () => {
  it('detects UCM from first line', () => {
    const r = parseNewRecruit('United Colonies of Mankind - [100 pts]\n## Groups [100 pts]\nRio Cruiser [85 pts]');
    expect(r.faction).toBe('ucm');
  });

  it('detects UCMF alias', () => {
    const r = parseNewRecruit('UCMF [100 pts]\n## Groups [100 pts]\nRio Cruiser [85 pts]');
    expect(r.faction).toBe('ucm');
  });

  it('detects Scourge', () => {
    const r = parseNewRecruit('Scourge [100 pts]\n## Groups [100 pts]\nHarpy Frigate [40 pts]');
    expect(r.faction).toBe('scourge');
  });

  it('detects PHR from Post Human Republic', () => {
    const r = parseNewRecruit('Post Human Republic [100 pts]\n## Groups [100 pts]\nEuropa [38 pts]');
    expect(r.faction).toBe('phr');
  });

  it('detects Shaltari', () => {
    const r = parseNewRecruit('Shaltari [100 pts]\n## Groups [100 pts]\nTopaz [43 pts]');
    expect(r.faction).toBe('shaltari');
  });

  it('detects Resistance', () => {
    const r = parseNewRecruit('Resistance [100 pts]\n## Groups [100 pts]\nFrigate [22 pts]');
    expect(r.faction).toBe('resistance');
  });

  it('detects Bioficer', () => {
    const r = parseNewRecruit('Bioficer [100 pts]\n## Groups [100 pts]\nFugue [35 pts]');
    expect(r.faction).toBe('bioficer');
  });

  it('returns null faction for unrecognised text', () => {
    const r = parseNewRecruit('Unknown Faction [100 pts]\n## Groups [100 pts]\nShip [85 pts]');
    expect(r.faction).toBeNull();
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group parsing — single-ship groups
// ---------------------------------------------------------------------------

describe('parseNewRecruit — single-ship groups', () => {
  const BASE = 'UCM\n## Groups [85 pts]\n';

  it('parses a plain single-ship group', () => {
    const r = parseNewRecruit(BASE + 'Rio Cruiser [85 pts]');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ name: 'Rio Cruiser', count: 1, pts: 85 });
  });

  it('strips parenthetical option names from the ship name', () => {
    const r = parseNewRecruit(BASE + 'Edmonton Heavy Carrier (Laser Refit) [135 pts]');
    expect(r.groups[0].name).toBe('Edmonton Heavy Carrier');
  });

  it('captures parenthetical known options', () => {
    const r = parseNewRecruit(BASE + 'Edmonton Heavy Carrier (Laser Refit) [135 pts]');
    expect(r.groups[0].options).toContain('Laser Refit');
  });

  it('ignores parenthetical unknown options in name', () => {
    const r = parseNewRecruit(BASE + 'Rio Cruiser (Something Unknown) [85 pts]');
    expect(r.groups[0].name).toBe('Rio Cruiser');
    expect(r.groups[0].options ?? []).toHaveLength(0);
  });

  it('captures INLINE options after a single-ship group header (e.g. Drive Refit)', () => {
    const r = parseNewRecruit(BASE + 'Delhi Battleship [275 pts]: UF-6400 Mass Driver Turrets, Bulk Landers, Drop Pods, Boarding Pods, Drive Refit [45 pts], UF-4200 Mass Driver Turrets (2x UF-4200 Mass Driver Turrets)');
    expect(r.groups[0].name).toBe('Delhi Battleship');
    expect(r.groups[0].pts).toBe(275);
    expect(r.groups[0].options).toContain('Drive Refit');
  });

  it('marks valid when faction and groups present', () => {
    const r = parseNewRecruit(BASE + 'Rio Cruiser [85 pts]');
    expect(r.valid).toBe(true);
  });

  it('marks invalid when no groups', () => {
    const r = parseNewRecruit('UCM\n');
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group parsing — multi-ship groups (bullet sub-lines)
// ---------------------------------------------------------------------------

describe('parseNewRecruit — multi-ship bullets', () => {
  it('parses 2x bullet sub-lines', () => {
    const text = [
      'UCM',
      '## Groups [60 pts]',
      'Toulon Frigates [60 pts]:',
      '• 2x Toulon Frigate [30 pts]: UF-2200 Mass Driver Turret Triad',
    ].join('\n');
    const r = parseNewRecruit(text);
    const group = r.groups.find(g => g.name === 'Toulon Frigate');
    expect(group).toBeDefined();
    expect(group.count).toBe(2);
    expect(group.pts).toBe(30);
  });

  it('parses a 1x bullet sub-line', () => {
    const text = [
      'UCM',
      '## Groups [84 pts]',
      'Bruges Cruisers [84 pts]:',
      '• 1x Bruges Cruiser [84 pts]: Cobra Heavy Laser, Taipan Laser Turrets',
    ].join('\n');
    const r = parseNewRecruit(text);
    const group = r.groups.find(g => g.name === 'Bruges Cruiser');
    expect(group).toBeDefined();
    expect(group.count).toBe(1);
  });

  it('uses ·  (middle dot) as bullet', () => {
    const text = 'UCM\n## Groups [30 pts]\nToulon [30 pts]:\n· 1x Toulon Frigate [30 pts]';
    const r = parseNewRecruit(text);
    expect(r.groups.some(g => g.name === 'Toulon Frigate')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Options — inline after [pts]:
// ---------------------------------------------------------------------------

describe('parseNewRecruit — inline options after pts bracket', () => {
  it('picks up a known inline option', () => {
    const text = 'UCM\n## Groups [100 pts]\nSan Francisco Troopship [100 pts]: UF-4200 Mass Driver Turrets, Bulk Landers';
    const r = parseNewRecruit(text);
    // "Bulk Landers" not in KNOWN_OPTIONS so options should be empty or absent
    expect(r.groups[0].options ?? []).not.toContain('Bulk Landers');
  });

  it('picks up a known option from inline list on a bullet sub-line', () => {
    const text = [
      'UCM',
      '## Groups [135 pts]',
      'Edmonton [135 pts]:',
      '• 1x Edmonton Heavy Carrier [135 pts]: Fighters & Bombers',
    ].join('\n');
    const r = parseNewRecruit(text);
    const g = r.groups.find(g => g.name === 'Edmonton Heavy Carrier');
    expect(g?.options).toContain('Fighters & Bombers');
  });
});

// ---------------------------------------------------------------------------
// Options — indented sub-lines
// ---------------------------------------------------------------------------

describe('parseNewRecruit — option sub-lines', () => {
  it('picks up indented option sub-line', () => {
    const text = [
      'UCM',
      '## Groups [135 pts]',
      'Edmonton Heavy Carrier [135 pts]',
      '  - Fighters & Bombers',
    ].join('\n');
    const r = parseNewRecruit(text);
    expect(r.groups[0].options).toContain('Fighters & Bombers');
  });

  it('ignores indented non-known text', () => {
    const text = [
      'UCM',
      '## Groups [100 pts]',
      'Rio Cruiser [85 pts]',
      '  - Some Unknown Option',
    ].join('\n');
    const r = parseNewRecruit(text);
    expect(r.groups[0].options ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Admiral section
// ---------------------------------------------------------------------------

describe('parseNewRecruit — admiral section', () => {
  it('parses a non-famous admiral level and title', () => {
    const text = [
      'UCM',
      '## Admiral [25 pts]',
      'Lvl 1: Captain [25 pts]',
      '## Groups [85 pts]',
      'Rio Cruiser [85 pts]',
    ].join('\n');
    const r = parseNewRecruit(text);
    expect(r.admirals).toHaveLength(1);
    expect(r.admirals[0]).toMatchObject({ level: 1, title: 'Captain', cost: 25 });
    expect(r.admiralLevel).toBe(1);
  });

  it('reports admiralLevel as max level across all admirals', () => {
    const text = [
      'UCM',
      '## Admiral [45 pts]',
      'Lvl 1: Captain [25 pts]',
      'Lvl 2: Rear Admiral [20 pts]',
      '## Groups [85 pts]',
      'Rio Cruiser [85 pts]',
    ].join('\n');
    const r = parseNewRecruit(text);
    expect(r.admiralLevel).toBe(2);
  });

  it('captures admiral abilities after the pts bracket', () => {
    const text = [
      'UCM',
      '## Admiral [25 pts]',
      'Lvl 1: Captain [25 pts]: Mass Driver Volley',
      '## Groups [85 pts]',
      'Rio Cruiser [85 pts]',
    ].join('\n');
    const r = parseNewRecruit(text);
    expect(r.admirals[0].abilities).toContain('Mass Driver Volley');
  });

  it('parses a famous admiral as a group entry', () => {
    const text = [
      'Resistance',
      '## Famous Admiral',
      'Lvl 2: Typhoon Vasquez - Heavy Cruiser [158 pts]',
      '## Groups [22 pts]',
      'Frigate [22 pts]',
    ].join('\n');
    const r = parseNewRecruit(text);
    const fa = r.groups.find(g => g.isFamousAdmiral);
    expect(fa).toBeDefined();
    expect(fa.name).toBe('Typhoon Vasquez');
    expect(fa.pts).toBe(158);
  });

  it('defaults admiralLevel to 0 when no admirals present', () => {
    const text = 'UCM\n## Groups [85 pts]\nRio Cruiser [85 pts]';
    const r = parseNewRecruit(text);
    expect(r.admiralLevel).toBe(0);
    expect(r.admirals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Secondary objectives
// ---------------------------------------------------------------------------

describe('parseNewRecruit — secondary objectives', () => {
  it('parses secondary objectives from the Game section', () => {
    const text = [
      'UCM',
      '## Groups [85 pts]',
      'Rio Cruiser [85 pts]',
      '## Game',
      'Secondary Objectives: Key Site, Gather Intel',
    ].join('\n');
    const r = parseNewRecruit(text);
    expect(r.secondaries).toContain('key_site');
    expect(r.secondaries).toContain('gather_intel');
  });

  it('deduplicates secondary objectives', () => {
    const text = [
      'UCM',
      '## Groups [85 pts]',
      'Rio Cruiser [85 pts]',
      '## Game',
      'Secondary Objectives: Annihilate, Annihilate',
    ].join('\n');
    const r = parseNewRecruit(text);
    expect(r.secondaries.filter(s => s === 'annihilate')).toHaveLength(1);
  });

  it('ignores unknown secondary labels', () => {
    const text = [
      'UCM',
      '## Groups [85 pts]',
      'Rio Cruiser [85 pts]',
      '## Game',
      'Secondary Objectives: Unknown Objective',
    ].join('\n');
    const r = parseNewRecruit(text);
    expect(r.secondaries).toHaveLength(0);
  });

  it('defaults to empty secondaries when no Game section', () => {
    const r = parseNewRecruit('UCM\n## Groups [85 pts]\nRio Cruiser [85 pts]');
    expect(r.secondaries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('parseNewRecruit — edge cases', () => {
  it('returns invalid for empty string', () => {
    const r = parseNewRecruit('');
    expect(r.valid).toBe(false);
    expect(r.groups).toHaveLength(0);
  });

  it('filters blank lines gracefully', () => {
    const text = '\n\nUCM\n\n## Groups [85 pts]\n\nRio Cruiser [85 pts]\n\n';
    const r = parseNewRecruit(text);
    expect(r.valid).toBe(true);
  });

  it('accepts digit-prefixed lines (2x) as bullets without the dot character', () => {
    const text = 'UCM\n## Groups [60 pts]\nToulon [60 pts]:\n2x Toulon Frigate [30 pts]';
    const r = parseNewRecruit(text);
    expect(r.groups.some(g => g.name === 'Toulon Frigate')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fastplay list integration
// ---------------------------------------------------------------------------

describe('parseNewRecruit — fastplay lists parse correctly', () => {
  for (const [faction, text] of Object.entries(FASTPLAY_LISTS)) {
    it(`${faction} fastplay list is valid`, () => {
      const r = parseNewRecruit(text);
      expect(r.valid).toBe(true);
      expect(r.faction).toBe(faction);
      expect(r.groups.length).toBeGreaterThan(0);
    });
  }

  it('all fastplay groups have a name and positive pts', () => {
    for (const text of Object.values(FASTPLAY_LISTS)) {
      const r = parseNewRecruit(text);
      for (const g of r.groups) {
        expect(g.name).toBeTruthy();
        expect(g.pts).toBeGreaterThan(0);
      }
    }
  });

  it('all fastplay groups have a positive count', () => {
    for (const text of Object.values(FASTPLAY_LISTS)) {
      const r = parseNewRecruit(text);
      for (const g of r.groups) {
        expect(g.count).toBeGreaterThan(0);
      }
    }
  });
});
