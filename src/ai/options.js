// AI option generator — produces activation-level choices for the fallback scorer.
// Does NOT call legalActions() (which only covers pass/endRound/commitScenario).
// Instead generates candidates and validates each with isLegal().

import { ORDERS, INCH, DEPLOYMENTS } from '../engine/constants.js';
import { isLegal } from '../engine/gating.js';
import { moveCone, weaponCanTarget, dropsiteController, canDeployNow, isInZone, connectedGateships } from '../engine/mutators.js';

const BOARD_PX = 48 * INCH;
const TONNAGE_ORDER = { C: 0, H: 1, M: 2, L: 3 };

// ── Deployment-zone geometry ────────────────────────────────────────────────
// Deploy/arrival legality (the in-zone constraint) is NOT enforced by gating —
// it's a setup rule the UI self-enforces. The AI must respect it too, else it
// deploys/arrives illegally outside its zone.

// The deployment zone geometry (inches) for a side, or null if unconstrained.
export function deployZoneFor(state, side) {
  const dep = DEPLOYMENTS[state?.scenario?.deployment];
  const zoneName = state?.deployZone?.[side] || (side === 'player1' ? 'south' : 'north');
  return dep?.zones?.[zoneName] || null;
}

// Nearest in-zone position (px) to a preferred px point. Returns the preferred
// point unchanged when it's already legal (or when there's no zone), otherwise
// grid-samples the board and returns the closest legal cell. null if the zone
// somehow contains no sampled point.
export function legalZonePosPx(zone, preferXpx, preferYpx) {
  if (!zone) return { x: preferXpx, y: preferYpx };
  const pxIn = preferXpx / INCH, pyIn = preferYpx / INCH;
  if (isInZone(pxIn, pyIn, zone)) return { x: preferXpx, y: preferYpx };
  let best = null, bestD = Infinity;
  for (let xi = 0.5; xi < 48; xi += 0.75) {
    for (let yi = 0.5; yi < 48; yi += 0.75) {
      if (!isInZone(xi, yi, zone)) continue;
      const d = (xi - pxIn) ** 2 + (yi - pyIn) ** 2;
      if (d < bestD) { bestD = d; best = { x: Math.round(xi * INCH), y: Math.round(yi * INCH) }; }
    }
  }
  return best;
}

// Ship base diameter (px) by tonnage — matches the engine's shipBaseRadiusPx.
const BASE_DIAM_IN = { L: 30 / 25.4, M: 40 / 25.4, H: 50 / 25.4, C: 60 / 25.4 };
export function baseDiameterPx(def) { return (BASE_DIAM_IN[def?.tonnage] || 30 / 25.4) * INCH; }

// A position near (anchorX, anchorY), inside `zone`, whose base (diameter diamPx) does
// not overlap any already-placed base in `placed` ([{x, y, r}], r = base radius px).
// Ships dropped on the same spot get shoved into a "conga line" by the engine's overlap
// resolver, so the AI must space them itself. Grid-searches for the nearest clear,
// in-zone spot. The engine flags overlap when centre distance < rA + rB (sum of radii),
// so clearance must be measured against EACH neighbour's own radius — a small ship placed
// at its own diameter from a big ship still overlaps the big ship's larger base.
export function placeNonOverlap(anchorX, anchorY, placed, diamPx, zone) {
  // Use a tiny board margin so candidates can reach right up to an edge-line zone (those
  // hug the table edge). A larger margin would push every candidate out of zone — the
  // engine/client treat a ship as in-zone by its CENTRE (isInZone, 0.6" tolerance) and
  // let the base overhang the edge, so we must match that, not place by base contact.
  const m = 3;
  const rNew = diamPx / 2;
  const cX = v => Math.max(m, Math.min(BOARD_PX - m, v));
  const cY = v => Math.max(m, Math.min(BOARD_PX - m, v));
  // In-zone exactly as the game judges it: the ship's centre must satisfy isInZone.
  const inZone = (x, y) => !zone || isInZone(x / INCH, y / INCH, zone);
  // Need centre-distance ≥ rNew + neighbour radius (+1px slack past the engine's overlap
  // test). Fall back to rNew for legacy callers that pass bare {x,y} (same-size assumption).
  const clear = (x, y) => placed.every(p => Math.hypot(x - p.x, y - p.y) >= rNew + (p.r ?? rNew) + 1) && inZone(x, y);
  const ax = cX(anchorX), ay = cY(anchorY);
  if (clear(ax, ay)) return { x: ax, y: ay };
  // Grid-search the NEAREST clear, in-zone spot to the anchor. A dense grid (rather than
  // rings) is needed because edge-line zones are a thin strip — most ring angles fall
  // outside it. Choosing the nearest clear spot (not the most-separated one) keeps a
  // group's ships clustered near their own anchor/centroid so they stay in COHERENCY —
  // the anchor is the group centroid for follow-on ships — while the radius-aware `clear`
  // test still guarantees no base overlaps the conga-line resolver would shove apart.
  // If the zone is too packed for any clear spot, fall back to the in-zone point with the
  // largest neighbour gap (least overlap).
  const sepTo = (x, y) => placed.length
    ? Math.min(...placed.map(p => Math.hypot(x - p.x, y - p.y) - (p.r ?? rNew)))
    : Infinity;
  const step = 2;
  let best = null, bestDist = Infinity;   // nearest fully-clear spot
  let fb = null, fbSep = -Infinity;       // fallback: least-overlapping spot
  for (let x = m; x <= BOARD_PX - m; x += step) {
    for (let y = m; y <= BOARD_PX - m; y += step) {
      if (!inZone(x, y)) continue;
      if (clear(x, y)) {
        const d = (x - ax) ** 2 + (y - ay) ** 2;
        if (d < bestDist) { bestDist = d; best = { x, y }; }
      } else if (!best) {
        const sep = sepTo(x, y);
        if (sep > fbSep) { fbSep = sep; fb = { x, y }; }
      }
    }
  }
  return best || fb || { x: ax, y: ay };
}

// Ground-asset launch ranges (inches). gate_dropship needs the Voidgate network
// (handled separately in the activation handler), so it's excluded here.
const LAUNCH_RANGE = { dropship: 3, bulk_lander: 6, drop_pod: 6 };
const NO_LAUNCH_ORDERS = new Set(['MT', 'DC']);

function defIsDropper(def) {
  return !!def && (def.launch || []).some(l => LAUNCH_RANGE[l.type] != null);
}
// Shaltari Mothership: drops battalions by channelling through a connected Voidgate
// (Gateship) parked within 3" of the target dropsite — it doesn't approach the dropsite
// itself. defIsGateMother flags the launcher; defIsVoidgate flags the gates.
function defIsGateMother(def) {
  return !!def && (def.launch || []).some(l => l.type === 'gate_dropship');
}
function defIsVoidgate(def) { return !!def && (def.gateship || 0) > 0; }

// Relative VP value of a dropsite by size, so the gate network prefers the richer
// objectives (a Large City scores more than a Medium Station).
function dsVpValue(ds) {
  const t = ds.type || '';
  if (/large/.test(t)) return 3;
  if (/small/.test(t)) return 1;
  return 2; // medium / unknown
}

// One shared gate objective for the whole Shaltari force: the most valuable contestable
// dropsite, tie-broken by proximity to an on-table Mothership (so Voidgates and Motherships
// converge on the SAME dropsite and keep the 18" network intact instead of scattering).
// Cities ARE included: a Voidgate descends to Atmosphere to channel a city drop (the
// gate-runner plan handles the descent), so they are not skipped — they're usually the
// highest-value objectives on the board.
function gateObjective(state, aiSide) {
  const all = (state.scenarioData?.dropsites || []).filter(d => !d.destroyed && dropsiteController(d) !== aiSide);
  if (!all.length) return null;
  const mothers = [];
  for (const g of Object.values(state.groups)) {
    if (g.def?.side !== aiSide || !(g.def?.launch || []).some(l => l.type === 'gate_dropship')) continue;
    for (const s of g.ships) if (!s.destroyed && !s.offTable) mothers.push(s);
  }
  let best = null, bestScore = -Infinity;
  for (const ds of all) {
    const dIn = mothers.length
      ? Math.min(...mothers.map(m => dist2d(m.x, m.y, ds.x * INCH, ds.y * INCH))) / INCH
      : 0; // no Mothership on table yet — value decides, ties by dropsite order
    // Value dominates; proximity (board ≈ 48") is only a tie-breaker.
    const score = dsVpValue(ds) - dIn / 48;
    if (score > bestScore) { bestScore = score; best = ds; }
  }
  return best;
}

// Drive a Voidgate to PARK within 3" of its objective dropsite so a connected Mothership
// can channel a drop through it. Two crucial details:
//  1. Layer: the gate must share the dropsite's orbital layer to channel. A CITY sits in
//     Atmosphere, so the gate must DESCEND (layerToggle) — it lands in Atmosphere on the
//     approach move that reaches the city. A Space Station is in Orbit, so no descent.
//  2. Order discipline: a fast gate on General Quarters has a forced ½-Thrust *minimum*
//     move, so close-in it overshoots and orbits the dropsite. Course Change (min move 0,
//     two 45° turns) lets it stop exactly on target and HOLD. So: approach fast (GQ) while
//     far, switch to CC to park (and hold) once within ½-Thrust reach.
// Returns { order, x, y, toggle } | null. `toggle` requests a layer change on this move.
export function gateRunnerPlan(state, gid, aiSide) {
  const grp = state.groups[gid];
  const def = grp?.def;
  if (!def || !def.openNetwork || !(def.gateship > 0)) return null;
  const si = grp.ships.findIndex(s => !s.destroyed && !s.offTable);
  if (si < 0) return null;
  const ship = grp.ships[si];
  const obj = gateObjective(state, aiSide);
  if (!obj) return null;
  const ox = obj.x * INCH, oy = obj.y * INCH;
  const objLayer = obj.base?.layer === 'Atmosphere' ? 'atmosphere' : 'orbit';
  const curLayer = ship.layer || 'orbit';
  const dist = dist2d(ship.x, ship.y, ox, oy);
  const thrustPx = (def.thrust || 12) * INCH;
  const halfThrustPx = 0.5 * thrustPx;
  const needDescend = curLayer === 'orbit' && objLayer === 'atmosphere';
  const needAscend  = curLayer === 'atmosphere' && objLayer === 'orbit';

  // On station (within Course-Change reach, ½ Thrust) → park precisely on the dropsite
  // (min move 0 lands on target and holds on later rounds). Match the dropsite's layer on
  // this final move if we aren't already there.
  if (dist <= halfThrustPx + 1) return { order: 'CC', x: ox, y: oy, toggle: needDescend || needAscend };
  // Closing the gap → General Quarters covers up to full Thrust toward the dropsite. Only
  // descend on the move that can actually reach the city, so the gate isn't stranded in
  // Atmosphere (capped to 2"/turn) far from its objective; stay fast in Orbit until then.
  const descendNow = needDescend && dist <= thrustPx + 1;
  return { order: 'GQ', x: ox, y: oy, toggle: descendNow };
}

// Drive a Mothership to keep the 18" channel to the forward gate and CHANNEL a drop the
// moment a connected gate is parked within 3" of a contestable dropsite. MCTS treats the
// Mothership as a combat ship and lets it wander into enemy guns, so script it: hold-and-launch
// when the drop is live; otherwise hang BACK toward our own edge — the carrier channels from up
// to 18" away, so it never needs to approach the front, and keeping it safe denies the enemy an
// easy ~115pt kill (which historically lost Shaltari the game). Returns { order, x, y, launch? } | null.
export function gateMotherPlan(state, gid, aiSide) {
  const grp = state.groups[gid];
  const def = grp?.def;
  if (!def || !(def.launch || []).some(l => l.type === 'gate_dropship')) return null;
  const si = grp.ships.findIndex(s => !s.destroyed && !s.offTable);
  if (si < 0) return null;
  const ship = grp.ships[si];
  const dss = (state.scenarioData?.dropsites || [])
    .filter(d => !d.destroyed && dropsiteController(d) !== aiSide);
  if (!dss.length) return null;
  // A connected gate already within 3" of a contestable dropsite (on the gate's layer →
  // cities included once a gate has descended) → hold position and launch.
  const launch = gateLaunchPlan(state, grp, ship, aiSide);
  if (launch) return { order: 'CC', x: ship.x, y: ship.y, launch };
  // Otherwise: stay safe. Anchor on the forward gate (nearest connected gate to a contestable
  // dropsite) but sit ~15" BEHIND it toward our own deployment edge — far enough back to keep
  // the carrier out of the firefight while still holding the 18" chain so it can channel.
  let fwd = null, fbest = Infinity;
  for (const g of Object.values(state.groups)) {
    if (g.def?.side !== aiSide || !g.def?.openNetwork) continue;
    for (const s of g.ships) {
      if (s.destroyed || s.offTable) continue;
      const nd = Math.min(...dss.map(d => dist2d(s.x, s.y, d.x * INCH, d.y * INCH)));
      if (nd < fbest) { fbest = nd; fwd = s; }
    }
  }
  if (!fwd) return null;
  // Direction toward our own board edge (away from the enemy line).
  const zone = state.deployZone?.[aiSide];
  const edgeY = zone === 'north' ? 0 : zone === 'south' ? BOARD_PX : (aiSide === 'player1' ? BOARD_PX : 0);
  const backDir = edgeY < fwd.y ? -1 : 1;
  const KEEP_PX = 15 * INCH; // 15" behind the forward gate — inside the 18" chain with margin
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const tx = clamp(fwd.x, INCH * 2, BOARD_PX - INCH * 2);
  const ty = clamp(fwd.y + backDir * KEEP_PX, INCH * 2, BOARD_PX - INCH * 2);
  const d = dist2d(ship.x, ship.y, tx, ty);
  const order = d <= 0.5 * (def.thrust || 10) * INCH + 1 ? 'CC' : 'GQ';
  return { order, x: tx, y: ty };
}
// { li, dsId, count, type:'gate_dropship' } | null. The Mothership needn't move — it just
// needs to stay in the 18" Voidgate network.
function gateLaunchPlan(state, grp, ship, aiSide) {
  if (!ship) return null;
  const launches = grp.def?.launch || [];
  const li = launches.findIndex(l => l.type === 'gate_dropship');
  if (li < 0) return null;
  const gates = connectedGateships(state, aiSide, ship.x, ship.y);
  if (!gates.length) return null;
  const dropsites = (state.scenarioData?.dropsites || [])
    .filter(d => !d.destroyed && dropsiteController(d) !== aiSide);
  for (const ds of dropsites) {
    const dsLayer = ds.base?.layer === 'Atmosphere' ? 'atmosphere' : 'orbit';
    const ok = gates.some(g => (g.layer || 'orbit') === dsLayer
      && dist2d(g.x, g.y, ds.x * INCH, ds.y * INCH) <= 3 * INCH + 1);
    if (ok) return { li, dsId: ds.id, count: launches[li].n, type: 'gate_dropship' };
  }
  return null;
}

// Plan to drop battalions at the nearest contestable dropsite this group can reach
// (launch range + a move's worth of slack). Returns { li, dsId, count, type } | null.
function dropLaunchPlan(state, grp, ship, aiSide) {
  if (!ship) return null;
  const launches = grp.def?.launch || [];
  const dropsites = state.scenarioData?.dropsites || [];
  for (let li = 0; li < launches.length; li++) {
    const l = launches[li];
    const r = LAUNCH_RANGE[l.type];
    if (r == null) continue;
    const rangePx = (r + 10) * INCH; // launch range + ~one move
    const ds = dropsites
      .filter(d => !d.destroyed && dropsiteController(d) !== aiSide)
      .filter(d => dist2d(ship.x, ship.y, d.x * INCH, d.y * INCH) <= rangePx)
      .sort((a, b) => dist2d(ship.x, ship.y, a.x * INCH, a.y * INCH) - dist2d(ship.x, ship.y, b.x * INCH, b.y * INCH))[0];
    if (ds) return { li, dsId: ds.id, count: l.n, type: l.type };
  }
  return null;
}

function dist2d(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function centroid(ships) {
  const alive = ships.filter(s => !s.destroyed && !s.offTable);
  if (!alive.length) return null;
  return {
    x: alive.reduce((s, sh) => s + sh.x, 0) / alive.length,
    y: alive.reduce((s, sh) => s + sh.y, 0) / alive.length,
  };
}

// Best reachable position toward (targetX, targetY) given the move cone.
export function bestMoveToward(ship, mc, targetX, targetY) {
  if (!mc.o || mc.o.moveMax <= 0) return { x: ship.x, y: ship.y, heading: ship.heading };

  const dx = targetX - ship.x;
  const dy = targetY - ship.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  let finalHeading = ship.heading;
  let moveDist = mc.minR;

  if (dist > 0.5) {
    const dirDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    let delta = dirDeg - ship.heading;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    const clampedDelta = Math.max(-mc.turnDeg, Math.min(mc.turnDeg, delta));
    finalHeading = ship.heading + clampedDelta;
    // Subtract 1px from maxR so Math.round on diagonal moves never exceeds the gating threshold
    moveDist = Math.max(mc.minR, Math.min(mc.maxR - 1, dist));
  } else {
    moveDist = mc.minR;
  }

  const rad = finalHeading * Math.PI / 180;
  const margin = INCH * 2;
  const x = Math.max(margin, Math.min(BOARD_PX - margin, ship.x + Math.cos(rad) * moveDist));
  const y = Math.max(margin, Math.min(BOARD_PX - margin, ship.y + Math.sin(rad) * moveDist));
  return { x, y, heading: finalHeading };
}

// Candidate move targets for (group, order): toward dropsites, enemies, or hold.
function candidateTargets(state, gid, aiSide) {
  const grp = state.groups[gid];
  const si = grp.ships.findIndex(s => !s.destroyed && !s.offTable);
  if (si < 0) return [];
  const ship = grp.ships[si];
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  const dropsites = state.scenarioData?.dropsites || [];
  const contestable = dropsites
    .filter(ds => !ds.destroyed && dropsiteController(ds) !== aiSide)
    .sort((a, b) => dist2d(ship.x, ship.y, a.x * INCH, a.y * INCH) - dist2d(ship.x, ship.y, b.x * INCH, b.y * INCH));

  // Shaltari gate play needs the whole network to commit to ONE nearby objective, or the
  // Voidgates over-extend and break the 18" chain to the Mothership. Pick the contestable
  // dropsite nearest the Mothership (the network anchor) as the shared objective: Voidgates
  // charge it (to park within 3"); the Mothership advances behind them to stay chained.
  if (defIsVoidgate(grp.def) || defIsGateMother(grp.def)) {
    const obj = gateObjective(state, aiSide);
    if (obj) {
      const ox = obj.x * INCH, oy = obj.y * INCH;
      if (defIsGateMother(grp.def)) {
        // Stay ~14" short of the objective so the 18" chain holds while the Voidgates
        // close the last stretch to within 3".
        const d = dist2d(ship.x, ship.y, ox, oy) || 1;
        const back = Math.max(0, d - 14 * INCH);
        return [{ x: ship.x + (ox - ship.x) / d * back, y: ship.y + (oy - ship.y) / d * back, reason: 'vp' }];
      }
      return [{ x: ox, y: oy, reason: 'vp' }]; // Voidgate: charge the shared objective
    }
  }

  const targets = [];

  // 1. Nearest uncontrolled or enemy-controlled dropsite
  const vpDs = dropsites
    .filter(ds => !ds.destroyed && dropsiteController(ds) !== aiSide)
    .sort((a, b) => dist2d(ship.x, ship.y, a.x * INCH, a.y * INCH) - dist2d(ship.x, ship.y, b.x * INCH, b.y * INCH));
  if (vpDs.length) {
    targets.push({ x: vpDs[0].x * INCH, y: vpDs[0].y * INCH, reason: 'vp' });
  }

  // 2. Nearest enemy group
  const enemyGroups = Object.values(state.groups)
    .filter(g => g.def?.side === enemySide && g.ships.some(s => !s.destroyed && !s.offTable));
  if (enemyGroups.length) {
    const best = enemyGroups
      .map(g => { const c = centroid(g.ships); return c ? { g, d: dist2d(ship.x, ship.y, c.x, c.y), c } : null; })
      .filter(Boolean)
      .sort((a, b) => a.d - b.d)[0];
    if (best) targets.push({ x: best.c.x, y: best.c.y, reason: 'kill' });
  }

  // 3. Hold position (if min-move allows)
  targets.push({ x: ship.x, y: ship.y, reason: 'hold' });

  return targets.slice(0, 3);
}

// Find the best weapon target for weapon wi on ship si of group gid from current position.
function findBestTarget(state, gid, si, wi, aiSide) {
  const grp = state.groups[gid];
  const def = grp.def;
  if (!def?.weapons?.[wi]) return null;
  const w = def.weapons[wi];
  const ship = grp.ships[si];
  if (!ship || ship.destroyed || ship.offTable) return null;
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';

  let best = null, bestScore = -1;
  for (const [targetGid, tgrp] of Object.entries(state.groups)) {
    if (tgrp.def?.side !== enemySide) continue;
    for (let tsi = 0; tsi < tgrp.ships.length; tsi++) {
      const tship = tgrp.ships[tsi];
      if (tship.destroyed || tship.offTable || tship.attachedTo) continue;
      if (!weaponCanTarget(state, def, ship, w, tgrp.def, tship, tgrp)) continue;
      const score = (tgrp.def.pts || 0)
        + (tship.hull < (tship.maxHull || 1) / 2 ? 50 : 0)   // prefer crippled
        + (defIsDropper(tgrp.def) ? 150 : 0);                // prioritise enemy drop ships to stop landings
      if (score > bestScore) { bestScore = score; best = { gid: targetGid, si: tsi }; }
    }
  }
  return best;
}

export function generateActivationOptions(state, aiSide) {
  const options = [];

  const groups = Object.entries(state.groups)
    .filter(([, grp]) => grp.def?.side === aiSide && !grp.activated && grp.ships.some(s => !s.destroyed && !s.offTable))
    .sort(([, a], [, b]) => {
      // Voidgates (gateships) activate first each round so they can park within 3" of a
      // dropsite before their connected Mothership channels a drop the same round.
      const va = defIsVoidgate(a.def) ? 0 : 1, vb = defIsVoidgate(b.def) ? 0 : 1;
      if (va !== vb) return va - vb;
      return (TONNAGE_ORDER[a.def?.tonnage] ?? 4) - (TONNAGE_ORDER[b.def?.tonnage] ?? 4);
    });

  // Reserve groups (all ships still off-table) can't receive orders — skip them here.
  // buildActivation handles them via the allOffTable fast-finish path.

  for (const [gid, grp] of groups) {
    if (options.length >= 8) break;
    const validOrders = Object.keys(ORDERS).filter(o => isLegal(state, { type: 'applyOrder', gid, order: o }, aiSide));
    if (!validOrders.length) continue;

    const moveCandidates = candidateTargets(state, gid, aiSide);
    const si = grp.ships.findIndex(s => !s.destroyed && !s.offTable);

    // Drop-capable groups: plan to land battalions at the nearest reachable dropsite.
    // Shaltari Motherships drop via the Voidgate network instead of approaching a dropsite.
    const dropper  = defIsDropper(grp.def);
    const gateMother = defIsGateMother(grp.def);
    const dropPlan = dropper ? dropLaunchPlan(state, grp, grp.ships[si], aiSide)
                   : gateMother ? gateLaunchPlan(state, grp, grp.ships[si], aiSide) : null;

    // ── Context-aware order ranking ──────────────────────────────────────────
    // The old code took the first two legal ORDERS keys, which is always [GQ, SR] — so the AI
    // never used Weapons Free, Max Thrust or Damage Control. Rank by situation instead so the
    // right order surfaces: WF to unload all weapons when targets are in range, MT to sprint to
    // a distant objective, DC to repair a damaged ship that can't shoot. (Course Change is kept
    // low — buildActivation injects it for formation/hold/gate parking where it's actually needed.)
    let hasTargets = false;
    if (si >= 0 && grp.def?.weapons) {
      for (let wi = 0; wi < grp.def.weapons.length; wi++) {
        if (findBestTarget(state, gid, si, wi, aiSide)) { hasTargets = true; break; }
      }
    }
    const damaged = grp.ships.some(s => !s.destroyed && !s.offTable && s.hull < (s.maxHull ?? s.hull));
    let nearest = Infinity;
    if (si >= 0) {
      const shipObj = grp.ships[si];
      const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
      for (const ds of (state.scenarioData?.dropsites || [])) {
        if (ds.destroyed || dropsiteController(ds) === aiSide) continue;
        nearest = Math.min(nearest, dist2d(shipObj.x, shipObj.y, ds.x * INCH, ds.y * INCH));
      }
      for (const g of Object.values(state.groups)) {
        if (g.def?.side !== enemySide) continue;
        for (const es of g.ships) {
          if (es.destroyed || es.offTable) continue;
          nearest = Math.min(nearest, dist2d(shipObj.x, shipObj.y, es.x, es.y));
        }
      }
    }
    const fullThrustPx = (grp.def?.thrust || 8) * INCH;
    const farAdvance = nearest > fullThrustPx; // more than one full move from anything worth reaching

    const rank = {};
    for (const o of validOrders) {
      let r = 0;
      if (o === 'GQ') r = 3;                                              // versatile default
      else if (o === 'WF') r = hasTargets && !farAdvance ? 4 : 1;         // alpha strike when in range
      else if (o === 'MT') r = (farAdvance && !hasTargets) ? 3.5 : 0.3;   // sprint when nothing to shoot
      else if (o === 'DC') r = (damaged && !hasTargets) ? 3.5 : 0.2;      // repair when it can't fight
      else if (o === 'SR') r = 1.2;                                       // shed spikes / sneak
      else if (o === 'CC') r = 0.5;                                       // hold/aim (mostly via override)
      // Droppers must keep an order that can launch (MT/DC can't), so demote those for them.
      if ((dropper || gateMother) && NO_LAUNCH_ORDERS.has(o)) r -= 5;
      rank[o] = r;
    }
    const orderList = [...validOrders].sort((a, b) => rank[b] - rank[a]);

    for (const order of orderList.slice(0, 2)) { // cap to 2 orders per group
      if (options.length >= 8) break;
      for (const dest of moveCandidates.slice(0, 2)) {
        if (options.length >= 8) break;
        const mc = si >= 0 ? moveCone(state, gid, si, false) : null;
        const ship = si >= 0 ? grp.ships[si] : null;
        const movePos = (ship && mc) ? bestMoveToward(ship, mc, dest.x, dest.y) : null;

        // Find weapon targets from (approximately) the post-move position.
        const weapTargets = [];
        if (grp.def?.weapons) {
          for (let wi = 0; wi < grp.def.weapons.length; wi++) {
            const t = findBestTarget(state, gid, si, wi, aiSide);
            if (t) weapTargets.push({ wi, targetGid: t.gid, targetSi: t.si });
          }
        }

        options.push({
          id: `opt_${options.length}`,
          label: `${grp.def?.name || gid} [${order}] → ${dest.reason}`,
          groupId: gid,
          order,
          movePlan: dest,      // {x, y, reason}
          movePos,             // best reachable pixel pos (pre-move check)
          weapTargets,         // [{wi, targetGid, targetSi}]
          // Drop battalions when the order permits launching: a normal dropper drops while
          // heading to a dropsite; a Mothership channels through the gate network from
          // wherever it is, so its plan isn't tied to the move destination.
          launchPlan: NO_LAUNCH_ORDERS.has(order) ? null
                    : gateMother ? dropPlan
                    : (dropPlan && dest.reason === 'vp') ? dropPlan : null,
        });
      }
    }
  }

  if (isLegal(state, { type: 'pass' }, aiSide)) {
    options.push({ id: 'opt_pass', label: 'Pass activation', groupId: null, order: null, movePlan: null, weapTargets: [] });
  }

  return options;
}

export function generatePlanningOptions(state, aiSide) {
  return [
    { id: 'opt_take', label: 'Take initiative', action: 'take', to: aiSide },
    { id: 'opt_give', label: 'Give initiative to opponent', action: 'give', to: aiSide === 'player1' ? 'player2' : 'player1' },
  ];
}

export function generateDeployOptions(state, aiSide) {
  const opts = [];
  const deployZoneName = state.deployZone?.[aiSide] || (aiSide === 'player1' ? 'south' : 'north');
  const zone = deployZoneFor(state, aiSide);
  const dropsites = state.scenarioData?.dropsites || [];
  // Anchor near a dropsite (so droppers start close), biased to the friendly edge.
  const edgeYpx = deployZoneName === 'south' ? BOARD_PX * 0.97 : BOARD_PX * 0.03;
  const nearDs = dropsites
    .filter(d => !d.destroyed)
    .sort((a, b) => Math.abs(a.y * INCH - edgeYpx) - Math.abs(b.y * INCH - edgeYpx))[0];

  // Every already-deployed friendly ship (ALL groups) — so placement never overlaps a
  // ship from another group either (cross-group overlap is what the engine resolves into
  // a conga line).
  const allPlaced = [];
  for (const g of Object.values(state.groups)) {
    if (g.def?.side !== aiSide) continue;
    const gr = baseDiameterPx(g.def) / 2;
    for (const s of g.ships) if (!s.destroyed && !s.offTable) allPlaced.push({ x: s.x, y: s.y, r: gr });
  }

  for (const [gid, grp] of Object.entries(state.groups)) {
    if (grp.def?.side !== aiSide) continue;
    // Only deploy ships that are eligible now (vanguard or directly_deploy approach).
    if (!canDeployNow(state, grp.def)) continue;
    // Ships awaiting deployment are offTable=true — find one to place.
    const si = grp.ships.findIndex(s => !s.destroyed && s.offTable);
    if (si < 0) continue;
    if (!isLegal(state, { type: 'deployShip', gid, si }, aiSide)) continue;

    const heading = deployZoneName === 'south' ? -90 : 90; // face north or south
    const placed = grp.ships.filter(s => !s.destroyed && !s.offTable);
    let anchorX, anchorY = edgeYpx;
    if (placed.length) {
      // Keep a group together near its own already-placed ships.
      const c = centroid(grp.ships); anchorX = c.x; anchorY = c.y;
    } else if (defIsDropper(grp.def) || defIsGateMother(grp.def) || defIsVoidgate(grp.def)) {
      // Drop-capable groups start near a dropsite.
      anchorX = nearDs ? nearDs.x * INCH : BOARD_PX / 2;
    } else {
      // Combat groups spread across the zone width (deterministic per group) so the fleet
      // fans out instead of piling onto one spot.
      const h = [...gid].reduce((a, c) => a + c.charCodeAt(0), 0);
      anchorX = INCH * 3 + (h % 97) / 97 * (BOARD_PX - INCH * 6);
    }
    const za = legalZonePosPx(zone, Math.max(INCH, Math.min(BOARD_PX - INCH, anchorX)),
                                    Math.max(INCH, Math.min(BOARD_PX - INCH, anchorY)));
    if (!za) continue;
    // Don't overlap THIS ship against the rest of its own group it'll deploy alongside,
    // nor any already-placed ship of any group.
    const pos = placeNonOverlap(za.x, za.y, allPlaced, baseDiameterPx(grp.def), zone);
    opts.push({ id: `opt_dep_${gid}_${opts.length}`, gid, si, x: Math.round(pos.x), y: Math.round(pos.y), heading });
    break; // handle one group at a time; triggerAi will loop
  }
  return opts;
}

export function generateDropsiteOptions(state, aiSide) {
  const da = state.dropsiteActivation;
  if (!da || da.side !== aiSide) return [];
  const dropsites = state.scenarioData?.dropsites || [];
  const opts = [];
  for (const ds of dropsites) {
    if ((da.done || []).includes(ds.id) || ds.destroyed) continue;
    opts.push({ id: `opt_ds_${ds.id}`, dsId: ds.id, label: ds.base?.name || ds.id });
  }
  opts.push({ id: 'opt_ds_skip', dsId: null, label: 'Skip remaining' });
  return opts;
}

export { findBestTarget };

// ── LLM option mapper ─────────────────────────────────────────────────────────
// Converts LLM-generated plain-text plans into executable programmatic options.
// Lines are formatted as "GroupName | ORDER | description".
// Unknown groups or illegal orders are silently dropped.

export function mapLlmOptions(lines, state, aiSide) {
  const LAUNCH_RANGE = { dropship: 3, bulk_lander: 6, drop_pod: 6, gate_dropship: -1 };
  const dropsites = state.scenarioData?.dropsites || [];
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  const mapped = [];

  // Build the stable candidate list: all unactivated AI groups (on-table AND reserve).
  // A1 = index 0, A2 = index 1, ... — same insertion order the state parser uses.
  const allAiGroups = Object.entries(state.groups).filter(([, g]) => g.def?.side === aiSide);
  const candidateGroups = allAiGroups.filter(([, g]) =>
    !g.activated && g.ships.some(s => !s.destroyed)
  );
  const candidateNames = candidateGroups.map(([, g]) => g.def?.name || '(unknown)');

  for (const line of lines) {
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 2) continue;
    const [groupHint, orderHint, goalText = '', coordField = ''] = parts;

    // Normalize the hint: strip markdown, leading A# prefix, any bracketed/parenthetical
    // tags echoed from the briefing ([DROP], [hull:L], (anything)), lowercase.
    const normalized = groupHint
      .replace(/[\*_`#~>]+/g, '')  // strip markdown: **, *, _, `, #, ~ etc.
      .replace(/^A\d+\s*/i, '')    // "A3 Odysseus" → "Odysseus"
      .replace(/\[.*?\]/g, '')     // "Aldrin [DROP]" / "[hull:L]" → ""
      .replace(/\(.*?\)/g, '')     // "Ship (something)" → "Ship"
      .trim()
      .toLowerCase();
    const aIndexMatch = groupHint.match(/^A(\d+)/i);

    // Resolve by A-index first (most reliable), then by name substring.
    let groupEntry = null;
    if (aIndexMatch) {
      const idx = parseInt(aIndexMatch[1], 10) - 1; // A1→0, A2→1 …
      const byIndex = allAiGroups[idx];
      if (byIndex && !state.groups[byIndex[0]]?.activated && byIndex[1].ships.some(s => !s.destroyed)) {
        groupEntry = byIndex;
      }
    }
    if (!groupEntry && normalized) {
      const firstWord = normalized.split(/\s+/)[0];
      groupEntry = candidateGroups.find(([, g]) =>
        (g.def?.name || '').toLowerCase().includes(firstWord)
      ) || null;
    }

    if (!groupEntry) {
      console.warn(`[AI/mapper] no match for "${groupHint}" (normalized: "${normalized}") — candidates: ${candidateNames.join(', ')}`);
      continue;
    }

    const [gid, grp] = groupEntry;
    const def = grp.def;

    // Validate order: just check it's a known order string.
    // Don't run isLegal(applyOrder) for reserve groups — the ship is still off-table
    // so nextUndeployedShipIdx >= 0 would fail, but the arrival happens before applyOrder.
    const VALID_ORDERS = new Set(['GQ', 'WF', 'SR', 'CC', 'MT', 'DC']);
    const order = orderHint.replace(/[\*_`#~>]+/g, '').toUpperCase().trim();
    if (!VALID_ORDERS.has(order)) continue;
    const isReserve = grp.ships.every(s => s.destroyed || s.offTable);
    if (!isReserve && !isLegal(state, { type: 'applyOrder', gid, order }, aiSide)) continue;

    const si = grp.ships.findIndex(s => !s.destroyed && !s.offTable);
    const ship = si >= 0 ? grp.ships[si] : null;
    const goal = goalText.toLowerCase();

    let movePlan = { x: ship?.x ?? BOARD_PX / 2, y: ship?.y ?? BOARD_PX / 2, reason: 'hold' };

    // Build the same stable ID maps the state parser uses (E1, E2... / DS1, DS2...)
    const humGrpList  = Object.entries(state.groups).filter(([, g]) => g.def?.side === enemySide);
    const dsAll       = dropsites.filter(ds => !ds.destroyed);
    const eIdMap  = {};  // 'e1' → gid
    humGrpList.forEach(([gid], i) => { eIdMap[`e${i + 1}`] = gid; });
    const dsIdMap = {};  // 'ds1' → ds
    dsAll.forEach((ds, i) => { dsIdMap[`ds${i + 1}`] = ds; });

    // 1. Short ID match: E1, E2, DS1, DS2 in goal text
    const shortId = goal.match(/\b([ed][se]?\d+)\b/i)?.[1]?.toLowerCase();
    let namedEnemy = null;
    if (shortId && eIdMap[shortId]) {
      const eg = state.groups[eIdMap[shortId]];
      const alive = (eg?.ships || []).filter(s => !s.destroyed && !s.offTable);
      if (alive.length) namedEnemy = alive[0];
    }

    // DS short ID match → move toward that dropsite immediately
    if (shortId && dsIdMap[shortId]) {
      const ds = dsIdMap[shortId];
      movePlan = { x: ds.x * INCH, y: ds.y * INCH, reason: 'vp' };
    }

    // 2. Named enemy ship in goal text → move toward it
    if (!namedEnemy && !dsIdMap[shortId || '']) {
      for (const [, eg] of Object.entries(state.groups)) {
        if (eg.def?.side !== enemySide) continue;
        const name = (eg.def?.name || '').toLowerCase();
        if (name && goal.includes(name.split(' ')[0])) {
          const alive = eg.ships.filter(s => !s.destroyed && !s.offTable);
          if (alive.length) { namedEnemy = alive[0]; break; }
        }
      }
    }
    if (namedEnemy) {
      movePlan = { x: namedEnemy.x, y: namedEnemy.y, reason: 'kill' };
    }

    // 3. Named dropsite in goal text (name match, ID already handled above)
    if (!namedEnemy && !dsIdMap[shortId || '']) {
      const namedDs = dropsites.find(ds =>
        ds.base?.name && goal.includes(ds.base.name.toLowerCase().split(/[\s-]/)[0].toLowerCase())
      );
      if (namedDs) {
        movePlan = { x: namedDs.x * INCH, y: namedDs.y * INCH, reason: 'vp' };
      } else if (/fire|attack|engage/.test(goal)) {
        // Nearest enemy fallback
        let nearest = null, nearDist = Infinity;
        for (const [, eg] of Object.entries(state.groups)) {
          if (eg.def?.side !== enemySide) continue;
          for (const es of eg.ships) {
            if (es.destroyed || es.offTable) continue;
            const dd = ship ? Math.hypot(ship.x - es.x, ship.y - es.y) : Infinity;
            if (dd < nearDist) { nearDist = dd; nearest = es; }
          }
        }
        if (nearest) movePlan = { x: nearest.x, y: nearest.y, reason: 'kill' };
      } else if (/drop|battalion|lander|advance/.test(goal)) {
        // Nearest uncontrolled dropsite fallback
        const vpDs = dropsites.filter(ds => !ds.destroyed && dropsiteController(ds) !== aiSide)
          .sort((a, b) => {
            if (!ship) return 0;
            return Math.hypot(ship.x - a.x*INCH, ship.y - a.y*INCH) -
                   Math.hypot(ship.x - b.x*INCH, ship.y - b.y*INCH);
          })[0];
        if (vpDs) movePlan = { x: vpDs.x * INCH, y: vpDs.y * INCH, reason: 'vp' };
      }
    }

    // Weapon targets from current position
    const weapTargets = [];
    if (def?.weapons && si >= 0) {
      for (let wi = 0; wi < def.weapons.length; wi++) {
        const t = findBestTarget(state, gid, si, wi, aiSide);
        if (t) weapTargets.push({ wi, targetGid: t.gid, targetSi: t.si });
      }
    }

    // Launch plan: if goal mentions dropping, find best reachable dropsite
    let launchPlan = null;
    if (/drop|battalion|lander|dropship/.test(goal)) {
      const launches = def?.launch || [];
      for (let li = 0; li < launches.length; li++) {
        const l = launches[li];
        if (!LAUNCH_RANGE[l.type] || LAUNCH_RANGE[l.type] < 0) continue; // skip gate_dropship
        const rangePx = (LAUNCH_RANGE[l.type] + 8) * INCH; // 8" extra for movement
        const reachableDs = dropsites.filter(ds => {
          if (ds.destroyed || !ship) return false;
          return Math.hypot(ship.x - ds.x * INCH, ship.y - ds.y * INCH) <= rangePx;
        }).sort((a, b) => {
          const da = Math.hypot(ship.x - a.x * INCH, ship.y - a.y * INCH);
          const db = Math.hypot(ship.x - b.x * INCH, ship.y - b.y * INCH);
          return da - db;
        });
        if (reachableDs.length) {
          launchPlan = { li, dsId: reachableDs[0].id, count: l.n, type: l.type };
          break;
        }
      }
    }

    const mc = ship ? moveCone(state, gid, si, false) : null;
    const movePos = (ship && mc) ? bestMoveToward(ship, mc, movePlan.x, movePlan.y) : null;

    mapped.push({
      id: `llm_${mapped.length}`,
      label: goalText || `${def.name} [${order}]`,
      groupId: gid,
      order,
      movePlan,
      movePos,
      weapTargets,
      launchPlan,
    });
  }

  return mapped;
}
