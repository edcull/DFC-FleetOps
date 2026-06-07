import { describe, it, expect } from 'vitest';
import { gateRunnerPlan, gateMotherPlan } from '../../src/ai/options.js';
import { evaluate } from '../../src/ai/evaluate.js';
import { PERSONALITIES } from '../../src/ai/personalities.js';
import { makeState, shipDef, shipInstance, addGroup } from '../engine/helpers.js';
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
