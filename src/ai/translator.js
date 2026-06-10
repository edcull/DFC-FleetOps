// Expands an activation-level option into a concrete intent sequence.
// Mutates state directly via applyFn so post-move targeting is accurate.

import { INCH, ORDERS } from '../engine/constants.js';
import { moveCone, dsEnemyBattalions, dsBattalions, connectedGateships, coherencyInches, outOfFormationSet, shipInNetwork, transportValue } from '../engine/mutators.js';
import { isLegal } from '../engine/gating.js';
import { bestMoveToward, findBestTarget, baseDiameterPx, gateRunnerPlan, gateMotherPlan, corvettePlan, descentDropperPlan, detectorPlan, gateShipTargets } from './options.js';

// Ground-launch aura ranges + target constraints (mirrors the client's LAUNCH_TYPES /
// tryGroundLaunch). Launch range isn't gated, so the AI must check it itself or it
// lands battalions on dropsites it can't actually reach.
const GROUND_LAUNCH = {
  dropship:    { aura: 3, sameLayer: true },
  bulk_lander: { aura: 6 },
  drop_pod:    { aura: 3, city: true },
};
function groundLaunchInRange(type, ship, ds) {
  const spec = GROUND_LAUNCH[type];
  if (!spec || !ship || !ds) return false;
  if (Math.hypot(ship.x - ds.x * INCH, ship.y - ds.y * INCH) > spec.aura * INCH + 2) return false;
  if (spec.sameLayer) {
    const dsLayer = ds.base?.layer === 'Atmosphere' ? 'atmosphere' : 'orbit';
    if ((ship.layer || 'orbit') !== dsLayer) return false;
  }
  if (spec.city && ds.base?.category !== 'city') return false;
  return true;
}

// True if the hypothetical positions `pts` ([{x,y,layer}]) satisfy DFC coherency:
// each ship within `cohPx` of at least `need` same-layer group-mates (need=2 for
// groups of 4+, else 1). Groups of ≤1 are always coherent.
function formationOK(pts, cohPx, need) {
  if (pts.length <= 1) return true;
  return coherentCount(pts, cohPx, need) === pts.length;
}

// How many ships have ≥need same-layer group-mates within cohPx (i.e. are "in formation").
function coherentCount(pts, cohPx, need) {
  if (pts.length <= 1) return pts.length;
  let ok = 0;
  for (let i = 0; i < pts.length; i++) {
    let neighbours = 0;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      if ((pts[i].layer || 'orbit') !== (pts[j].layer || 'orbit')) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) <= cohPx) neighbours++;
    }
    if (neighbours >= need) ok++;
  }
  return ok;
}

// N distinct target slots packed around (cx,cy) so the group's ships aim at *different* points.
// Aiming them all at one spot makes them pile up, and the engine resolves the overlap by shoving
// ships back along their shared path — the "conga line". Slots are spaced a full base diameter
// PLUS ~0.6" apart so that even after each ship's move is clamped short of its slot they still
// don't overlap (a base-contact gap alone left them packed into a line).
function packSlots(cx, cy, n, diamPx) {
  const slots = [{ x: cx, y: cy }];
  const spacing = diamPx + 0.6 * INCH;
  for (let ring = 1; slots.length < n; ring++) {
    const rad = spacing * ring;
    const count = Math.max(1, Math.floor((2 * Math.PI * rad) / spacing));
    for (let i = 0; i < count && slots.length < n; i++) {
      const a = (i / count) * 2 * Math.PI + ring * 0.6;
      slots.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
    }
  }
  return slots;
}

// True if no two destinations (same layer) sit closer than a base diameter — i.e. the
// ships won't end up overlapping (and so won't be shoved into a line).
function nonOverlapOK(pts, diamPx) {
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if ((pts[i].layer || 'orbit') !== (pts[j].layer || 'orbit')) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < diamPx - 1) return false;
    }
  }
  return true;
}

// Total enemy "air" strength that could contest our fighters/bombers: launch capacity for
// fighter/bomber/fighter_bomber across the enemy fleet, plus any enemy air already on the table.
function enemyAirStrength(state, aiSide) {
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  let air = 0;
  for (const g of Object.values(state.groups)) {
    if (g.def?.side !== enemySide) continue;
    const live = g.ships.some(s => !s.destroyed && !s.offTable);
    if (!live) continue;
    for (const l of (g.def.launch || [])) {
      if (/fighter|bomber/i.test(l.type)) air += l.n || 0;
    }
  }
  for (const a of (state.launchedAssets || [])) {
    if (a.side === enemySide && /fighter/i.test(a.kind || '')) air += a.count || 0;
  }
  return air;
}

// Nearest live enemy ship (point) to (x,y), or null.
function nearestEnemyShipPt(state, aiSide, x, y) {
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  let best = null, bd = Infinity;
  for (const g of Object.values(state.groups)) {
    if (g.def?.side !== enemySide) continue;
    for (const s of g.ships) {
      if (s.destroyed || s.offTable) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = { x: s.x, y: s.y }; }
    }
  }
  return best;
}

// Move a group toward (tx,ty) without breaking coherency and without stacking ships. The
// formation centroid advances toward the target; each ship is then sent to its own slot in
// a non-overlapping cluster around that waypoint (nearest slot, greedily). We pick the
// largest advance whose simulated destinations stay coherent AND non-overlapping, backing
// off toward the centroid otherwise.
function moveGroupCoherent(state, rng, gid, movers, tx, ty, applyFn, toggle = false) {
  const def = state.groups[gid].def;
  const cohPx = coherencyInches(def) * INCH;
  const need = movers.length >= 4 ? 2 : 1;
  const diamPx = baseDiameterPx(def);
  const rNew = diamPx / 2;

  const cones = {};
  let reach = Infinity;
  for (const { si } of movers) {
    const mc = moveCone(state, gid, si, toggle);
    cones[si] = mc;
    if (mc.o && mc.o.moveMax > 0) reach = Math.min(reach, mc.maxR - 1);
  }
  if (!isFinite(reach)) reach = 0;

  // Every OTHER on-table ship (all groups, both sides) the movers must not land on — ending a move
  // on an occupied base makes the engine shove the bases apart into a conga line / out of formation.
  // The destination LAYER matters (a ship in Atmosphere doesn't block one in Orbit).
  const moverSi = new Set(movers.map(m => m.si));
  const obstacles = [];
  for (const [ogid, g] of Object.entries(state.groups)) {
    const r = baseDiameterPx(g.def) / 2;
    g.ships.forEach((s, i) => {
      if (s.destroyed || s.offTable) return;
      if (ogid === gid && moverSi.has(i)) return;
      obstacles.push({ x: s.x, y: s.y, r, layer: s.layer || 'orbit' });
    });
  }
  const clearOfObstacles = (x, y, layer) => obstacles.every(o =>
    o.layer !== (layer || 'orbit') || Math.hypot(x - o.x, y - o.y) >= rNew + o.r - 1);

  const cx = movers.reduce((a, o) => a + o.s.x, 0) / movers.length;
  const cy = movers.reduce((a, o) => a + o.s.y, 0) / movers.length;
  const dC = Math.hypot(tx - cx, ty - cy) || 1;
  const ux = (tx - cx) / dC, uy = (ty - cy) / dC;

  const reachDest = (s, si, sx, sy) => {
    const mc = cones[si];
    if (!mc.o || mc.o.moveMax <= 0) return { x: s.x, y: s.y };
    return bestMoveToward(s, mc, sx, sy);
  };

  const need2 = need;
  const startCoh = coherentCount(movers.map(({ s }) => ({ x: s.x, y: s.y, layer: s.layer })), cohPx, need2);
  const startCoherent = startCoh === movers.length;

  // RIGID move (for an already-coherent group): every ship aims at a point the SAME distance along
  // the SHARED group bearing from its OWN position, so they all turn to and hold a COMMON heading
  // and translate together. Keeping facings aligned is what lets the group keep advancing on General
  // Quarters instead of being forced onto Course Change every turn just to re-aim (and it preserves
  // the existing spacing, so no overlap is introduced among group-mates).
  const planRigid = (adv) => {
    const target = {}, dests = [];
    for (const { s, si } of movers) {
      const aimX = s.x + ux * adv, aimY = s.y + uy * adv;
      target[si] = { x: aimX, y: aimY };
      const rd = reachDest(s, si, aimX, aimY);
      dests.push({ x: rd.x, y: rd.y, layer: s.layer });
    }
    return { target, dests };
  };

  // For an advance/regroup of a BROKEN group: pack distinct slots around the waypoint, then give each
  // ship the nearest slot whose REACHABLE destination is clear of board obstacles AND of the slots
  // already taken by group-mates. Extra slots are packed so a ship can skip a blocked one.
  const planPacked = (adv) => {
    const wx = cx + ux * adv, wy = cy + uy * adv;
    const slots = packSlots(wx, wy, movers.length + 4, diamPx);
    const used = new Array(slots.length).fill(false);
    const target = {}, dests = [], placed = [];
    for (const { s, si } of movers) {
      let bi = -1, bd = Infinity, biClear = -1, bdClear = Infinity;
      for (let k = 0; k < slots.length; k++) {
        if (used[k]) continue;
        const d = (s.x - slots[k].x) ** 2 + (s.y - slots[k].y) ** 2;
        if (d < bd) { bd = d; bi = k; }
        const rd = reachDest(s, si, slots[k].x, slots[k].y);
        const clear = clearOfObstacles(rd.x, rd.y, s.layer)
          && placed.every(p => Math.hypot(rd.x - p.x, rd.y - p.y) >= diamPx - 1);
        if (clear && d < bdClear) { bdClear = d; biClear = k; }
      }
      const k = biClear >= 0 ? biClear : (bi >= 0 ? bi : 0);
      used[k] = true; target[si] = slots[k];
      const rd = reachDest(s, si, slots[k].x, slots[k].y);
      placed.push(rd);
      dests.push({ x: rd.x, y: rd.y, layer: s.layer });
    }
    return { target, dests };
  };

  // Coherent AND already roughly aligned → move rigidly (shared heading) to KEEP them aligned.
  // A broken or misaligned group packs/converges instead (rigid aiming can't re-align ships whose
  // headings are far apart in one move). Once aligned, rigid keeps them aligned thereafter.
  const angDiff = (a, b) => { const d = Math.abs((((a - b) % 360) + 360) % 360); return d > 180 ? 360 - d : d; };
  let headingSpread = 0;
  for (let i = 0; i < movers.length; i++) for (let j = i + 1; j < movers.length; j++) headingSpread = Math.max(headingSpread, angDiff(movers[i].s.heading || 0, movers[j].s.heading || 0));
  const planAt = (startCoherent && headingSpread <= 30) ? planRigid : planPacked;

  const obstOverlaps = dests => dests.reduce((n, d) => n + (clearOfObstacles(d.x, d.y, d.layer) ? 0 : 1), 0);
  // A move's "harm" = ships left out of formation + ships ending on another base (which the engine
  // then shoves apart, ALSO breaking formation). Minimise harm; among equal-harm moves, advance most.
  const harm = dests => (movers.length - coherentCount(dests, cohPx, need)) + obstOverlaps(dests);

  let chosen = null, bestCand = null, bestScore = -Infinity;
  for (const frac of [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.12, 0]) {
    const cand = planAt(Math.min(reach * frac, dC));
    if (formationOK(cand.dests, cohPx, need) && nonOverlapOK(cand.dests, diamPx) && obstOverlaps(cand.dests) === 0) { chosen = cand; break; }
    // Prefer the least-harmful move (fewest broken + overlapping ships); break ties toward advancing.
    const score = -harm(cand.dests) * 100 + frac;
    if (score > bestScore) { bestScore = score; bestCand = cand; }
  }
  // frac 0 (hold near the current, coherent position) is always in the loop above, so bestCand
  // already includes the option of not advancing into a crowd — i.e. holding formation over
  // charging and being broken/shoved.
  if (!chosen) chosen = bestCand || planAt(0);
  for (const { si } of movers) {
    const t = chosen.target[si];
    moveShipToward(state, rng, gid, si, t.x, t.y, applyFn, toggle);
  }
}

// Mass-Driver "shot" score for a Group: total Attack dice from Mass Driver weapons on its live
// on-table ships, ranked so 6400-series outweighs 4200-series outweighs any other Mass Driver
// (2200/9000 etc.) — a lexicographic score (6400, 4200, other).
function massDriverScore(state, gid) {
  const grp = state.groups[gid];
  const def = grp?.def;
  if (!def?.weapons) return 0;
  let s6400 = 0, s4200 = 0, sOther = 0;
  for (const sh of grp.ships) {
    if (sh.destroyed || sh.offTable) continue;
    for (const w of def.weapons) {
      if (!/Mass Driver/i.test(w.name || '')) continue;
      const att = w.att || 0;
      if (/6400/.test(w.name)) s6400 += att;
      else if (/4200/.test(w.name)) s4200 += att;
      else sOther += att;
    }
  }
  return s6400 * 1e6 + s4200 * 1e3 + sOther;
}

// Use Mass Driver Volley on `gid` only when the side can afford it (≥2 AP) AND this is the best
// Mass Driver platform the side still has — i.e. no ALIVE friendly Group has a higher Mass Driver
// score (6400 > 4200 > other). Comparing against all alive Groups (not just unactivated ones)
// guarantees the buff is reserved for the strongest volley: a 4200-only ship will never burn the
// AP while a 6400 ship is still on the board, even if that 6400 already activated this round
// without firing it. (Trade-off: if the best platform has no target this round the buff may go
// unused — acceptable, since MDV is premium and the side's priority is its biggest volley.)
function shouldUseMassDriverVolley(state, gid, aiSide) {
  if (!state.planning || (state.planning.ap?.[aiSide] || 0) < 2) return false;
  const myScore = massDriverScore(state, gid);
  if (myScore <= 0) return false;
  for (const [ogid, g] of Object.entries(state.groups)) {
    if (ogid === gid || g.def?.side !== aiSide) continue;
    if (!g.ships.some(s => !s.destroyed && !s.offTable)) continue;
    if (massDriverScore(state, ogid) > myScore) return false; // a stronger Mass Driver platform exists
  }
  return true;
}

// Find the best dropsite to bombard: enemy/contested DS with most battalions,
// within scan range of the firing ship (arc checked by gating).
function findBestBombardmentTarget(state, aiSide, ship, scan) {
  const dropsites = state.scenarioData?.dropsites || [];
  const scanPx    = scan * INCH;
  return dropsites
    .filter(ds => {
      if (ds.destroyed) return false;
      // Must have enemy battalions and be within scan range
      if (dsEnemyBattalions(ds, aiSide) <= 0) return false;
      return Math.hypot(ship.x - ds.x * INCH, ship.y - ds.y * INCH) <= scanPx;
    })
    .sort((a, b) => dsEnemyBattalions(b, aiSide) - dsEnemyBattalions(a, aiSide))[0] ?? null;
}


// Resolve an attack modal (AI as attacker) by sequencing the correct 'to' transitions.
// Defensive declarations (shields, brace, contain) are skipped — not cost-effective in
// Phase A and the defender (human) would normally make these choices themselves.
//
// The DEFENDER owns the save step, so this yields there: against a human the client drives
// the save; in AI-vs-AI the server's _resolveAttackModalBoth drives it. The attacker resumes
// (re-entering this function) once the modal advances past 'save' — see triggerAi.
export function resolveAttackModal(state, rng, applyFn) {
  let guard = 80;
  while (state.attackModal && guard-- > 0) {
    const M = state.attackModal;
    let to = null;

    switch (M.step) {
      case 'select': {
        // Multi-shot attack: pick the next unresolved shot to fire (attacker's choice of order).
        const next = M.shots.findIndex((_, i) => !(M.resolvedShots || []).includes(i));
        if (next < 0) { to = null; break; }            // nothing left — finish the attack
        if (!applyFn({ type: 'attackSelectShot', shotIdx: next })) return;
        continue;                                        // now at 'intro' for that shot
      }
      case 'intro':
        to = 'hit';
        break;
      case 'hit':
        if (M.hitResult) to = 'save';    // rollSaves (handles 0-hit skip internally)
        else to = 'hit';                  // shouldn't happen; retry
        break;
      case 'save': {
        if (!M.saveResult) { to = 'save'; break; }  // roll the primary saves
        // Saves are rolled — the DEFENDER decides re-rolls / shields / apply. Yield so the
        // human (or the AI-vs-AI both-loop) drives it; the attacker resumes afterwards.
        return;
      }
      case 'crippling': {
        const c = M.crippleQueue && M.crippleQueue[0];
        if (!c) { to = null; break; }
        to = c.rolled ? 'crippling-next' : 'crippling-roll';
        break;
      }
      case 'explosion': {
        const ex = M.explodeQueue && M.explodeQueue[0];
        if (!ex) { to = null; break; }
        to = ex.rolled ? 'explosion-next' : 'explosion-roll';
        break;
      }
      case 'bombardCollateral': {
        // Remove a collateral battalion from the first pending queue entry.
        // Pick 'ground' first; if no ground battalion exists, pick any valid location.
        const q = M.bombardCollateralQueue && M.bombardCollateralQueue[0];
        if (!q) { to = null; break; }
        // Gating needs the queue head's dsId and a location actually holding q.side's
        // battalions; without dsId the intent is illegal and the modal would hang.
        const ds = state.scenarioData?.dropsites?.find(d => d.id === q.dsId);
        const b = ds ? dsBattalions(ds) : {};
        const loc = Object.keys(b).find(k => (b[k]?.[q.side] || 0) > 0);
        if (!loc || !applyFn({ type: 'resolveBombardCollateral', dsId: q.dsId, loc })) { to = null; break; }
        continue; // proceedQueues inside the mutator handles transitions
      }
      case 'impel': {
        // Attacker chooses: turn the impelled enemy ship (more disruptive than a push).
        if (!applyFn({ type: 'attackDeclare', what: 'impel', choice: 'turn' })) { to = null; }
        continue; // proceedQueues handles transition after attackDeclare
      }
      case 'done':
      default:
        to = null;
    }

    if (to) {
      if (!applyFn({ type: 'attackStep', to })) break;
    } else {
      if (!applyFn({ type: 'finishAttack' })) break;
    }
  }
}

// Move a single ship toward (tx, ty), handling post-move aiming state. `toggle` requests a
// layer change (Orbit↔Atmosphere) at the end of the move — used to descend gates onto cities.
function moveShipToward(state, rng, gid, si, tx, ty, applyFn, toggle = false) {
  const ship = state.groups[gid]?.ships[si];
  if (!ship || ship.destroyed || ship.offTable || ship.movedThisRound) return false;
  const mc = moveCone(state, gid, si, toggle);
  if (!mc.o || mc.o.moveMax <= 0) return false;

  const dest = bestMoveToward(ship, mc, tx, ty);
  const moved = applyFn({ type: 'moveShip', gid, si, x: Math.round(dest.x), y: Math.round(dest.y), layerToggle: toggle });
  if (!moved) return false;

  // Handle course-change / vectored aiming state produced by commitMove
  if (state.aiming?.gid === gid) {
    applyFn({ type: 'aimShip', gid, x: Math.round(tx), y: Math.round(ty) });
    if (state.vectoredSecondMove?.gid === gid) {
      applyFn({ type: 'endVectoredMove' });
    }
  }
  return true;
}

// Build the full activation sequence by mutating state directly.
export function buildActivation(state, rng, gid, order, movePlan, aiSide, applyFn, launchPlan = null) {
  const grp = state.groups[gid];
  if (!grp) return;
  const def = grp.def;

  // REGROUP FIRST (highest priority): a multi-ship group that's broken out of coherency tightens
  // up before doing anything else. Course Change (0" minimum move + two 45° turns) lets it collapse
  // onto its own centroid; advancing/diving while spread only strands ships further out of formation
  // (and in Atmosphere they can't recover at the 2"/turn cap). This sits ABOVE the corvette/descent
  // overrides so those groups regroup too, instead of charging while broken.
  const liveShips = grp.ships.filter(s => !s.destroyed && !s.offTable);
  const canRegroup = !def?.openNetwork && !def?.payload && liveShips.length >= 2
    && outOfFormationSet(state, def).size > 0
    && isLegal(state, { type: 'applyOrder', gid, order: 'CC' }, aiSide);
  if (canRegroup) {
    const cx = liveShips.reduce((a, s) => a + s.x, 0) / liveShips.length;
    const cy = liveShips.reduce((a, s) => a + s.y, 0) / liveShips.length;
    order = 'CC';
    movePlan = { x: cx, y: cy, reason: 'regroup' };  // no toggle — stay on this layer to tighten up
  }
  // Shaltari Voidgate: a weaponless positioning ship whose whole job is to park within 3"
  // of an Orbit dropsite for the Mothership to channel through. MCTS can't value that
  // multi-turn setup, so script it: General Quarters to close, Course Change to park (its
  // 0" minimum move lets a fast gate stop on target instead of overshooting). Overrides the
  // MCTS-chosen order/move for gates only.
  else if (def?.openNetwork && (def.gateship || 0) > 0) {
    const plan = gateRunnerPlan(state, gid, aiSide);
    if (plan && isLegal(state, { type: 'applyOrder', gid, order: plan.order }, aiSide)) {
      order = plan.order;
      movePlan = { x: plan.x, y: plan.y, reason: 'vp', toggle: plan.toggle };
    }
  }
  // Shaltari Mothership: shadow the forward gate and channel a drop the instant a connected
  // gate is parked within 3". Scripted because MCTS lets it drift out of the 18" network.
  else if ((def?.launch || []).some(l => l.type === 'gate_dropship')) {
    const plan = gateMotherPlan(state, gid, aiSide);
    if (plan && isLegal(state, { type: 'applyOrder', gid, order: plan.order }, aiSide)) {
      order = plan.order;
      movePlan = { x: plan.x, y: plan.y, reason: 'vp' };
      if (plan.launch) launchPlan = plan.launch;
    }
  }
  // Corvette: dive into Atmosphere to hunt enemy Descent ships / contest cities, rather than
  // loitering in Orbit where these fragile hulls just get shot. Scripted (MCTS won't do it).
  else if (/corvette/i.test(def?.role || '')) {
    const plan = corvettePlan(state, gid, aiSide);
    if (plan && isLegal(state, { type: 'applyOrder', gid, order: plan.order }, aiSide)) {
      order = plan.order;
      movePlan = { x: plan.x, y: plan.y, reason: 'kill', toggle: plan.toggle };
    }
  }
  // Descent droppers (Strike Carrier, Colony Ship etc.): must be IN Atmosphere to drop on cities.
  // Dropships require same-layer as the city (Atmosphere); loitering in Orbit next to a city can't
  // drop (groundLaunchInRange blocks it) and leaves the ship in the firing line. Script them to
  // descend when they can land on the target, closing in Orbit at full speed until then.
  else if (descentDropperPlan(state, gid, aiSide)) {
    const plan = descentDropperPlan(state, gid, aiSide);
    if (plan && isLegal(state, { type: 'applyOrder', gid, order: plan.order }, aiSide)) {
      order = plan.order;
      movePlan = { x: plan.x, y: plan.y, reason: 'vp', toggle: plan.toggle };
    }
  }

  // Formation discipline for multi-ship combat groups. General Quarters forces a ≥½-Thrust
  // move AND allows a 45° turn, so it breaks tight formations two ways:
  //   • a group already OUT of coherency can't tighten up — ships get flung apart (we saw a
  //     2-ship Frigate turn 45° left and 45° right on the same GQ activation, splitting it);
  //   • a coherent group HOLDING near its target is forced to overshoot and scatter.
  // Course Change (0" minimum, two 45° turns) is the DFC tool for both: when broken, collapse
  // onto the group centroid to regroup; when holding (target within the forced min move), keep
  // the plan but use CC so ships stay put. A coherent group with a genuinely distant target is
  // left on GQ so it still advances at full speed. WF/SR/MT can't turn — they move straight and
  // so keep formation already — so only a *broken* group is pulled off them (to enable a turn).
  else if (!def?.openNetwork && !def?.payload && (ORDERS[order]?.moveMin ?? 0) > 0) {
    const live = grp.ships.filter(s => !s.destroyed && !s.offTable);
    if (live.length >= 2 && isLegal(state, { type: 'applyOrder', gid, order: 'CC' }, aiSide)) {
      const cx = live.reduce((a, s) => a + s.x, 0) / live.length;
      const cy = live.reduce((a, s) => a + s.y, 0) / live.length;
      const broken = outOfFormationSet(state, def).size > 0;
      const minMovePx = (ORDERS[order].moveMin || 0) * (def.thrust || 8) * INCH;
      const targetDist = movePlan ? Math.hypot(movePlan.x - cx, movePlan.y - cy) : 0;
      const holdingOnGQ = order === 'GQ' && targetDist < minMovePx; // GQ would overshoot the target
      // GQ caps the turn at 45° AND forces a ≥½-Thrust move, so if the group must turn hard toward
      // its target — or its ships are facing different ways — the ships can't converge and split
      // apart (we saw a 2-ship Frigate end 15" apart chasing a target that needed a big turn). Course
      // Change (0" min move, two 45° turns) lets them reorient and stay together. Only triggers when
      // turning is actually needed, so a straight-ahead advance still uses fast GQ.
      const angDiff = (a, b) => { let d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return Math.abs(d); };
      const bearing = movePlan ? Math.atan2(movePlan.y - cy, movePlan.x - cx) * 180 / Math.PI : live[0].heading;
      const turnNeeded = movePlan && targetDist > 1 ? Math.min(...live.map(s => angDiff(bearing, s.heading))) : 0;
      let headingSpread = 0;
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) headingSpread = Math.max(headingSpread, angDiff(live[i].heading, live[j].heading));
      const wouldTurnBreak = order === 'GQ' && (turnNeeded > 45 || headingSpread > 45);
      if (broken || holdingOnGQ || wouldTurnBreak) {
        order = 'CC';
        if (broken) movePlan = { x: cx, y: cy, reason: 'regroup' };
      }
    }
  }

// FORMATION-SAFETY guard (runs after EVERY plan branch, so it also covers corvettes and descent
// droppers that have their own branches). An order whose total turn limit is less than how far the
// group must turn — yet still forces a move — flings divergent-heading ships apart: GQ caps at 45°,
// Silent Running and Max Thrust can't turn at all (we saw a Corvette scatter 23" diving on GQ and
// an Amethyst split 15" running straight on SR). Course Change (two 45° turns = 90°, 0" min move)
// lets the ships re-align and hold together. Regrouping a BROKEN group is handled above; this also
// catches a still-coherent group an order is about to break.
  if (!def?.openNetwork && !def?.payload) {
    const live2 = grp.ships.filter(s => !s.destroyed && !s.offTable);
    const ord = ORDERS[order] || {};
    const turnCap = (ord.turnLimit || 0) + (ord.turnLimit2 || 0);
    if (live2.length >= 2 && (ord.moveMin || 0) > 0 && order !== 'CC'
        && isLegal(state, { type: 'applyOrder', gid, order: 'CC' }, aiSide)) {
      const angDiff = (a, b) => { const d = Math.abs((((a - b) % 360) + 360) % 360); return d > 180 ? 360 - d : d; };
      let spread = 0;
      for (let i = 0; i < live2.length; i++) for (let j = i + 1; j < live2.length; j++) spread = Math.max(spread, angDiff(live2[i].heading || 0, live2[j].heading || 0));
      const cx = live2.reduce((a, s) => a + s.x, 0) / live2.length, cy = live2.reduce((a, s) => a + s.y, 0) / live2.length;
      let turnNeeded = 0;
      if (movePlan && Math.hypot(movePlan.x - cx, movePlan.y - cy) > INCH) {
        const bearing = Math.atan2(movePlan.y - cy, movePlan.x - cx) * 180 / Math.PI;
        turnNeeded = Math.min(...live2.map(s => angDiff(bearing, s.heading || 0)));
      }
      if (spread > turnCap + 10 || turnNeeded > turnCap + 10) order = 'CC';
    }
  }

// By the time buildActivation is called, the ship should be on-table (arrived).
  if (!applyFn({ type: 'applyOrder', gid, order })) return;
  // Open-network gates (Voidgates) that are established in the network read their PER-SHIP
  // order, not the group order — effectiveOrder() returns ship.order for in-network ships. The
  // group applyOrder above leaves ship.order null, which zeroes their move cone (they freeze in
  // place from round 2 on). Set each in-network gate's own order so it can actually move.
  // Voidgates ignore coherency, so each prong is steered to its OWN distinct dropsite. Compute the
  // per-ship targets once and reuse them for both per-ship orders and per-ship moves below.
  const gateSpread = def?.openNetwork && (def.gateship || 0) > 0;
  const gateTargets = gateSpread ? gateShipTargets(state, gid, aiSide) : [];
  const gateBySi = new Map(gateTargets.map(t => [t.si, t]));
  const gateThrustPx = (def?.thrust || 12) * INCH;

  if (def?.openNetwork) {
    grp.ships.forEach((s, si) => {
      if (!s.destroyed && !s.offTable && shipInNetwork(state, def, s)) {
        // Give each established gate its OWN order so a parked prong holds (Course Change, min move 0)
        // while prongs still approaching their own dropsite advance (General Quarters, full Thrust).
        const t = gateBySi.get(si);
        const sOrder = t ? (Math.hypot(t.x - s.x, t.y - s.y) <= 0.5 * gateThrustPx + 1 ? 'CC' : 'GQ') : order;
        applyFn({ type: 'applyShipOrder', gid, si, order: sOrder });
      }
    });
  }

  const tx = movePlan?.x ?? null;
  const ty = movePlan?.y ?? null;

  // Advance the whole group toward the target as a formation — coherency-guaranteed,
  // so a ship is never intentionally left out of formation.
  const movers = grp.ships
    .map((s, si) => ({ s, si }))
    .filter(o => !o.s.destroyed && !o.s.offTable && !o.s.movedThisRound);
  if (gateSpread && movers.length && gateTargets.length) {
    // Spread each prong to its own assigned dropsite, descending onto a city (Atmosphere) only on
    // the move that can actually reach it so it isn't stranded crawling at the 2"/turn Atmo cap.
    for (const { s, si } of movers) {
      const t = gateBySi.get(si);
      if (!t) continue;
      const inOrbit = (s.layer || 'orbit') === 'orbit';
      const dist = Math.hypot(t.x - s.x, t.y - s.y);
      const descend = t.atmosphere && inOrbit && dist <= gateThrustPx + 1;
      moveShipToward(state, rng, gid, si, t.x, t.y, applyFn, descend);
    }
  } else if (tx !== null && movers.length) {
    moveGroupCoherent(state, rng, gid, movers, tx, ty, applyFn, movePlan?.toggle ?? false);
  }

  // Launch fighters/bombers for orders that permit launching (GQ, WF, CC, SR).
  // MT and DC cannot launch. Each launch entry fires once per activation per ship.
  const NO_LAUNCH_SET = new Set(['MT', 'DC']);
  if (!NO_LAUNCH_SET.has(order) && def?.launch) {
    const launchShipIdx = grp.ships.findIndex(s => !s.destroyed && !s.offTable);
    if (launchShipIdx >= 0) {
      const launchShip = grp.ships[launchShipIdx];
      // fighter_bomber can launch as EITHER: bombers strike ships, fighters win the air. When the
      // enemy has no air to intercept, launch bombers to actually damage ships; otherwise launch
      // fighters to contest the air / screen our ships from enemy bombers.
      const enemyAir = enemyAirStrength(state, aiSide);
      // Place the asset up to 6" toward the nearest enemy ship (a head start to strike/intercept)
      // rather than sitting on the carrier where it does nothing this round.
      const tgt = nearestEnemyShipPt(state, aiSide, launchShip.x, launchShip.y);
      let lx = launchShip.x, ly = launchShip.y;
      if (tgt) {
        const d = Math.hypot(tgt.x - launchShip.x, tgt.y - launchShip.y) || 1;
        const step = Math.min(6 * INCH, d);
        lx = launchShip.x + (tgt.x - launchShip.x) / d * step;
        ly = launchShip.y + (tgt.y - launchShip.y) / d * step;
      }
      def.launch.forEach((l, li) => {
        if (l.type !== 'fighter_bomber' && l.type !== 'bomber') return;
        const capacity = l.n || 1;
        const alreadyLaunched = launchShip.launchedThisRound || 0;
        if (alreadyLaunched >= capacity) return;
        const count = capacity - alreadyLaunched;
        const kind  = l.type === 'bomber' ? 'bomber'
                    : (enemyAir === 0 ? 'bomber' : 'fighter');
        applyFn({ type: 'launchAsset', gid, si: launchShipIdx, li, kind, count, x: Math.round(lx), y: Math.round(ly) });
      });
    }
  }

  // Firing: only orders that permit it. MT and SR are move-only / no-fire.
  const NO_FIRE_ORDERS = new Set(['MT', 'SR']);

  // Guy Fawkes Fire Ship: its only weapon is Explosive Detonation — an AoE that hits every
  // ship (friendly AND enemy) on its layer within 6", then removes the ship. Detonate once
  // the (post-move) blast catches a worthwhile cluster: at least one enemy and enemy hull
  // in radius ≥ friendly hull (don't fry our own fleet). Never fire it as a normal weapon.
  const isFawkes = /Explosive Detonation/i.test(def?.special || '');
  if (isFawkes && !NO_FIRE_ORDERS.has(order)) {
    const dsi = grp.ships.findIndex(s => !s.destroyed && !s.offTable);
    const sh = dsi >= 0 ? grp.ships[dsi] : null;
    if (sh) {
      const layer = sh.layer || 'orbit', R = 6 * INCH + 1;
      let enemyHull = 0, friendHull = 0, enemyCount = 0;
      for (const g of Object.values(state.groups)) {
        for (let i = 0; i < g.ships.length; i++) {
          const t = g.ships[i];
          if (t.destroyed || t.offTable) continue;
          if (g === grp && i === dsi) continue;
          if ((t.layer || 'orbit') !== layer) continue;
          if (Math.hypot(t.x - sh.x, t.y - sh.y) > R) continue;
          if (g.def?.side === aiSide) friendHull += t.hull || 0;
          else { enemyHull += t.hull || 0; enemyCount++; }
        }
      }
      if (enemyCount > 0 && enemyHull >= friendHull && applyFn({ type: 'explosiveDetonation', gid, si: dsi })) {
        applyFn({ type: 'dismissDetonation' });
        applyFn({ type: 'finishActivation', gid });
        return;
      }
    }
  }

  // Detector ships spike a high-value enemy for the fleet instead of firing their own weak gun.
  let detectorUsed = false;
  if (!NO_FIRE_ORDERS.has(order)) {
    const dp = detectorPlan(state, gid, aiSide);
    if (dp && isLegal(state, { type: 'useDetector', gid, ...dp }, aiSide)) {
      applyFn({ type: 'useDetector', gid, ...dp });
      detectorUsed = true;
    }
  }

  if (!detectorUsed && !isFawkes && !NO_FIRE_ORDERS.has(order) && def?.weapons) {
    const fireSi = grp.ships.findIndex(s => !s.destroyed && !s.offTable);
    if (fireSi >= 0) {
      const fireShip = grp.ships[fireSi];
      const inOrbit  = (fireShip.layer || 'orbit') === 'orbit';

      for (let wi = 0; wi < def.weapons.length; wi++) {
        const w = def.weapons[wi];
        const isBombardment = /Bombardment/i.test(w.special || '');

        if (isBombardment && inOrbit) {
          // Bombardment weapons: target enemy dropsites within scan range.
          // lockBombardmentTarget gating enforces arc + scan range; we just find the best candidate.
          const scan = def.scan ?? 6;
          const dsTarget = findBestBombardmentTarget(state, aiSide, fireShip, scan);
          if (dsTarget) {
            applyFn({ type: 'lockBombardmentTarget', gid, si: fireSi, wi, dsId: dsTarget.id });
          }
        } else {
          // Standard weapons: target enemy ships.
          const t = findBestTarget(state, gid, fireSi, wi, aiSide);
          if (t) applyFn({ type: 'lockWeaponTarget', gid, si: fireSi, wi, targetGid: t.gid, targetSi: t.si });
        }
      }
    }
    if (applyFn({ type: 'fireWeapons', gid })) {
      // UCM Mass Driver Volley: spend 2 AP for Lock +1 on this Group's Mass Drivers, but only on
      // the Group with the most Mass Driver shots (6400s prioritised over 4200s) so the AI reserves
      // its AP for its best volley rather than burning it on the first Mass Driver group it fires.
      const M = state.attackModal;
      if (M && M.shots?.some(sh => /Mass Driver/i.test(sh.w?.name || ''))
          && shouldUseMassDriverVolley(state, gid, aiSide)) {
        applyFn({ type: 'setMassDriverVolley' });
      }
      resolveAttackModal(state, rng, applyFn);
    }
  }

  // Launch ground assets if a launch plan was provided (dropships / bulk landers / gate_dropship).
  // GQ/WF/CC/SR permit launch; MT and DC do not.
  const NO_LAUNCH_ORDERS = new Set(['MT', 'DC']);
  if (launchPlan && !NO_LAUNCH_ORDERS.has(order)) {
    const { li, dsId, count, type: launchType } = launchPlan;
    const launchSi = grp.ships.findIndex(s => !s.destroyed && !s.offTable);
    if (launchSi >= 0 && dsId) {
      if (launchType === 'gate_dropship') {
        // Find a connected Voidgate within 3" of the target dropsite on the SAME layer
        // (atmosphere for cities) — the drop is channelled through it.
        const ds = state.scenarioData?.dropsites?.find(d => d.id === dsId);
        if (ds) {
          const dsLayer = ds.base?.layer === 'Atmosphere' ? 'atmosphere' : 'orbit';
          // Validate Voidgate is reachable via the 18" connected network from the Mothership.
          const motherShip = grp.ships[launchSi];
          const reachable  = motherShip
            ? connectedGateships(state, def.side, motherShip.x, motherShip.y)
            : [];
          const reachableKey = new Set(reachable.map(g => `${g.def.id}:${g.si}`));
          let bestGate = null, bestDist = Infinity;
          for (const [egid, eg] of Object.entries(state.groups)) {
            if (eg.def?.side !== def.side || !eg.def?.gateship) continue;
            eg.ships.forEach((s, si) => {
              if (s.destroyed || s.offTable) return;
              if ((s.layer || 'orbit') !== dsLayer) return;      // gate & dropsite must share a layer
              if (!reachableKey.has(`${egid}:${si}`)) return;    // outside Mothership's network
              const d = Math.hypot(s.x - ds.x * INCH, s.y - ds.y * INCH);
              if (d < bestDist && d <= 3 * INCH) { bestDist = d; bestGate = { gid: egid, si }; }
            });
          }
          if (bestGate) {
            applyFn({ type: 'launchGroundAsset', gid, si: launchSi, li, dsId, count, locationKey: 'ground', gateSel: bestGate });
          }
        }
      } else {
        // Only land battalions if the ship is genuinely within launch range (and on
        // the right layer / a city for drop pods) — the launch gating doesn't check.
        const ds = state.scenarioData?.dropsites?.find(d => d.id === dsId);
        if (groundLaunchInRange(launchType, grp.ships[launchSi], ds)) {
          // Bulk Landers drop half (rounded down) into a contested dropsite — match the
          // client; skip if that rounds to zero.
          let landCount = count;
          if (launchType === 'bulk_lander' && dsEnemyBattalions(ds, def.side) > 0) landCount = Math.floor(count / 2);
          if (landCount > 0) applyFn({ type: 'launchGroundAsset', gid, si: launchSi, li, dsId, count: landCount, locationKey: 'ground' });
        }
      }
    }
  }

  // Extract Recon Operatives on Extract missions (any ship with transport value within range,
  // including Shaltari Motherships whose connected Voidgates are within 6" of the dropsite).
  if (state.scenario?.objective === 'extract' && !NO_LAUNCH_ORDERS.has(order)) {
    const exDropsites = state.scenarioData?.dropsites || [];
    const exSi = grp.ships.findIndex(s => !s.destroyed && !s.offTable && !s.firedThisActivation && !(s.launchedThisRound > 0));
    if (exSi >= 0 && transportValue(def) > 0) {
      const exShip = grp.ships[exSi];
      const isGateMother = (def.launch || []).some(l => l.type === 'gate_dropship');
      const reachable = isGateMother ? connectedGateships(state, def.side, exShip.x, exShip.y) : [];
      for (const exDs of exDropsites) {
        if (!exDs || exDs.destroyed || !(exDs.reconOps > 0)) continue;
        const directDist = Math.hypot(exShip.x - exDs.x * INCH, exShip.y - exDs.y * INCH);
        const viaGate = isGateMother && reachable.some(g => Math.hypot(g.x - exDs.x * INCH, g.y - exDs.y * INCH) <= 6 * INCH);
        if (directDist <= 6 * INCH || viaGate) {
          if (isLegal(state, { type: 'extractRecon', gid, si: exSi, dsId: exDs.id }, def.side)) {
            applyFn({ type: 'extractRecon', gid, si: exSi, dsId: exDs.id });
            break; // one extract per activation
          }
        }
      }
    }
  }

  applyFn({ type: 'finishActivation', gid });
}
