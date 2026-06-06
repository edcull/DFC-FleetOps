// Expands an activation-level option into a concrete intent sequence.
// Mutates state directly via applyFn so post-move targeting is accurate.

import { INCH } from '../engine/constants.js';
import { moveCone, dsEnemyBattalions, dsBattalions, connectedGateships } from '../engine/mutators.js';
import { bestMoveToward, findBestTarget } from './options.js';

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
        const ds = state.scenarioData?.dropsites?.find(d => d.id === q.dsId);
        let loc = 'ground';
        if (ds) {
          const b = dsBattalions(ds);
          if (!b.ground || (b.ground[q.side] || 0) === 0) {
            const alt = Object.keys(b).find(k => k !== 'ground' && (b[k][q.side] || 0) > 0);
            if (alt) loc = alt;
          }
        }
        if (!applyFn({ type: 'resolveBombardCollateral', loc })) { to = null; }
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

// Move a single ship toward (tx, ty), handling post-move aiming state.
function moveShipToward(state, rng, gid, si, tx, ty, applyFn) {
  const ship = state.groups[gid]?.ships[si];
  if (!ship || ship.destroyed || ship.offTable || ship.movedThisRound) return false;
  const mc = moveCone(state, gid, si, false);
  if (!mc.o || mc.o.moveMax <= 0) return false;

  const dest = bestMoveToward(ship, mc, tx, ty);
  const moved = applyFn({ type: 'moveShip', gid, si, x: Math.round(dest.x), y: Math.round(dest.y), layerToggle: false });
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

// By the time buildActivation is called, the ship should be on-table (arrived).
  if (!applyFn({ type: 'applyOrder', gid, order })) return;

  const tx = movePlan?.x ?? null;
  const ty = movePlan?.y ?? null;

  // Move lead ship first
  const leadSi = grp.ships.findIndex(s => !s.destroyed && !s.offTable && !s.movedThisRound);
  let leadDestX = null, leadDestY = null;

  if (leadSi >= 0 && tx !== null) {
    const ship = grp.ships[leadSi];
    const mc = moveCone(state, gid, leadSi, false);
    if (mc.o && mc.o.moveMax > 0) {
      const dest = bestMoveToward(ship, mc, tx, ty);
      leadDestX = Math.round(dest.x);
      leadDestY = Math.round(dest.y);
      moveShipToward(state, rng, gid, leadSi, tx, ty, applyFn);
    }
  }

  // Move remaining ships toward the same destination as the lead.
  // Using the identical target avoids distance/angle gating failures that arise
  // from derived offset positions landing just outside the ship's move cone.
  // Ships that end up at the same pixel are fine in DFC (stacking is allowed).
  const followX = leadDestX ?? tx ?? null;
  const followY = leadDestY ?? ty ?? null;

  for (let si = 0; si < grp.ships.length; si++) {
    if (si === leadSi) continue;
    const s = grp.ships[si];
    if (s.destroyed || s.offTable || s.movedThisRound) continue;
    if (followX !== null) moveShipToward(state, rng, gid, si, followX, followY, applyFn);
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
  if (!NO_FIRE_ORDERS.has(order) && def?.weapons) {
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
        // Find a Voidgate on the AI's side within 3" of the target dropsite.
        const ds = state.scenarioData?.dropsites?.find(d => d.id === dsId);
        if (ds) {
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
              if (!reachableKey.has(`${egid}:${si}`)) return; // outside Mothership's network
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
