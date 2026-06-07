import { describe, it, expect } from 'vitest';
import { gateRunnerPlan, gateMotherPlan, generateActivationOptions } from '../../src/ai/options.js';
import { handlePreGame } from '../../src/ai/handlers/pregame.js';
import { buildActivation } from '../../src/ai/translator.js';
import { evaluate } from '../../src/ai/evaluate.js';
import { PERSONALITIES } from '../../src/ai/personalities.js';
import { makeState, shipDef, shipInstance, addGroup, fixedRng, weapon } from '../engine/helpers.js';
import { isLegal } from '../../src/engine/gating.js';
import { apply } from '../../src/engine/mutators.js';
import { INCH } from '../../src/engine/constants.js';

// A Voidgate (Gateship) group on the given layer at (x,y).
function gateState(layer, x, y, ds) {
  const s = makeState();
  s.scenarioData = { dropsites: [ds] };
  const def = shipDef({ id: 'player1:vg', side: 'player1', name: 'Voidgate',
                        thrust: 12, openNetwork: true, gateship: 2, weapons: [] });
  addGroup(s, def, [shipInstance({ x, y, layer })]);
  return s;
}

describe('gateRunnerPlan — descent to cities', () => {
  // A city sits in Atmosphere, so an Orbit gate MUST descend to channel a drop there.
  const city = { id: 'ds1', type: 'large_city', x: 10, y: 10, base: { layer: 'Atmosphere' } };
  const station = { id: 'ds2', type: 'medium_station', x: 10, y: 10, base: { layer: 'Orbit' } };
  const cx = 10 * INCH, cy = 10 * INCH;

  it('parks (CC) and descends when within ½-Thrust of a city', () => {
    // ½ Thrust = 6" = 72px. Place the gate 60px south of the city.
    const s = gateState('orbit', cx, cy + 60, city);
    const plan = gateRunnerPlan(s, 'player1:vg', 'player1');
    expect(plan.order).toBe('CC');
    expect(plan.toggle).toBe(true);
  });

  it('descends on the GQ approach when the city is reachable this move (≤ full Thrust)', () => {
    // Full Thrust = 12" = 144px; place the gate 100px away (> ½, ≤ full).
    const s = gateState('orbit', cx, cy + 100, city);
    const plan = gateRunnerPlan(s, 'player1:vg', 'player1');
    expect(plan.order).toBe('GQ');
    expect(plan.toggle).toBe(true);
  });

  it('stays fast in Orbit (no descent) while the city is beyond one move', () => {
    const s = gateState('orbit', cx, cy + 200, city); // 200px > full Thrust
    const plan = gateRunnerPlan(s, 'player1:vg', 'player1');
    expect(plan.order).toBe('GQ');
    expect(plan.toggle).toBe(false);
  });

  it('does NOT toggle layer for an Orbit station (no descent needed)', () => {
    const s = gateState('orbit', cx, cy + 60, station);
    const plan = gateRunnerPlan(s, 'player1:vg', 'player1');
    expect(plan.order).toBe('CC');
    expect(plan.toggle).toBe(false);
  });
});

describe('gateMotherPlan — city channel (previously impossible)', () => {
  it('channels a drop on a city when a connected gate has descended within 3"', () => {
    const s = makeState();
    const city = { id: 'ds1', type: 'large_city', x: 10, y: 10, base: { layer: 'Atmosphere' } };
    s.scenarioData = { dropsites: [city] };
    const cx = 10 * INCH, cy = 10 * INCH;

    // Voidgate descended into Atmosphere, parked ~2" from the city (within the 3" channel).
    const gate = shipDef({ id: 'player1:vg', side: 'player1', name: 'Voidgate',
                           thrust: 12, openNetwork: true, gateship: 2, weapons: [] });
    addGroup(s, gate, [shipInstance({ x: cx + 2 * INCH, y: cy, layer: 'atmosphere' })]);
    s.groups['player1:vg'].order = 'CC'; // CC keeps the gateship in the network

    // Mothership in Orbit, within the 18" network of the gate.
    const mother = shipDef({ id: 'player1:em', side: 'player1', name: 'Emerald', thrust: 10,
                            launch: [{ name: 'Dropships', n: 4, type: 'gate_dropship' }] });
    addGroup(s, mother, [shipInstance({ x: cx + 4 * INCH, y: cy, layer: 'orbit' })]);

    const plan = gateMotherPlan(s, 'player1:em', 'player1');
    expect(plan).toBeTruthy();
    expect(plan.launch).toBeTruthy();
    expect(plan.launch.dsId).toBe('ds1');     // the CITY
    expect(plan.launch.type).toBe('gate_dropship');
  });
});

describe('buildActivation — formation discipline', () => {
  // A 2-ship L-tonnage group (coherency 3") pointing the same way (as a group that's been
  // moving together would), offset laterally by `sep`. On GQ the ½-Thrust forced move + 45°
  // turn cap flings such ships apart; the AI should use Course Change (0" minimum) to hold or
  // regroup instead.
  function twoShipState(sep, { x = 200, y = 200, heading = 90 } = {}) {
    const s = makeState();
    s.activeSide = 'player1';
    s.scenarioData = { dropsites: [] };
    const def = shipDef({ id: 'player1:fr', side: 'player1', name: 'Frigate', tonnage: 'L',
                          thrust: 10, weapons: [] });
    addGroup(s, def, [
      shipInstance({ x, y, heading }),
      shipInstance({ x: x + sep, y, heading }),
    ]);
    return s;
  }
  function applier(s, rng) {
    return (intent) => { if (!isLegal(s, intent, 'player1')) return false; apply(s, intent, rng); return true; };
  }
  const dist = (g) => Math.hypot(g.ships[0].x - g.ships[1].x, g.ships[0].y - g.ships[1].y);
  function newRound(grp, s) {
    grp.activated = false; grp.order = null;
    grp.ships.forEach(sh => { sh.movedThisRound = false; sh.firedThisActivation = false; });
    s.aiming = null; s.vectoredSecondMove = null;
  }

  it('switches an out-of-coherency group to Course Change', () => {
    const s = twoShipState(8 * INCH); // 8" apart, coherency 3" → out of formation
    buildActivation(s, fixedRng(3), 'player1:fr', 'GQ', { x: 248, y: 200, reason: 'hold' }, 'player1', applier(s, fixedRng(3)));
    expect(s.groups['player1:fr'].order).toBe('CC');
  });

  it('regroups a broken group back into coherency within two activations', () => {
    const s = twoShipState(8 * INCH);
    const grp = s.groups['player1:fr'];
    for (let r = 0; r < 2; r++) {
      newRound(grp, s);
      buildActivation(s, fixedRng(3), 'player1:fr', 'GQ', { x: 248, y: 200, reason: 'hold' }, 'player1', applier(s, fixedRng(3)));
    }
    expect(dist(grp)).toBeLessThanOrEqual(3 * INCH + 1); // back inside the 3" band
  });

  it('uses Course Change to hold a coherent group near its target (no GQ scatter)', () => {
    // Coherent (2" apart) with a target inside the GQ forced ½-Thrust move → would overshoot.
    const s = twoShipState(2 * INCH);
    buildActivation(s, fixedRng(3), 'player1:fr', 'GQ', { x: 213, y: 205, reason: 'hold' }, 'player1', applier(s, fixedRng(3)));
    expect(s.groups['player1:fr'].order).toBe('CC');
    expect(dist(s.groups['player1:fr'])).toBeLessThanOrEqual(3 * INCH); // stayed coherent
  });

  it('leaves a coherent group on GQ when the target is genuinely distant (still advances)', () => {
    const s = twoShipState(2 * INCH, { x: 200, y: 500, heading: -90 });
    const grp = s.groups['player1:fr'];
    const y0 = grp.ships[0].y;
    buildActivation(s, fixedRng(3), 'player1:fr', 'GQ', { x: 212, y: 100, reason: 'vp' }, 'player1', applier(s, fixedRng(3)));
    expect(grp.order).toBe('GQ');                       // not overridden — advancing
    expect(grp.ships[0].y).toBeLessThan(y0 - 5 * INCH); // actually moved a long way
  });
});

describe('generateActivationOptions — order variety', () => {
  const offered = (s) => [...new Set(generateActivationOptions(s, 'player1').filter(o => o.groupId).map(o => o.order))];

  it('offers Weapons Free when a target is in range', () => {
    const s = makeState(); s.activeSide = 'player1'; s.scenarioData = { dropsites: [] };
    addGroup(s, shipDef({ id: 'player1:a', side: 'player1', scan: 10, weapons: [weapon({ arc: 'F', att: 4, lock: '4+' })] }),
             [shipInstance({ x: 200, y: 200, heading: 0 })]);
    addGroup(s, shipDef({ id: 'player2:b', side: 'player2' }), [shipInstance({ x: 260, y: 200, heading: 180 })]);
    expect(offered(s)).toContain('WF');
  });

  it('offers Damage Control for a damaged group with nothing to shoot', () => {
    const s = makeState(); s.activeSide = 'player1'; s.scenarioData = { dropsites: [] };
    addGroup(s, shipDef({ id: 'player1:a', side: 'player1', hull: 6, weapons: [weapon({ arc: 'F' })] }),
             [Object.assign(shipInstance({ x: 200, y: 200, heading: 0 }), { maxHull: 6, hull: 2 })]);
    addGroup(s, shipDef({ id: 'player2:b', side: 'player2' }), [shipInstance({ x: 500, y: 500 })]);
    expect(offered(s)).toContain('DC');
  });

  it('offers Max Thrust to sprint toward a distant objective with no targets', () => {
    const s = makeState(); s.activeSide = 'player1';
    s.scenarioData = { dropsites: [{ id: 'ds1', base: {}, x: 46, y: 46, destroyed: false, battalions: {} }] };
    addGroup(s, shipDef({ id: 'player1:a', side: 'player1', thrust: 8, weapons: [weapon({ arc: 'F' })] }),
             [shipInstance({ x: 50, y: 50, heading: 0 })]);
    addGroup(s, shipDef({ id: 'player2:b', side: 'player2' }), [shipInstance({ x: 560, y: 560 })]);
    expect(offered(s)).toContain('MT');
  });
});

describe('handlePreGame — secondary nomination', () => {
  function nomState() {
    const s = makeState();
    s.phase = 'nominations';
    s.deployZone = { player1: 'south', player2: 'north' };
    s.secondaries = { player1: ['key_site', 'priority_target'], player2: [] };
    s.secondaryNominations = { player1: {}, player2: {} };
    s.nominationsReady = { player1: false, player2: false };
    s.scenarioData = { dropsites: [
      { id: 'dsA', type: 'large_station', base: { name: 'Alpha', size: 'large' }, x: 24, y: 6,  destroyed: false, battalions: {} },
      { id: 'dsB', type: 'large_station', base: { name: 'Bravo', size: 'large' }, x: 24, y: 22, destroyed: false, battalions: {} },
    ] };
    return s;
  }
  const ap = (s) => (i) => {
    if (i.type === 'setNomination') (s.secondaryNominations[i.side] ||= {})[i.key] = i.nom;
    if (i.type === 'confirmNominations') s.nominationsReady[i.side] = true;
    return true;
  };

  it('nominates DIFFERENT dropsites for key_site and priority_target (no double-booking)', () => {
    const s = nomState();
    handlePreGame(s, () => 0.5, 'player1', ap(s));
    const noms = s.secondaryNominations.player1;
    expect(noms.key_site.dsId).not.toBe(noms.priority_target.dsId);
    expect(s.nominationsReady.player1).toBe(true);
  });

  it('picks the more holdable site (nearer our own zone) for key_site', () => {
    const s = nomState();
    handlePreGame(s, () => 0.5, 'player1', ap(s));
    // player1 deploys south; dsB (y=22) is nearer our zone than dsA (y=6) → better to hold.
    expect(s.secondaryNominations.player1.key_site.dsId).toBe('dsB');
  });
});

describe('evaluate — secondary objective nudge', () => {
  it('scores higher when the nominated key_site is controlled', () => {
    function base() {
      const s = makeState();
      s.secondaries = { player1: ['key_site'], player2: [] };
      s.secondaryNominations = { player1: { key_site: { dsId: 'ds1' } }, player2: {} };
      s.scenarioData = { dropsites: [{ id: 'ds1', x: 24, y: 24, base: {}, destroyed: false, battalions: { ground: { player1: 0, player2: 0 } } }] };
      addGroup(s, shipDef({ id: 'player1:a', side: 'player1' }), [Object.assign(shipInstance({ x: 100, y: 100 }), { maxHull: 6, hull: 6 })]);
      addGroup(s, shipDef({ id: 'player2:b', side: 'player2' }), [Object.assign(shipInstance({ x: 500, y: 500 }), { maxHull: 6, hull: 6 })]);
      return s;
    }
    const uncontrolled = base();
    const controlled = base();
    controlled.scenarioData.dropsites[0].battalions.ground.player1 = 4; // player1 now controls ds1
    expect(evaluate(controlled, 'player1')).toBeGreaterThan(evaluate(uncontrolled, 'player1'));
  });
});

describe('evaluate — personality weighting', () => {
  // State where we wiped half the opponent while staying at full hull.
  function killState() {
    const s = makeState();
    s.scenarioData = { dropsites: [] };
    addGroup(s, shipDef({ id: 'player1:a', side: 'player1' }),
             [shipInstance({ hull: 10, x: 100, y: 100 })]);
    Object.assign(s.groups['player1:a'].ships[0], { maxHull: 10, hull: 10 });
    addGroup(s, shipDef({ id: 'player2:b', side: 'player2' }), [
      Object.assign(shipInstance({ x: 400, y: 400 }), { maxHull: 10, hull: 10 }),
      Object.assign(shipInstance({ x: 420, y: 400, destroyed: true }), { maxHull: 10, hull: 0 }),
    ]);
    return s;
  }
  // State where nothing has happened — everyone at full hull.
  function safeState() {
    const s = makeState();
    s.scenarioData = { dropsites: [] };
    addGroup(s, shipDef({ id: 'player1:a', side: 'player1' }),
             [Object.assign(shipInstance({ x: 100, y: 100 }), { maxHull: 10, hull: 10 })]);
    addGroup(s, shipDef({ id: 'player2:b', side: 'player2' }), [
      Object.assign(shipInstance({ x: 400, y: 400 }), { maxHull: 10, hull: 10 }),
      Object.assign(shipInstance({ x: 420, y: 400 }), { maxHull: 10, hull: 10 }),
    ]);
    return s;
  }

  it('aggressive values a kill-trade more than defensive does', () => {
    const kill = killState(), safe = safeState();
    const aggrGain = evaluate(kill, 'player1', PERSONALITIES.aggressive.weights)
                   - evaluate(safe, 'player1', PERSONALITIES.aggressive.weights);
    const defGain  = evaluate(kill, 'player1', PERSONALITIES.defensive.weights)
                   - evaluate(safe, 'player1', PERSONALITIES.defensive.weights);
    expect(aggrGain).toBeGreaterThan(defGain);
  });

  it('returns a value in [0,1] with and without weights', () => {
    const s = killState();
    for (const w of [null, PERSONALITIES.defensive.weights, PERSONALITIES.aggressive.weights]) {
      const v = evaluate(s, 'player1', w);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
