/**
 * State-factory and scenario-helper tests.
 *
 * Covers createState defaults, the d6→key table lookup, scenario generation
 * (with locked overrides) and the concrete scenario-board build.
 */
import { describe, it, expect } from 'vitest';
import {
  createState, keyByD6, generateScenario, buildScenarioState,
  fleetHasPayloads, payloadAttached,
} from '../../src/engine/state.js';
import { makeRng } from '../../src/engine/rng.js';
import {
  DEPLOYMENTS, APPROACHES, LAYOUTS, VARIANTS, OBJECTIVES,
} from '../../src/engine/constants.js';

describe('createState', () => {
  it('starts in setup at round 1 with empty groups and zeroed score', () => {
    const s = createState();
    expect(s.phase).toBe('setup');
    expect(s.round).toBe(1);
    expect(s.groups).toEqual({});
    expect(s.score).toEqual({
      player1: { vp: 0, kp: 0 },
      player2: { vp: 0, kp: 0 },
    });
  });
  it('seeds default factions and null in-game scaffolding', () => {
    const s = createState();
    expect(s.factions).toEqual({ player1: 'ucm', player2: 'shaltari' });
    expect(s.planning).toBe(null);
    expect(s.attackModal).toBe(null);
    expect(s.activeSide).toBe(null);
    expect(Array.isArray(s.eventLog)).toBe(true);
  });
  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = createState();
    const b = createState();
    a.round = 5;
    a.groups.x = {};
    expect(b.round).toBe(1);
    expect(b.groups).toEqual({});
  });
});

describe('keyByD6', () => {
  it('finds the table key whose d6 matches', () => {
    expect(keyByD6(DEPLOYMENTS, 1)).toBe('line');
    expect(keyByD6(DEPLOYMENTS, 3)).toBe('midboard');
    expect(keyByD6(OBJECTIVES, 1)).toBe('attrition');
    expect(keyByD6(OBJECTIVES, 3)).toBe('extract');
  });
  it('returns undefined when no key matches', () => {
    expect(keyByD6(DEPLOYMENTS, 99)).toBeUndefined();
  });
});

describe('generateScenario', () => {
  it('honours locked overrides exactly', () => {
    const scen = generateScenario(makeRng(1), {
      deployment: 'line', approach: 'spinward', layout: Object.keys(LAYOUTS)[0],
      variant: Object.keys(VARIANTS)[0], objective: 'attrition',
    });
    expect(scen.deployment).toBe('line');
    expect(scen.objective).toBe('attrition');
    expect(scen.layout).toBe(Object.keys(LAYOUTS)[0]);
  });
  it('rolls valid keys for every table when unspecified', () => {
    const scen = generateScenario(makeRng(2024));
    expect(DEPLOYMENTS).toHaveProperty(scen.deployment);
    expect(APPROACHES).toHaveProperty(scen.approach);
    expect(LAYOUTS).toHaveProperty(scen.layout);
    expect(VARIANTS).toHaveProperty(scen.variant);
    expect(OBJECTIVES).toHaveProperty(scen.objective);
  });
  it('is deterministic for a given seed', () => {
    expect(generateScenario(makeRng(7))).toEqual(generateScenario(makeRng(7)));
  });
});

describe('buildScenarioState', () => {
  it('produces a concrete board from a generated scenario', () => {
    const scen = generateScenario(makeRng(123));
    const board = buildScenarioState(scen);
    expect(Array.isArray(board.dropsites)).toBe(true);
    expect(board.placedScenery).toEqual([]);
    expect(board.sceneryTargets).toHaveProperty('micrometeor');
    expect(board.sceneryTargets).toHaveProperty('dense');
    expect(Number.isInteger(board.sceneryTargets.micrometeor)).toBe(true);
    expect(Number.isInteger(board.sceneryTargets.dense)).toBe(true);
  });
  it('initialises each dropsite undamaged with a hull from its base', () => {
    const scen = generateScenario(makeRng(456));
    const board = buildScenarioState(scen);
    board.dropsites.forEach(ds => {
      expect(ds.damage).toBe(0);
      expect(ds.maxHull).toBe(ds.base.hull);
      expect(typeof ds.x).toBe('number');
      expect(typeof ds.y).toBe('number');
    });
  });
});

describe('payload helpers', () => {
  it('only the Bioficer fleet carries payloads', () => {
    expect(fleetHasPayloads('bioficer')).toBe(true);
    expect(fleetHasPayloads('ucm')).toBe(false);
    expect(fleetHasPayloads(undefined)).toBe(false);
  });
  it('payloadAttached reflects the attachedTo link', () => {
    expect(payloadAttached({ attachedTo: { gid: 'g', si: 0 } })).toBe(true);
    expect(payloadAttached({ attachedTo: null })).toBe(false);
    expect(payloadAttached({})).toBe(false);
  });
});
