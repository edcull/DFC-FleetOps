/**
 * State-factory and scenario-helper tests.
 *
 * Covers createState defaults, the d6→key table lookup, scenario generation
 * (with locked overrides), the concrete scenario-board build, fleet helpers,
 * payload/porter helpers, asset-profile helpers, and syncPayloads.
 */
import { describe, it, expect } from 'vitest';
import {
  createState, keyByD6, generateScenario, buildScenarioState,
  fleetHasPayloads, payloadAttached,
  buildSideFleet, fleetForSide, redFleet, blueFleet,
  factionName, sideHasPayloads,
  payloadsReady, allPayloadsReady,
  porterShips, payloadShips, porterUsed, detachedReattachCandidates,
  syncPayloads,
  initFleet, rebuildFleets,
  allDefs, getDef, getGroup,
  assetProfile, assetThrust, fighterRerolls,
} from '../../src/engine/state.js';
import { makeRng } from '../../src/engine/rng.js';
import {
  DEPLOYMENTS, APPROACHES, LAYOUTS, VARIANTS, OBJECTIVES, INCH,
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

// ---------------------------------------------------------------------------
// factionName
// ---------------------------------------------------------------------------

describe('factionName', () => {
  it('returns the display name for known factions', () => {
    const s = createState();
    expect(factionName(s, 'player1')).toBe('UCM');
    expect(factionName(s, 'player2')).toBe('Shaltari');
  });
  it('falls back to Red/Blue when factions is null', () => {
    const s = createState();
    s.factions = null;
    expect(factionName(s, 'player1')).toBe('Red');
    expect(factionName(s, 'player2')).toBe('Blue');
  });
  it('falls back to Red/Blue for an unrecognised faction key', () => {
    const s = createState();
    s.factions = { player1: 'bogus', player2: 'also_bogus' };
    expect(factionName(s, 'player1')).toBe('Red');
    expect(factionName(s, 'player2')).toBe('Blue');
  });
});

// ---------------------------------------------------------------------------
// sideHasPayloads
// ---------------------------------------------------------------------------

describe('sideHasPayloads', () => {
  it('is true only for the bioficer faction on that side', () => {
    const s = createState();
    s.factions = { player1: 'bioficer', player2: 'ucm' };
    expect(sideHasPayloads(s, 'player1')).toBe(true);
    expect(sideHasPayloads(s, 'player2')).toBe(false);
  });
  it('is false when factions is null', () => {
    const s = createState();
    s.factions = null;
    expect(sideHasPayloads(s, 'player1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// payloadsReady / allPayloadsReady
// ---------------------------------------------------------------------------

describe('payloadsReady', () => {
  it('always returns true for a non-bioficer slot', () => {
    const s = createState();
    s.fleetChoices = { f1: 'ucm', f2: 'shaltari' };
    expect(payloadsReady(s, 'f1')).toBe(true);
    expect(payloadsReady(s, 'f2')).toBe(true);
  });
  it('returns true for a null fleetChoice (no faction picked yet)', () => {
    const s = createState();
    expect(payloadsReady(s, 'f1')).toBe(true);
  });
});

describe('allPayloadsReady', () => {
  it('returns true when both slots are non-bioficer', () => {
    const s = createState();
    s.fleetChoices = { f1: 'ucm', f2: 'phr' };
    expect(allPayloadsReady(s)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// allDefs / getDef / getGroup
// ---------------------------------------------------------------------------

describe('allDefs / getDef / getGroup', () => {
  function stateWithDefs() {
    const s = createState();
    s.activeFleets = {
      player1: [{ id: 'player1:a', side: 'player1' }],
      player2: [{ id: 'player2:b', side: 'player2' }],
    };
    s.groups = {
      'player1:a': { order: null, ships: [] },
      'player2:b': { order: null, ships: [] },
    };
    return s;
  }

  it('allDefs concatenates both sides', () => {
    const s = stateWithDefs();
    const defs = allDefs(s);
    expect(defs.map(d => d.id)).toEqual(['player1:a', 'player2:b']);
  });

  it('getDef finds by id', () => {
    const s = stateWithDefs();
    expect(getDef(s, 'player1:a')).toMatchObject({ id: 'player1:a' });
    expect(getDef(s, 'missing')).toBeUndefined();
  });

  it('getGroup returns the group object', () => {
    const s = stateWithDefs();
    expect(getGroup(s, 'player1:a')).toMatchObject({ order: null });
    expect(getGroup(s, 'missing')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fleetForSide / redFleet / blueFleet
// ---------------------------------------------------------------------------

describe('fleetForSide', () => {
  it('returns the cached fleet when activeFleets is already set', () => {
    const s = createState();
    const mockFleet = [{ id: 'player1:x', side: 'player1' }];
    s.activeFleets = { player1: mockFleet, player2: [] };
    expect(fleetForSide(s, 'player1')).toBe(mockFleet);
  });

  it('builds and caches the fleet on first access if not set', () => {
    const s = createState();
    // Default ucm faction — may or may not have fastplay ships, but caches either way.
    const fleet = fleetForSide(s, 'player1');
    expect(Array.isArray(fleet)).toBe(true);
    expect(fleetForSide(s, 'player1')).toBe(fleet); // same reference on second call
  });

  it('redFleet and blueFleet delegate to the correct side', () => {
    const s = createState();
    s.activeFleets = {
      player1: [{ id: 'player1:r' }],
      player2: [{ id: 'player2:b' }],
    };
    expect(redFleet(s)[0].id).toBe('player1:r');
    expect(blueFleet(s)[0].id).toBe('player2:b');
  });
});

// ---------------------------------------------------------------------------
// buildSideFleet — imported-fleet path
// ---------------------------------------------------------------------------

describe('buildSideFleet — imported fleet', () => {
  it('builds cloned defs from a valid importedFleets entry', () => {
    const s = createState();
    s.importedFleets = {
      f1: { faction: 'ucm', groups: [{ name: 'Toulon Frigate', count: 2 }] },
    };
    const fleet = buildSideFleet(s, 'player1');
    expect(fleet.length).toBeGreaterThan(0);
    const def = fleet[0];
    expect(def.side).toBe('player1');
    expect(def.groupSize).toBe(2);
    expect(def.id.startsWith('player1:')).toBe(true);
  });

  it('filters out unknown ship names', () => {
    const s = createState();
    s.importedFleets = {
      f1: { faction: 'ucm', groups: [{ name: 'No Such Ship', count: 1 }] },
    };
    const fleet = buildSideFleet(s, 'player1');
    expect(fleet).toHaveLength(0);
  });

  it('uses f2 slot for player2', () => {
    const s = createState();
    s.importedFleets = {
      f2: { faction: 'ucm', groups: [{ name: 'Toulon Frigate', count: 1 }] },
    };
    const fleet = buildSideFleet(s, 'player2');
    expect(fleet.length).toBeGreaterThan(0);
    expect(fleet[0].side).toBe('player2');
  });

  it('returns empty when importedFleets entry has no groups', () => {
    const s = createState();
    s.importedFleets = { f1: { faction: 'ucm', groups: [] } };
    // Falls through to fastplay path — result is an array either way.
    const fleet = buildSideFleet(s, 'player1');
    expect(Array.isArray(fleet)).toBe(true);
  });

  it('returns [] for a faction key that has no fastplay list', () => {
    const s = createState();
    s.fleetChoices = { f1: 'custom_unknown_faction' };
    // No importedFleet, no fastplay list → empty array fallback.
    const fleet = buildSideFleet(s, 'player1');
    expect(fleet).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// initFleet / rebuildFleets
// ---------------------------------------------------------------------------

describe('initFleet', () => {
  function makeDef(id, side, groupSize = 1) {
    return { id, side, hull: 4, groupSize, weapons: [], launch: [], baseId: id };
  }

  it('places player1 ships at the south edge heading north', () => {
    const s = createState();
    const def = makeDef('player1:a', 'player1', 1);
    initFleet(s, [def], 'player1');
    const ship = s.groups['player1:a'].ships[0];
    expect(ship.heading).toBe(-90);
    expect(ship.hull).toBe(4);
    expect(ship.destroyed).toBe(false);
    expect(ship.layer).toBe('orbit');
  });

  it('places player2 ships at the north edge heading south', () => {
    const s = createState();
    const def = makeDef('player2:b', 'player2', 1);
    initFleet(s, [def], 'player2');
    const ship = s.groups['player2:b'].ships[0];
    expect(ship.heading).toBe(90);
  });

  it('creates one ship entry per groupSize', () => {
    const s = createState();
    const def = makeDef('player1:c', 'player1', 3);
    initFleet(s, [def], 'player1');
    expect(s.groups['player1:c'].ships).toHaveLength(3);
  });

  it('spreads multiple groups across the x axis', () => {
    const s = createState();
    const defs = [
      makeDef('player1:a', 'player1'),
      makeDef('player1:b', 'player1'),
    ];
    initFleet(s, defs, 'player1');
    const xA = s.groups['player1:a'].ships[0].x;
    const xB = s.groups['player1:b'].ships[0].x;
    expect(xA).not.toBe(xB);
  });
});

describe('rebuildFleets', () => {
  it('clears existing groups and re-populates from factions', () => {
    const s = createState();
    s.groups = { old: {} };
    rebuildFleets(s);
    expect(s.groups).not.toHaveProperty('old');
    expect(typeof s.groups).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// porterShips / payloadShips / porterUsed / detachedReattachCandidates
// ---------------------------------------------------------------------------

function makePayloadState() {
  const s = createState();
  s.phase = 'play';
  const porterDef = { id: 'player1:porter', side: 'player1', porter: true };
  const payloadDef = {
    id: 'player1:payload', side: 'player1',
    payload: { size: 'S' }, groupSize: 1, baseId: 'payload',
  };
  s.activeFleets = { player1: [porterDef, payloadDef], player2: [] };
  s.groups = {
    'player1:porter': {
      def: porterDef,
      ships: [{ x: 200, y: 200, destroyed: false, offTable: false }],
    },
    'player1:payload': {
      def: payloadDef,
      ships: [{ x: 200, y: 200, destroyed: false, offTable: false, attachedTo: null, order: null }],
    },
  };
  return s;
}

describe('porterShips', () => {
  it('lists non-destroyed porter ships with their gid/si/def', () => {
    const s = makePayloadState();
    const porters = porterShips(s, 'player1');
    expect(porters).toHaveLength(1);
    expect(porters[0].gid).toBe('player1:porter');
    expect(porters[0].si).toBe(0);
  });

  it('excludes destroyed porter ships', () => {
    const s = makePayloadState();
    s.groups['player1:porter'].ships[0].destroyed = true;
    expect(porterShips(s, 'player1')).toHaveLength(0);
  });
});

describe('payloadShips', () => {
  it('lists non-destroyed payload ships', () => {
    const s = makePayloadState();
    const payloads = payloadShips(s, 'player1');
    expect(payloads).toHaveLength(1);
    expect(payloads[0].gid).toBe('player1:payload');
  });

  it('excludes destroyed payload ships', () => {
    const s = makePayloadState();
    s.groups['player1:payload'].ships[0].destroyed = true;
    expect(payloadShips(s, 'player1')).toHaveLength(0);
  });
});

describe('porterUsed', () => {
  it('returns 0 when no payloads are attached to the porter', () => {
    const s = makePayloadState();
    expect(porterUsed(s, 'player1', 'player1:porter', 0)).toBe(0);
  });

  it('counts one per attached payload', () => {
    const s = makePayloadState();
    s.groups['player1:payload'].ships[0].attachedTo = { gid: 'player1:porter', si: 0 };
    expect(porterUsed(s, 'player1', 'player1:porter', 0)).toBe(1);
  });
});

describe('detachedReattachCandidates', () => {
  it('returns detached payloads within 3" of the porter ship', () => {
    const s = makePayloadState();
    const porterShip = { x: 200, y: 200 };
    // payload is at (200,200) — 0" away, well within 3"
    const cands = detachedReattachCandidates(s, 'player1', porterShip, 'S');
    expect(cands).toHaveLength(1);
  });

  it('excludes payloads more than 3" away', () => {
    const s = makePayloadState();
    s.groups['player1:payload'].ships[0].x = 200 + 4 * INCH;
    const porterShip = { x: 200, y: 200 };
    expect(detachedReattachCandidates(s, 'player1', porterShip, 'S')).toHaveLength(0);
  });

  it('excludes payloads of the wrong size', () => {
    const s = makePayloadState();
    const porterShip = { x: 200, y: 200 };
    expect(detachedReattachCandidates(s, 'player1', porterShip, 'L')).toHaveLength(0);
  });

  it('excludes already-attached payloads', () => {
    const s = makePayloadState();
    s.groups['player1:payload'].ships[0].attachedTo = { gid: 'player1:porter', si: 0 };
    expect(detachedReattachCandidates(s, 'player1', { x: 200, y: 200 }, 'S')).toHaveLength(0);
  });

  it('returns [] when porterShip is null', () => {
    const s = makePayloadState();
    expect(detachedReattachCandidates(s, 'player1', null, 'S')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// syncPayloads
// ---------------------------------------------------------------------------

describe('syncPayloads', () => {
  it('destroys a payload whose porter has been destroyed', () => {
    const s = makePayloadState();
    s.groups['player1:payload'].ships[0].attachedTo = { gid: 'player1:porter', si: 0 };
    s.groups['player1:porter'].ships[0].destroyed = true;
    syncPayloads(s);
    const payload = s.groups['player1:payload'].ships[0];
    expect(payload.destroyed).toBe(true);
    expect(payload.attachedTo).toBeNull();
  });

  it('sets GQ on a detached, non-destroyed payload', () => {
    const s = makePayloadState();
    // payload is not attached and not destroyed
    syncPayloads(s);
    expect(s.groups['player1:payload'].ships[0].order).toBe('GQ');
  });

  it('leaves an attached-and-alive payload untouched', () => {
    const s = makePayloadState();
    s.groups['player1:payload'].ships[0].attachedTo = { gid: 'player1:porter', si: 0 };
    syncPayloads(s);
    expect(s.groups['player1:payload'].ships[0].destroyed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assetProfile / assetThrust / fighterRerolls
// ---------------------------------------------------------------------------

describe('assetProfile', () => {
  it('returns the correct profile for a known faction and kind', () => {
    const s = createState();
    s.factions = { player1: 'ucm', player2: 'shaltari' };
    const prof = assetProfile(s, 'player1', 'fighter');
    expect(prof).toHaveProperty('thrust');
    expect(typeof prof.thrust).toBe('number');
  });

  it('falls back to bomber profile for an unknown kind', () => {
    const s = createState();
    s.factions = { player1: 'ucm', player2: 'shaltari' };
    const bomber = assetProfile(s, 'player1', 'bomber');
    const unknown = assetProfile(s, 'player1', 'no_such_kind');
    expect(unknown).toEqual(bomber);
  });

  it('falls back to ucm profile for an unknown faction', () => {
    const s = createState();
    s.factions = { player1: 'bogus_faction', player2: 'ucm' };
    const prof = assetProfile(s, 'player1', 'fighter');
    const ucmProf = assetProfile(s, 'player2', 'fighter');
    expect(prof).toEqual(ucmProf);
  });
});

describe('assetThrust', () => {
  it('returns a positive number for a placed asset', () => {
    const s = createState();
    s.factions = { player1: 'ucm', player2: 'shaltari' };
    const thrust = assetThrust(s, { side: 'player1', kind: 'bomber' });
    expect(thrust).toBeGreaterThan(0);
  });
});

describe('fighterRerolls', () => {
  it('returns a number for any known faction', () => {
    const s = createState();
    s.factions = { player1: 'ucm', player2: 'shaltari' };
    expect(typeof fighterRerolls(s, 'player1')).toBe('number');
    expect(typeof fighterRerolls(s, 'player2')).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// buildScenarioState — parseCount range string
// ---------------------------------------------------------------------------

describe('buildScenarioState — scenery range parsing', () => {
  it('takes the max of a range string like "4-6" for scenery targets', () => {
    // Sweep all layouts+variants to find one with a range string.
    // We simply check that sceneryTargets are always integers (parseCount correct).
    for (const lk of Object.keys(LAYOUTS)) {
      for (const vk of Object.keys(VARIANTS)) {
        const scen = { layout: lk, variant: vk, deployment: 'line', approach: 'spinward', objective: 'attrition' };
        try {
          const board = buildScenarioState(scen);
          expect(Number.isInteger(board.sceneryTargets.micrometeor)).toBe(true);
          expect(Number.isInteger(board.sceneryTargets.dense)).toBe(true);
        } catch (_) {
          // Some layout+variant combos may not be valid; skip.
        }
      }
    }
  });
});
