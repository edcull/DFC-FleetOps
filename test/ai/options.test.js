import { describe, it, expect } from 'vitest';
import {
  bestMoveToward,
  generatePlanningOptions,
  generateDeployOptions,
  generateDropsiteOptions,
  generateActivationOptions,
  mapLlmOptions,
} from '../../src/ai/options.js';
import { INCH } from '../../src/engine/constants.js';
import { makeState, shipDef, shipInstance, addGroup, weapon } from '../engine/helpers.js';

const BOARD_PX = 48 * INCH;

// ─── bestMoveToward ───────────────────────────────────────────────────────────

describe('bestMoveToward', () => {
  const ship = { x: 200, y: 200, heading: 0 };

  // mc shape: { o: { moveMax }, minR, maxR, turnDeg }
  function mc(max = 72, min = 0, turn = 360) {
    return { o: { moveMax: max }, minR: min, maxR: max, turnDeg: turn };
  }

  it('returns current position when moveMax is 0', () => {
    const result = bestMoveToward(ship, { o: { moveMax: 0 }, minR: 0, maxR: 0, turnDeg: 45 }, 400, 400);
    expect(result).toEqual({ x: ship.x, y: ship.y, heading: ship.heading });
  });

  it('returns current position when mc.o is falsy', () => {
    const result = bestMoveToward(ship, { o: null, minR: 0, maxR: 72, turnDeg: 45 }, 400, 400);
    expect(result).toEqual({ x: ship.x, y: ship.y, heading: ship.heading });
  });

  it('moves toward target when it is in range', () => {
    // target is 50px away directly right; maxR=72 — should end close to target
    const result = bestMoveToward({ x: 100, y: 200, heading: 0 }, mc(72), 150, 200);
    expect(result.x).toBeCloseTo(150, 0);
    expect(result.y).toBeCloseTo(200, 0);
  });

  it('stops at maxR-1 when target is farther than maxR', () => {
    const s = { x: 100, y: 200, heading: 0 };
    const result = bestMoveToward(s, mc(60), 600, 200); // target is 500px away
    const moved = Math.hypot(result.x - s.x, result.y - s.y);
    expect(moved).toBeCloseTo(59, 0); // maxR - 1
  });

  it('clamps turn to turnDeg limit', () => {
    // Ship heading 0 (east), target is due north (+90° turn needed), limit is 45°
    const s = { x: 288, y: 288, heading: 0 };
    const result = bestMoveToward(s, mc(72, 0, 45), 288, 100);
    // Heading must be within 45° of 0 (i.e. somewhere between -45 and +45 from east)
    // Since target is north (heading ~-90°), delta=-90, clamp=-45
    expect(result.heading).toBeCloseTo(-45, 1);
  });

  it('result stays within board margins (2" = 24px)', () => {
    const margin = INCH * 2;
    // Ship at the board corner, trying to move further out
    const corner = { x: margin + 1, y: margin + 1, heading: 225 }; // heading SW
    const result = bestMoveToward(corner, mc(200, 0, 360), 0, 0);
    expect(result.x).toBeGreaterThanOrEqual(margin);
    expect(result.y).toBeGreaterThanOrEqual(margin);
    expect(result.x).toBeLessThanOrEqual(BOARD_PX - margin);
    expect(result.y).toBeLessThanOrEqual(BOARD_PX - margin);
  });

  it('uses minR as a floor on distance moved', () => {
    // Target is very close (5px), minR is 60px — should move at least minR
    const s = { x: 288, y: 288, heading: 0 };
    const result = bestMoveToward(s, mc(120, 60, 360), 290, 288);
    const moved = Math.hypot(result.x - s.x, result.y - s.y);
    expect(moved).toBeGreaterThanOrEqual(59); // minR or close (maxR-1 may cap it too)
  });
});

// ─── generatePlanningOptions ──────────────────────────────────────────────────

describe('generatePlanningOptions', () => {
  it('always returns exactly two options (take / give)', () => {
    const opts = generatePlanningOptions(makeState(), 'player1');
    expect(opts).toHaveLength(2);
    expect(opts[0].action).toBe('take');
    expect(opts[1].action).toBe('give');
  });

  it('take option targets the AI side', () => {
    const opts = generatePlanningOptions(makeState(), 'player1');
    expect(opts[0].to).toBe('player1');
  });

  it('give option targets the opponent', () => {
    const opts1 = generatePlanningOptions(makeState(), 'player1');
    expect(opts1[1].to).toBe('player2');

    const opts2 = generatePlanningOptions(makeState(), 'player2');
    expect(opts2[1].to).toBe('player1');
  });
});

// ─── generateDeployOptions ────────────────────────────────────────────────────

describe('generateDeployOptions', () => {
  it('returns empty array when no off-table ships are eligible', () => {
    const s = makeState();
    s.phase = 'deploy';
    const def = shipDef({ id: 'player1:a', side: 'player1', thrust: 8 });
    addGroup(s, def, [shipInstance({ x: 200, y: 200, offTable: false })]);
    expect(generateDeployOptions(s, 'player1')).toEqual([]);
  });

  it('returns no options for the wrong side', () => {
    const s = makeState();
    s.phase = 'deploy';
    s.deployZone = { player1: 'south', player2: 'north' };
    const def = shipDef({ id: 'player2:x', side: 'player2', thrust: 8 });
    addGroup(s, def, [shipInstance({ offTable: true })]);
    expect(generateDeployOptions(s, 'player1')).toEqual([]);
  });
});

// ─── generateDropsiteOptions ──────────────────────────────────────────────────

describe('generateDropsiteOptions', () => {
  it('returns empty array when dropsiteActivation is absent', () => {
    expect(generateDropsiteOptions(makeState(), 'player1')).toEqual([]);
  });

  it('returns empty array when dropsiteActivation belongs to other side', () => {
    const s = makeState();
    s.dropsiteActivation = { side: 'player2', done: [] };
    expect(generateDropsiteOptions(s, 'player1')).toEqual([]);
  });

  it('returns one entry per non-done dropsite plus a skip option', () => {
    const s = makeState();
    s.dropsiteActivation = { side: 'player1', done: ['ds2'] };
    s.scenarioData = {
      dropsites: [
        { id: 'ds1', base: { name: 'Alpha' }, destroyed: false },
        { id: 'ds2', base: { name: 'Beta'  }, destroyed: false },
        { id: 'ds3', base: { name: 'Gamma' }, destroyed: false },
      ],
    };
    const opts = generateDropsiteOptions(s, 'player1');
    // ds2 is done, ds1 and ds3 remain + skip = 3
    expect(opts).toHaveLength(3);
    const ids = opts.map(o => o.dsId);
    expect(ids).toContain('ds1');
    expect(ids).toContain('ds3');
    expect(ids).toContain(null); // skip
  });

  it('skips destroyed dropsites', () => {
    const s = makeState();
    s.dropsiteActivation = { side: 'player1', done: [] };
    s.scenarioData = {
      dropsites: [
        { id: 'ds1', base: { name: 'A' }, destroyed: true },
        { id: 'ds2', base: { name: 'B' }, destroyed: false },
      ],
    };
    const opts = generateDropsiteOptions(s, 'player1');
    expect(opts.some(o => o.dsId === 'ds1')).toBe(false);
    expect(opts.some(o => o.dsId === 'ds2')).toBe(true);
  });
});

// ─── generateActivationOptions ────────────────────────────────────────────────

describe('generateActivationOptions', () => {
  function playState() {
    const s = makeState();
    s.activeSide = 'player1';
    s.initiative = null;
    return s;
  }

  it('returns empty array when all groups are already activated', () => {
    const s = playState();
    const def = shipDef({ id: 'player1:a', side: 'player1', thrust: 6 });
    addGroup(s, def, [shipInstance({ x: 200, y: 200 })]);
    s.groups['player1:a'].activated = true;
    const opts = generateActivationOptions(s, 'player1');
    // May have a pass option only if isLegal(pass) passes — it won't since no passTokens
    expect(opts.filter(o => o.groupId !== null)).toHaveLength(0);
  });

  it('returns options for an unactivated on-table group', () => {
    const s = playState();
    const p1 = shipDef({ id: 'player1:a', side: 'player1', thrust: 8 });
    const p2 = shipDef({ id: 'player2:b', side: 'player2', thrust: 8 });
    addGroup(s, p1, [shipInstance({ x: 200, y: 200 })]);
    addGroup(s, p2, [shipInstance({ x: 400, y: 400 })]);
    const opts = generateActivationOptions(s, 'player1');
    expect(opts.filter(o => o.groupId !== null).length).toBeGreaterThan(0);
  });

  it('each option has required shape (id, groupId, order, movePlan, weapTargets)', () => {
    const s = playState();
    const p1 = shipDef({ id: 'player1:a', side: 'player1', thrust: 8 });
    addGroup(s, p1, [shipInstance({ x: 200, y: 200 })]);
    const opts = generateActivationOptions(s, 'player1').filter(o => o.groupId);
    for (const opt of opts) {
      expect(opt).toHaveProperty('id');
      expect(opt).toHaveProperty('groupId');
      expect(opt).toHaveProperty('order');
      expect(opt).toHaveProperty('movePlan');
      expect(opt).toHaveProperty('weapTargets');
      expect(Array.isArray(opt.weapTargets)).toBe(true);
    }
  });

  it('never returns more than 8 options', () => {
    const s = playState();
    for (let i = 0; i < 10; i++) {
      const def = shipDef({ id: `player1:${i}`, side: 'player1', thrust: 6, name: `Ship${i}` });
      addGroup(s, def, [shipInstance({ x: 100 + i * 20, y: 200 })]);
    }
    const p2 = shipDef({ id: 'player2:x', side: 'player2', thrust: 6 });
    addGroup(s, p2, [shipInstance({ x: 400, y: 400 })]);
    const opts = generateActivationOptions(s, 'player1');
    expect(opts.length).toBeLessThanOrEqual(8);
  });

  it('skips groups where all ships are destroyed', () => {
    const s = playState();
    const def = shipDef({ id: 'player1:a', side: 'player1', thrust: 6 });
    addGroup(s, def, [shipInstance({ x: 200, y: 200, destroyed: true })]);
    const opts = generateActivationOptions(s, 'player1').filter(o => o.groupId);
    expect(opts).toHaveLength(0);
  });
});

// ─── mapLlmOptions ────────────────────────────────────────────────────────────

describe('mapLlmOptions', () => {
  function llmState() {
    const s = makeState();
    s.activeSide = 'player1';
    const ai  = shipDef({ id: 'player1:a', side: 'player1', thrust: 8, name: 'Odysseus' });
    const ai2 = shipDef({ id: 'player1:b', side: 'player1', thrust: 8, name: 'Leonidas' });
    const opp = shipDef({ id: 'player2:x', side: 'player2', thrust: 8, name: 'Shaltari' });
    addGroup(s, ai,  [shipInstance({ x: 200, y: 200 })]);
    addGroup(s, ai2, [shipInstance({ x: 300, y: 300 })]);
    addGroup(s, opp, [shipInstance({ x: 400, y: 400 })]);
    return s;
  }

  it('returns empty array for empty input', () => {
    expect(mapLlmOptions([], llmState(), 'player1')).toEqual([]);
  });

  it('skips lines with fewer than 2 pipe-separated parts', () => {
    expect(mapLlmOptions(['just text'], llmState(), 'player1')).toEqual([]);
  });

  it('maps a valid A-index line to the correct group', () => {
    const s = llmState();
    const opts = mapLlmOptions(['A1 Odysseus | GQ | advance'], s, 'player1');
    expect(opts).toHaveLength(1);
    expect(opts[0].groupId).toBe('player1:a');
    expect(opts[0].order).toBe('GQ');
  });

  it('falls back to name-substring match when no A-index is given', () => {
    const s = llmState();
    const opts = mapLlmOptions(['Leonidas | WF | engage'], s, 'player1');
    expect(opts).toHaveLength(1);
    expect(opts[0].groupId).toBe('player1:b');
  });

  it('skips lines with an unknown group name', () => {
    const s = llmState();
    const opts = mapLlmOptions(['Nonexistent | GQ | move'], s, 'player1');
    expect(opts).toHaveLength(0);
  });

  it('skips lines with an invalid order', () => {
    const s = llmState();
    const opts = mapLlmOptions(['A1 Odysseus | FIRE | advance'], s, 'player1');
    expect(opts).toHaveLength(0);
  });

  it('skips lines for already-activated groups', () => {
    const s = llmState();
    s.groups['player1:a'].activated = true;
    const opts = mapLlmOptions(['A1 Odysseus | GQ | advance'], s, 'player1');
    expect(opts).toHaveLength(0);
  });

  it('all valid orders are accepted', () => {
    const VALID = ['GQ', 'WF', 'SR', 'CC', 'MT', 'DC'];
    for (const ord of VALID) {
      const s = llmState();
      const opts = mapLlmOptions([`A1 Odysseus | ${ord} | move`], s, 'player1');
      expect(opts).toHaveLength(1);
      expect(opts[0].order).toBe(ord);
    }
  });

  it('strips markdown from group hint', () => {
    const s = llmState();
    const opts = mapLlmOptions(['**Odysseus** | GQ | move'], s, 'player1');
    expect(opts).toHaveLength(1);
    expect(opts[0].groupId).toBe('player1:a');
  });

  it('sets movePlan.reason to "kill" when goal mentions fire/attack', () => {
    const s = llmState();
    const opts = mapLlmOptions(['A1 Odysseus | GQ | fire at enemy'], s, 'player1');
    expect(opts[0].movePlan.reason).toBe('kill');
  });

  it('sets movePlan.reason to "vp" when goal mentions drop', () => {
    const s = llmState();
    s.scenarioData = {
      dropsites: [{ id: 'ds1', base: { name: 'Alpha', layer: 'Orbit' }, destroyed: false, x: 24, y: 12, battalions: {} }],
    };
    const opts = mapLlmOptions(['A1 Odysseus | GQ | drop battalions'], s, 'player1');
    expect(opts[0].movePlan.reason).toBe('vp');
  });

  it('resolves DS1 short-ID from goal text', () => {
    const s = llmState();
    s.scenarioData = {
      dropsites: [
        { id: 'ds1', base: { name: 'Alpha', layer: 'Orbit' }, destroyed: false, x: 24, y: 12, battalions: {} },
      ],
    };
    const opts = mapLlmOptions(['A1 Odysseus | GQ | move toward DS1'], s, 'player1');
    expect(opts[0].movePlan.reason).toBe('vp');
    expect(opts[0].movePlan.x).toBe(24 * INCH);
  });

  it('each mapped option has required fields', () => {
    const s = llmState();
    const opts = mapLlmOptions(['A1 Odysseus | GQ | advance'], s, 'player1');
    const o = opts[0];
    expect(o).toHaveProperty('id');
    expect(o).toHaveProperty('groupId');
    expect(o).toHaveProperty('order');
    expect(o).toHaveProperty('movePlan');
    expect(o).toHaveProperty('movePos');
    expect(o).toHaveProperty('weapTargets');
    expect(o).toHaveProperty('launchPlan');
  });
});
