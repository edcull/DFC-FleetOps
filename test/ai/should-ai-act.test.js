import { describe, it, expect } from 'vitest';
import { shouldAiAct } from '../../src/ai/index.js';
import { makeState, shipDef, shipInstance, addGroup } from '../engine/helpers.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function playState(overrides = {}) {
  const s = makeState({ phase: 'play', ...overrides });
  s.planning = { ap: { player1: 5, player2: 5 }, passTokens: { player1: 0, player2: 0 } };
  return s;
}

// ─── Pre-game phases ──────────────────────────────────────────────────────────

describe('shouldAiAct — scenery phase', () => {
  it('returns true when AI has not committed scenery', () => {
    const s = makeState({ phase: 'scenery' });
    s.sceneryReady = {};
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });

  it('returns false when AI has already committed scenery', () => {
    const s = makeState({ phase: 'scenery' });
    s.sceneryReady = { player1: true };
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });

  it('does not block the other side', () => {
    const s = makeState({ phase: 'scenery' });
    s.sceneryReady = { player1: true };
    expect(shouldAiAct(s, 'player2')).toBe(true);
  });
});

describe('shouldAiAct — nominations phase', () => {
  it('returns true when AI has not submitted nominations', () => {
    const s = makeState({ phase: 'nominations' });
    s.nominationsReady = {};
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });

  it('returns false when AI has submitted nominations', () => {
    const s = makeState({ phase: 'nominations' });
    s.nominationsReady = { player1: true };
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });
});

describe('shouldAiAct — protect phase', () => {
  it('returns true when AI has not submitted protect nomination', () => {
    const s = makeState({ phase: 'protect' });
    s.protectNomReady = {};
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });

  it('returns false when AI has submitted protect nomination', () => {
    const s = makeState({ phase: 'protect' });
    s.protectNomReady = { player1: true };
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });
});

// ─── Non-play / unknown phases ────────────────────────────────────────────────

describe('shouldAiAct — non-play phases', () => {
  it('returns false for setup phase', () => {
    const s = makeState({ phase: 'setup' });
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });

  it('returns false for end phase', () => {
    const s = makeState({ phase: 'end' });
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });
});

// ─── Deploy phase ─────────────────────────────────────────────────────────────

describe('shouldAiAct — deploy phase', () => {
  it('returns false when the side has already called deployDone', () => {
    const s = makeState({ phase: 'deploy' });
    s.deployDone.player1 = true;
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });

  it('returns true for player1 when ships still need deploying', () => {
    const s = makeState({ phase: 'deploy' });
    // player1 always allowed first; with no ships placed, needs to call deployDone
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });
});

// ─── Play phase ───────────────────────────────────────────────────────────────

describe('shouldAiAct — play / idle', () => {
  it('returns false when nothing needs AI attention', () => {
    const s = playState({ activeSide: 'player2' });
    s.initiative = null;
    s.attackModal = null;
    s.repairPhase = null;
    s.battalionCombat = null;
    s.assetPhase = null;
    s.dropsiteActivation = null;
    s.atmoDamage = null;
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });
});

describe('shouldAiAct — atmoDamage', () => {
  it('returns true when atmoDamage belongs to AI side', () => {
    const s = playState();
    s.atmoDamage = { side: 'player1' };
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });

  it('returns false when atmoDamage belongs to the other side', () => {
    const s = playState();
    s.atmoDamage = { side: 'player2' };
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });
});

describe('shouldAiAct — attackModal save step', () => {
  it('returns true for the defender when step is save', () => {
    const s = playState({ activeSide: 'player1' });
    s.attackModal = { step: 'save', saveResult: { hitsList: [] }, bomberSide: null };
    // activeSide=player1 → attacker=player1 → defender=player2
    expect(shouldAiAct(s, 'player2')).toBe(true);
  });

  it('returns false for the attacker when step is save', () => {
    const s = playState({ activeSide: 'player1' });
    s.attackModal = { step: 'save', saveResult: null, bomberSide: null };
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });

  it('uses bomberSide to determine attacker when present', () => {
    const s = playState({ activeSide: 'player1' });
    s.attackModal = { step: 'save', saveResult: null, bomberSide: 'player2' };
    // bomber is player2 → defender is player1
    expect(shouldAiAct(s, 'player1')).toBe(true);
    expect(shouldAiAct(s, 'player2')).toBe(false);
  });

  it('returns true for the ATTACKER at a non-save step so it resumes after the save', () => {
    // After the defender drives the save, the modal advances to a non-save attacker step
    // (e.g. 'done'/'select'); the attacker (here player1) must resume and finish the attack,
    // otherwise the game stalls on "ATTACK RESOLVED" waiting for the AI.
    const s = playState({ activeSide: 'player1' });
    for (const step of ['done', 'select', 'crippling', 'explosion']) {
      s.attackModal = { step, saveResult: null, bomberSide: null };
      expect(shouldAiAct(s, 'player1')).toBe(true);  // attacker resumes
      expect(shouldAiAct(s, 'player2')).toBe(false); // defender idle
    }
  });

  it('derives the attacker from attackerGid when activeSide is null', () => {
    const s = playState({ activeSide: null });
    addGroup(s, shipDef({ id: 'player2:atk', side: 'player2' }), [shipInstance({ x: 200, y: 200 })]);
    s.attackModal = { step: 'done', saveResult: null, bomberSide: null, attackerGid: 'player2:atk' };
    expect(shouldAiAct(s, 'player2')).toBe(true);  // orphaned modal — attacker still finishes
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });
});

describe('shouldAiAct — repairPhase', () => {
  it('returns false during repairPhase (handled client-side)', () => {
    const s = playState({ activeSide: 'player1' });
    s.repairPhase = { side: 'player1' };
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });
});

describe('shouldAiAct — battalionCombat', () => {
  it('returns true when battalionCombat is active (any side)', () => {
    const s = playState();
    s.battalionCombat = { some: 'data' };
    expect(shouldAiAct(s, 'player1')).toBe(true);
    expect(shouldAiAct(s, 'player2')).toBe(true);
  });
});

describe('shouldAiAct — assetPhase', () => {
  it('returns true when it is the AI side asset turn', () => {
    const s = playState();
    s.assetPhase = { step: 'assets', doneSides: [] };
    s.assetActiveSide = 'player1';
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });

  it('returns false when it is the opponent asset turn', () => {
    const s = playState();
    s.assetPhase = { step: 'assets', doneSides: [] };
    s.assetActiveSide = 'player2';
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });

  it('returns false when assetPhase step is not "assets"', () => {
    const s = playState();
    s.assetPhase = { step: 'dogfight', doneSides: [] };
    s.assetActiveSide = 'player1';
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });

  it('returns true when assetActiveSide is null and AI has not called done', () => {
    const s = playState();
    s.assetPhase = { step: 'assets', doneSides: ['player2'] };
    s.assetActiveSide = null;
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });

  it('returns false when assetActiveSide is null and AI is already in doneSides', () => {
    const s = playState();
    s.assetPhase = { step: 'assets', doneSides: ['player1'] };
    s.assetActiveSide = null;
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });
});

describe('shouldAiAct — dropsiteActivation', () => {
  it('returns true when dropsiteActivation side matches AI', () => {
    const s = playState();
    s.dropsiteActivation = { side: 'player1' };
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });

  it('returns false when dropsiteActivation belongs to opponent', () => {
    const s = playState();
    s.dropsiteActivation = { side: 'player2' };
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });
});

describe('shouldAiAct — activeSide with pending activation', () => {
  it('returns true when AI is activeSide and has an on-table unactivated group', () => {
    const s = playState({ activeSide: 'player1' });
    const def = shipDef({ id: 'player1:a', side: 'player1' });
    addGroup(s, def, [shipInstance({ x: 200, y: 200 })]);
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });

  it('returns false when AI is activeSide but all groups are activated', () => {
    const s = playState({ activeSide: 'player1' });
    const def = shipDef({ id: 'player1:a', side: 'player1' });
    addGroup(s, def, [shipInstance({ x: 200, y: 200 })]);
    s.groups['player1:a'].activated = true;
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });

  it('returns true when AI is activeSide and holds a pass token', () => {
    const s = playState({ activeSide: 'player1' });
    s.planning.passTokens.player1 = 1;
    // No unactivated groups
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });
});

describe('shouldAiAct — initiative planning', () => {
  it('returns true when AI won initiative and has not assigned holder', () => {
    const s = playState({ activeSide: null });
    s.initiative = { winner: 'player1', holder: null };
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });

  it('returns false when opponent won initiative', () => {
    const s = playState({ activeSide: null });
    s.initiative = { winner: 'player2', holder: null };
    expect(shouldAiAct(s, 'player1')).toBe(false);
  });

  it('returns true when AI holds initiative and activeSide is not yet set', () => {
    const s = playState({ activeSide: null });
    s.initiative = { winner: 'player2', holder: 'player1' };
    expect(shouldAiAct(s, 'player1')).toBe(true);
  });

  it('returns false when AI holds initiative but activeSide is already set', () => {
    const s = playState({ activeSide: 'player1' });
    s.initiative = { winner: 'player2', holder: 'player1' };
    // activeSide already set — no longer in the planning gate
    // (activation check might fire instead if groups exist; with no groups, falls through)
    const def = shipDef({ id: 'player1:a', side: 'player1' });
    addGroup(s, def, [shipInstance()]);
    // Has pending activation via activeSide — returns true for different reason
    // Just verify planning gate alone when no groups:
    const s2 = playState({ activeSide: 'player2' });
    s2.initiative = { winner: 'player2', holder: 'player1' };
    expect(shouldAiAct(s2, 'player1')).toBe(false);
  });
});
