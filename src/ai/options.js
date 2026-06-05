// AI option generator — produces activation-level choices for the fallback scorer.
// Does NOT call legalActions() (which only covers pass/endRound/commitScenario).
// Instead generates candidates and validates each with isLegal().

import { ORDERS, INCH } from '../engine/constants.js';
import { isLegal } from '../engine/gating.js';
import { moveCone, weaponCanTarget, dropsiteController, canDeployNow } from '../engine/mutators.js';

const BOARD_PX = 48 * INCH;
const TONNAGE_ORDER = { C: 0, H: 1, M: 2, L: 3 };

// Ground-asset launch ranges (inches). gate_dropship needs the Voidgate network
// (handled separately in the activation handler), so it's excluded here.
const LAUNCH_RANGE = { dropship: 3, bulk_lander: 6, drop_pod: 6 };
const NO_LAUNCH_ORDERS = new Set(['MT', 'DC']);

function defIsDropper(def) {
  return !!def && (def.launch || []).some(l => LAUNCH_RANGE[l.type] != null);
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
    .sort(([, a], [, b]) => (TONNAGE_ORDER[a.def?.tonnage] ?? 4) - (TONNAGE_ORDER[b.def?.tonnage] ?? 4));

  // Reserve groups (all ships still off-table) can't receive orders — skip them here.
  // buildActivation handles them via the allOffTable fast-finish path.

  for (const [gid, grp] of groups) {
    if (options.length >= 8) break;
    const validOrders = Object.keys(ORDERS).filter(o => isLegal(state, { type: 'applyOrder', gid, order: o }, aiSide));
    if (!validOrders.length) continue;

    const moveCandidates = candidateTargets(state, gid, aiSide);
    const si = grp.ships.findIndex(s => !s.destroyed && !s.offTable);

    // Drop-capable groups: plan to land battalions at the nearest reachable dropsite,
    // and try launch-permitting orders first so that option actually gets generated.
    const dropper  = defIsDropper(grp.def);
    const dropPlan = dropper ? dropLaunchPlan(state, grp, grp.ships[si], aiSide) : null;
    const orderList = dropper
      ? [...validOrders].sort((a, b) => (NO_LAUNCH_ORDERS.has(a) ? 1 : 0) - (NO_LAUNCH_ORDERS.has(b) ? 1 : 0))
      : validOrders;

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
          // Drop battalions when this order can launch and we're heading to a dropsite.
          launchPlan: (dropPlan && !NO_LAUNCH_ORDERS.has(order) && dest.reason === 'vp') ? dropPlan : null,
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
  const deployZone = state.deployZone?.[aiSide] || 'south';
  const dropsites = state.scenarioData?.dropsites || [];
  const centerY = deployZone === 'south' ? BOARD_PX * 0.82 : BOARD_PX * 0.18;

  const nearDs = dropsites
    .filter(d => !d.destroyed)
    .sort((a, b) => Math.abs(a.y * INCH - centerY) - Math.abs(b.y * INCH - centerY))[0];

  for (const [gid, grp] of Object.entries(state.groups)) {
    if (grp.def?.side !== aiSide) continue;
    // Only deploy ships that are eligible now (vanguard or directly_deploy approach).
    if (!canDeployNow(state, grp.def)) continue;
    // Ships awaiting deployment are offTable=true — find one to place.
    const si = grp.ships.findIndex(s => !s.destroyed && s.offTable);
    if (si < 0) continue;
    if (!isLegal(state, { type: 'deployShip', gid, si }, aiSide)) continue;

    const heading = deployZone === 'south' ? -90 : 90; // face north or south
    const positions = [
      { x: BOARD_PX / 2, y: centerY },
      nearDs ? { x: nearDs.x * INCH, y: centerY } : null,
      { x: BOARD_PX * 0.35, y: centerY },
      { x: BOARD_PX * 0.65, y: centerY },
    ].filter(Boolean);

    for (const pos of positions) {
      opts.push({ id: `opt_dep_${gid}_${opts.length}`, gid, si, x: pos.x, y: pos.y, heading });
      break; // one candidate per group per call
    }
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
