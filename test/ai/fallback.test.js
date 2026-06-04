import { describe, it, expect } from 'vitest';
import { chooseOption, scorePlanning } from '../../src/ai/fallback.js';
import { PERSONALITIES } from '../../src/ai/personalities.js';
import { makeState, shipDef, shipInstance, addGroup, weapon } from '../engine/helpers.js';
import { INCH } from '../../src/engine/constants.js';

const BOARD_PX = 48 * INCH;

// ─── helpers ─────────────────────────────────────────────────────────────────

function minState() {
  const s = makeState();
  s.activeSide = 'player1';
  return s;
}

function opt(id, groupId = 'grp', movePos = { x: BOARD_PX / 2, y: BOARD_PX / 2 }) {
  return { id, groupId, movePos, weapTargets: [], order: 'GQ', movePlan: null };
}

// ─── chooseOption ─────────────────────────────────────────────────────────────

describe('chooseOption', () => {
  it('returns null for an empty options array', () => {
    expect(chooseOption([], minState(), 'player1', PERSONALITIES.balanced)).toBeNull();
  });

  it('returns the sole option when only one exists', () => {
    const o = opt('a');
    const result = chooseOption([o], minState(), 'player1', PERSONALITIES.balanced);
    expect(result).toBe(o);
  });

  it('prefers option with weapon targets over pass (no groupId)', () => {
    const state = minState();
    const def1 = shipDef({ id: 'player1:a', side: 'player1', weapons: [weapon({ att: 4, lock: '4+', dmg: 2 })] });
    const def2 = shipDef({ id: 'player2:b', side: 'player2', hull: 6 });
    addGroup(state, def1, [shipInstance({ x: 200, y: 200 })]);
    addGroup(state, def2, [shipInstance({ x: 300, y: 300 })]);

    const passOpt  = { id: 'pass', groupId: null, movePos: null, weapTargets: [], order: null };
    const fightOpt = {
      id: 'fight', groupId: 'player1:a', movePos: { x: 300, y: 300 },
      weapTargets: [{ wi: 0, targetGid: 'player2:b', targetSi: 0 }],
      order: 'WF',
    };

    const result = chooseOption([passOpt, fightOpt], state, 'player1', PERSONALITIES.balanced);
    expect(result).toBe(fightOpt);
  });

  it('pass option (groupId=null) scores -1, so any real action beats it', () => {
    const state = minState();
    const def = shipDef({ id: 'player1:a', side: 'player1' });
    addGroup(state, def, [shipInstance({ x: 200, y: 200 })]);

    const passOpt = { id: 'pass', groupId: null, movePos: null, weapTargets: [], order: null };
    const realOpt = opt('real', 'player1:a', { x: 200, y: 200 });

    const result = chooseOption([passOpt, realOpt], state, 'player1', PERSONALITIES.balanced);
    expect(result).toBe(realOpt);
  });

  it('aggressive personality scores kill higher than positional', () => {
    // Set up a scenario with weapon targets so kill potential dominates.
    const state = minState();
    const def1 = shipDef({ id: 'player1:a', side: 'player1', weapons: [weapon({ att: 4, lock: '4+', dmg: 2 })] });
    const def2 = shipDef({ id: 'player2:b', side: 'player2', hull: 6 });
    addGroup(state, def1, [shipInstance({ x: 200, y: 200 })]);
    addGroup(state, def2, [shipInstance({ x: 220, y: 220, hull: 1 })]);

    // killOpt: has weapon targets pointing at a crippled enemy
    const killOpt = {
      id: 'kill', groupId: 'player1:a',
      movePos: { x: 220, y: 220 },
      weapTargets: [{ wi: 0, targetGid: 'player2:b', targetSi: 0 }],
      order: 'WF',
    };
    // vpOpt: moves toward multiple dropsites to guarantee a high VP gain for positional
    state.scenarioData = {
      dropsites: [
        { id: 'ds1', base: {}, x: 10, y: 10, destroyed: false, battalions: {} },
        { id: 'ds2', base: {}, x: 11, y: 10, destroyed: false, battalions: {} },
        { id: 'ds3', base: {}, x: 10, y: 11, destroyed: false, battalions: {} },
      ],
    };
    const vpDef = shipDef({ id: 'player1:dropper', side: 'player1', launch: [{ type: 'bulk_lander', n: 1 }] });
    addGroup(state, vpDef, [shipInstance({ x: 100, y: 100 })]);
    const vpOpt = {
      id: 'vp', groupId: 'player1:dropper',
      movePos: { x: 10 * INCH, y: 10 * INCH },
      weapTargets: [],
      order: 'GQ',
    };

    const aggressiveResult  = chooseOption([vpOpt, killOpt], state, 'player1', PERSONALITIES.aggressive);
    const positionalResult  = chooseOption([vpOpt, killOpt], state, 'player1', PERSONALITIES.positional);

    // aggressive strongly favours kill; positional strongly favours vp
    expect(aggressiveResult).toBe(killOpt);
    expect(positionalResult).toBe(vpOpt);
  });
});

// ─── scorePlanning ────────────────────────────────────────────────────────────

describe('scorePlanning', () => {
  it('returns true when AI VP equals opponent VP (take initiative when tied)', () => {
    const s = minState();
    s.score = { player1: { vp: 3, kp: 0 }, player2: { vp: 3, kp: 0 } };
    expect(scorePlanning(s, 'player1')).toBe(true);
  });

  it('returns true when AI VP is ahead', () => {
    const s = minState();
    s.score = { player1: { vp: 5, kp: 0 }, player2: { vp: 2, kp: 0 } };
    expect(scorePlanning(s, 'player1')).toBe(true);
  });

  it('returns false when AI VP is behind', () => {
    const s = minState();
    s.score = { player1: { vp: 1, kp: 0 }, player2: { vp: 4, kp: 0 } };
    expect(scorePlanning(s, 'player1')).toBe(false);
  });

  it('works from player2 perspective', () => {
    const s = minState();
    s.score = { player1: { vp: 3, kp: 0 }, player2: { vp: 5, kp: 0 } };
    expect(scorePlanning(s, 'player2')).toBe(true);
    expect(scorePlanning(s, 'player1')).toBe(false);
  });

  it('defaults missing scores to 0 (tied → true)', () => {
    const s = makeState();
    s.score = {};
    expect(scorePlanning(s, 'player1')).toBe(true);
  });
});
