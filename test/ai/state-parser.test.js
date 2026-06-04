import { describe, it, expect } from 'vitest';
import { buildStateBriefing, buildGroupCapabilities } from '../../src/ai/state-parser.js';
import { makeState, shipDef, shipInstance, addGroup, weapon } from '../engine/helpers.js';
import { INCH } from '../../src/engine/constants.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function briefingState() {
  const s = makeState({ phase: 'play', round: 3 });
  s.score = { player1: { vp: 4, kp: 2 }, player2: { vp: 2, kp: 1 } };
  s.deployZone = { player1: 'south', player2: 'north' };
  s.factions   = { player1: 'ucm', player2: 'shaltari' };
  s.playerNames = { f1: 'Alice', f2: 'Bob' };
  s.scenario   = { objective: 'ground_assault' };

  const ai  = shipDef({ id: 'player1:a', side: 'player1', thrust: 8, scan: 6, sig: 2, tonnage: 'M',
                         name: 'Achilles', weapons: [weapon({ att: 4, lock: '4+', dmg: 2 })] });
  const opp = shipDef({ id: 'player2:b', side: 'player2', thrust: 6, scan: 6, sig: 3, tonnage: 'H',
                         name: 'Void Gate', weapons: [weapon({ att: 3, lock: '5+', dmg: 1 })] });
  addGroup(s, ai,  [shipInstance({ x: 200, y: 400 })]);
  addGroup(s, opp, [shipInstance({ x: 350, y: 200 })]);

  s.scenarioData = {
    dropsites: [
      { id: 'ds1', base: { name: 'Alpha City', layer: 'Atmosphere', size: 'M' },
        destroyed: false, x: 24, y: 20, battalions: {} },
    ],
  };
  return s;
}

// ─── buildStateBriefing ───────────────────────────────────────────────────────

describe('buildStateBriefing', () => {
  it('returns a non-empty string', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(50);
  });

  it('includes the round number in the header', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toContain('Round 3');
  });

  it('includes VP scores for both sides', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toContain('VP 4');
    expect(text).toContain('VP 2');
  });

  it('includes POSITIONS section', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toContain('POSITIONS');
  });

  it('includes DROPSITES section when dropsites exist', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toContain('DROPSITES');
    expect(text).toContain('Alpha City');
  });

  it('includes OPPONENT section', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toContain('OPPONENT');
    expect(text).toContain('Void Gate');
  });

  it('includes YOUR UNACTIVATED SHIPS section', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toContain('YOUR UNACTIVATED SHIPS');
    expect(text).toContain('Achilles');
  });

  it('includes RULES section', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toContain('RULES');
  });

  it('includes the objective in the header', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text.toUpperCase()).toContain('GROUND_ASSAULT');
  });

  it('labels AI groups as A1, A2... and enemy groups as E1, E2...', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toMatch(/\bA1\b/);
    expect(text).toMatch(/\bE1\b/);
  });

  it('labels dropsites as DS1, DS2...', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toMatch(/\bDS1\b/);
  });

  it('shows ship as (all activated) when all AI groups are activated', () => {
    const s = briefingState();
    s.groups['player1:a'].activated = true;
    const text = buildStateBriefing(s, 'player1');
    expect(text).toContain('(all activated)');
  });

  it('shows dropsite as FREE/YOURS/ENEMY based on control', () => {
    const s = briefingState();
    const text = buildStateBriefing(s, 'player1');
    // No battalions placed → dropsiteController returns null → tag 'free'
    expect(text).toMatch(/FREE|free/i);
  });

  it('shows RESERVE for off-table ships', () => {
    const s = briefingState();
    const def = shipDef({ id: 'player1:reserve', side: 'player1', name: 'Hermes', thrust: 10 });
    addGroup(s, def, [shipInstance({ offTable: true })]);
    const text = buildStateBriefing(s, 'player1');
    expect(text).toContain('RESERVE');
  });

  it('works from player2 perspective (roles swap)', () => {
    const text2 = buildStateBriefing(briefingState(), 'player2');
    expect(text2).toContain('YOUR UNACTIVATED SHIPS');
    expect(text2).toContain('Void Gate');
    // Achilles should appear in OPPONENT section from p2's view
    expect(text2).toContain('Achilles');
  });

  it('includes ship thrust, scan, sig in per-ship block', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toMatch(/Thrust:/);
    expect(text).toMatch(/Scan:/);
    expect(text).toMatch(/Sig:/);
  });

  it('mentions deploy zone edges', () => {
    const text = buildStateBriefing(briefingState(), 'player1');
    expect(text).toMatch(/SOUTH|NORTH/i);
  });

  it('handles state with no dropsites gracefully (no DROPSITES section)', () => {
    const s = briefingState();
    s.scenarioData = { dropsites: [] };
    const text = buildStateBriefing(s, 'player1');
    expect(typeof text).toBe('string');
    expect(text).not.toContain('DROPSITES');
  });

  it('shows (none) in the OPPONENT section when all enemy ships are destroyed', () => {
    const s = briefingState();
    s.groups['player2:b'].ships[0].destroyed = true;
    const text = buildStateBriefing(s, 'player1');
    expect(text).toContain('OPPONENT');
    // OPPONENT section should be empty; the group may still appear in the POSITIONS
    // block as (off), but not as an active combatant line in OPPONENT.
    const oppSection = text.split('OPPONENT:')[1]?.split('\n').slice(1, 3).join('\n') ?? '';
    expect(oppSection).toContain('(none)');
  });
});

// ─── buildGroupCapabilities (stub) ────────────────────────────────────────────

describe('buildGroupCapabilities', () => {
  it('returns an empty string (function is stubbed out)', () => {
    const result = buildGroupCapabilities(briefingState(), 'player1');
    expect(result).toBe('');
  });
});
