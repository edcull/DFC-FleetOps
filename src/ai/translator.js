// Expands an activation-level option into a concrete intent sequence.
// Mutates state directly via applyFn so post-move targeting is accurate.

import { INCH } from '../engine/constants.js';
import { moveCone, dsEnemyBattalions, dsBattalions, connectedGateships, coherencyInches } from '../engine/mutators.js';
import { isLegal } from '../engine/gating.js';
import { bestMoveToward, findBestTarget, baseDiameterPx, gateRunnerPlan, gateMotherPlan } from './options.js';

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
  for (let i = 0; i < pts.length; i++) {
    let neighbours = 0;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      if ((pts[i].layer || 'orbit') !== (pts[j].layer || 'orbit')) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) <= cohPx) neighbours++;
    }
    if (neighbours < need) return false;
  }
  return true;
}

// N distinct target slots packed around (cx,cy), each ~one base diameter apart, so the
// group's ships aim at *different* points. Aiming them all at one spot makes them pile up,
// and the engine resolves the overlap by shoving ships back along their shared path — the
// "conga line". Concentric rings keep every slot at least a base diameter from the others.
function packSlots(cx, cy, n, diamPx) {
  const slots = [{ x: cx, y: cy }];
  const spacing = diamPx + 2;
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

  const cones = {};
  let reach = Infinity;
  for (const { si } of movers) {
    const mc = moveCone(state, gid, si, toggle);
    cones[si] = mc;
    if (mc.o && mc.o.moveMax > 0) reach = Math.min(reach, mc.maxR - 1);
  }
  if (!isFinite(reach)) reach = 0;

  const cx = movers.reduce((a, o) => a + o.s.x, 0) / movers.length;
  const cy = movers.reduce((a, o) => a + o.s.y, 0) / movers.length;
  const dC = Math.hypot(tx - cx, ty - cy) || 1;
  const ux = (tx - cx) / dC, uy = (ty - cy) / dC;

  // For an advance: pack distinct slots around the waypoint, give each ship its nearest
  // free slot, and simulate each ship's reachable move toward it.
  const planAt = (adv) => {
    const wx = cx + ux * adv, wy = cy + uy * adv;
    const slots = packSlots(wx, wy, movers.length, diamPx);
    const used = new Array(slots.length).fill(false);
    const target = {};
    for (const { s, si } of movers) {
      let bi = 0, bd = Infinity;
      for (let k = 0; k < slots.length; k++) {
        if (used[k]) continue;
        const d = (s.x - slots[k].x) ** 2 + (s.y - slots[k].y) ** 2;
        if (d < bd) { bd = d; bi = k; }
      }
      used[bi] = true; target[si] = slots[bi];
    }
    const dests = movers.map(({ s, si }) => {
      const mc = cones[si];
      if (!mc.o || mc.o.moveMax <= 0) return { x: s.x, y: s.y, layer: s.layer };
      const d = bestMoveToward(s, mc, target[si].x, target[si].y);
      return { x: d.x, y: d.y, layer: s.layer };
    });
    return { target, dests };
  };

  let chosen = null;
  for (const frac of [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.12, 0]) {
    const cand = planAt(Math.min(reach * frac, dC));
    if (formationOK(cand.dests, cohPx, need) && nonOverlapOK(cand.dests, diamPx)) { chosen = cand; break; }
  }
  if (!chosen) chosen = planAt(0); // converge on the centroid — least overlap available
  for (const { si } of movers) {
    const t = chosen.target[si];
    moveShipToward(state, rng, gid, si, t.x, t.y, applyFn, toggle);
  }
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
function resolveAttackModal(state, rng, applyFn) {
  let guard = 80;
  while (state.attackModal && guard-- > 0) {
    const M = state.attackModal;
    let to = null;

    switch (M.step) {
      case 'intro':
        to = 'hit';
        break;
      case 'hit':
        if (M.hitResult) to = 'save';    // rollSaves (handles 0-hit skip internally)
        else to = 'hit';                  // shouldn't happen; retry
        break;
      case 'save': {
        if (!M.saveResult) { to = 'save'; break; }
        const sr = M.saveResult;
        const needBackup = !sr.backupRolled && sr.hitsList &&
          sr.hitsList.some(h => !h.saved && h.sv != null) && sr.backupVal != null;
        to = needBackup ? 'rollbackup' : 'apply';
        break;
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

  // Shaltari Voidgate: a weaponless positioning ship whose whole job is to park within 3"
  // of an Orbit dropsite for the Mothership to channel through. MCTS can't value that
  // multi-turn setup, so script it: General Quarters to close, Course Change to park (its
  // 0" minimum move lets a fast gate stop on target instead of overshooting). Overrides the
  // MCTS-chosen order/move for gates only.
  if (def?.openNetwork && (def.gateship || 0) > 0) {
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
  // (Normal bulk-lander/dropship droppers are intentionally NOT forced onto Course Change:
  // their 6" launch range reaches dropsites from Orbit without the gate's tight 3"/same-layer
  // constraint, so they already drop reliably; forcing CC's ½-Thrust cap only slows them.)

// By the time buildActivation is called, the ship should be on-table (arrived).
  if (!applyFn({ type: 'applyOrder', gid, order })) return;

  const tx = movePlan?.x ?? null;
  const ty = movePlan?.y ?? null;

  // Advance the whole group toward the target as a formation — coherency-guaranteed,
  // so a ship is never intentionally left out of formation.
  const movers = grp.ships
    .map((s, si) => ({ s, si }))
    .filter(o => !o.s.destroyed && !o.s.offTable && !o.s.movedThisRound);
  if (tx !== null && movers.length) {
    moveGroupCoherent(state, rng, gid, movers, tx, ty, applyFn, movePlan?.toggle ?? false);
  }

  // Launch fighters/bombers for orders that permit launching (GQ, WF, CC, SR).
  // MT and DC cannot launch. Each launch entry fires once per activation per ship.
  const NO_LAUNCH_SET = new Set(['MT', 'DC']);
  if (!NO_LAUNCH_SET.has(order) && def?.launch) {
    const launchShipIdx = grp.ships.findIndex(s => !s.destroyed && !s.offTable);
    if (launchShipIdx >= 0) {
      const launchShip = grp.ships[launchShipIdx];
      def.launch.forEach((l, li) => {
        if (l.type !== 'fighter_bomber' && l.type !== 'bomber') return;
        const capacity = l.n || 1;
        const alreadyLaunched = launchShip.launchedThisRound || 0;
        if (alreadyLaunched >= capacity) return;
        const count = capacity - alreadyLaunched;
        const kind  = l.type === 'bomber' ? 'bomber' : 'fighter';
        applyFn({ type: 'launchAsset', gid, si: launchShipIdx, li, kind, count,
                  x: launchShip.x, y: launchShip.y });
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

  if (!isFawkes && !NO_FIRE_ORDERS.has(order) && def?.weapons) {
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

  applyFn({ type: 'finishActivation', gid });
}
