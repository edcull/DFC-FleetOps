/**
 * Test helpers: minimal state builder, deterministic RNG, ship/weapon fixtures.
 *
 * Design: inject defs via state.activeFleets so getDef(state, id) resolves
 * without touching the faction/fleet build system.
 */
import { createState } from '../../src/engine/state.js';

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/**
 * Returns an RNG that yields the given die faces in sequence.
 * The engine uses Math.ceil(rng() * 6) to get a d6 face, so we back-calculate
 * x such that Math.ceil(x * 6) === face:  x = (face - 1 + ε) / 6 works.
 * After the sequence is exhausted the last value repeats.
 */
export function seqRng(...faces) {
  const seq = faces.flat();
  let i = 0;
  return () => {
    const face = seq[Math.min(i++, seq.length - 1)];
    return (face - 0.0001) / 6;   // Math.ceil(x * 6) === face
  };
}

/** Always rolls the given face on every call. */
export function fixedRng(face) { return seqRng(face); }

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

export function makeState(overrides = {}) {
  const s = createState();
  s.phase = 'play';
  s.round = 1;
  s.planning = { ap: { player1: 5, player2: 5 }, passTokens: { player1: 0, player2: 0 } };
  s.score    = { player1: { vp: 0, kp: 0 }, player2: { vp: 0, kp: 0 } };
  s.activeFleets = { player1: [], player2: [] };
  return Object.assign(s, overrides);
}

// ---------------------------------------------------------------------------
// Def / ship factories
// ---------------------------------------------------------------------------

export function shipDef({ id, side = 'player1', hull = 6, es = '5+', ks = '6+',
                          bs = null, sig = 1, scan = 6, tonnage = 'L',
                          special = '', weapons = [], name = 'Test Ship',
                          pts = 50, ...rest } = {}) {
  return { id, name, side, tonnage, hull, sig, scan, es, ks, bs, special, weapons,
           launch: [], pts, groupSize: 1, baseId: id, faction: 'ucm', ...rest };
}

export function shipInstance({ hull = 6, x = 200, y = 200, spikes = 0,
                               crippling = [], fireTokens = 0, ...rest } = {}) {
  return { hull, maxHull: hull, x, y, heading: 0, spikes, destroyed: false,
           offTable: false, movedThisRound: false, firedThisActivation: false,
           launchedThisRound: 0, crippling, fireTokens, sigSilent: false, ...rest };
}

/**
 * Register a def+ships group in state so getDef and state.groups both work.
 */
export function addGroup(state, def, ships = [shipInstance({ hull: def.hull ?? 6 })]) {
  // Inject into activeFleets so getDef(state, id) finds it.
  const fleet = state.activeFleets[def.side] || [];
  if (!fleet.find(d => d.id === def.id)) fleet.push(def);
  state.activeFleets[def.side] = fleet;

  state.groups[def.id] = {
    def,
    activated: false,
    order: null,
    spikes: 0,
    moveTrail: [],
    leadShipIdx: 0,
    ships,
  };
  return def.id;
}

// ---------------------------------------------------------------------------
// Weapon / shot / modal factories
// ---------------------------------------------------------------------------

export function weapon({ name = 'Test Weapon', arc = 'F', att = 4, lock = '4+',
                         dmg = 1, type = 'K', special = '' } = {}) {
  return { name, arc, att, lock, dmg, type, special };
}

export function shot(targetGid, targetSi, w, extras = {}) {
  return { wi: 0, w, targetGid, targetSi, ...extras };
}

export function makeModal(attackerGid, shots, extras = {}) {
  return {
    bomber: false,
    attackerGid,
    attackerSi: 0,
    groupFire: true,
    shots,
    step: 'intro',
    shotIdx: 0,
    shieldsUp: {},
    log: [],
    pendingDamage: {},
    hitResult: null,
    saveResult: null,
    crippleQueue: [],
    explodeQueue: [],
    rerollN: null,
    fighterSpend: {},
    overcharge: {},
    ...extras,
  };
}
