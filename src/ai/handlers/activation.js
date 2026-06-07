import { generateActivationOptions, mapLlmOptions, deployZoneFor, legalZonePosPx, baseDiameterPx, placeNonOverlap, gateRunnerPlan, gateMotherPlan } from '../options.js';
import { mctsChooseOption } from '../mcts.js';
import { buildActivation } from '../translator.js';
import { buildStateBriefing, buildGroupCapabilities } from '../state-parser.js';
import { llmAvailable, llmGenerateOptions } from '../llm.js';
import { canActivateOffTable, dropsiteController } from '../../engine/mutators.js';
import { payloadShips } from '../../engine/state.js';
import { INCH } from '../../engine/constants.js';

const BOARD_PX = 48 * INCH;

// Arrive all ships in a group at the deployment edge, x-aligned with their primary target.
function arriveGroup(state, gid, grp, aiSide, applyFn, overrideTargetX = null) {
  const zoneName = state.deployZone?.[aiSide] || 'south';
  const zoneGeo  = deployZoneFor(state, aiSide); // legal arrival region (in-zone constraint)
  const edgeY   = zoneName === 'south' ? BOARD_PX - INCH : INCH;
  const heading = zoneName === 'south' ? -90 : 90;
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  const dropsites = state.scenarioData?.dropsites || [];
  const def = grp.def;
  const shipLayer = 'orbit'; // off-table ships always arrive in orbit

  let targetX = overrideTargetX ?? BOARD_PX / 2;

  if (overrideTargetX === null) {
    const hasDropCap = (def?.launch || []).some(l => l.type === 'bulk_lander' || l.type === 'dropship')
                    || (def?.launch || []).some(l => l.type === 'gate_dropship')
                    || def?.gateship > 0; // Voidgates position near dropsites too
    if (hasDropCap) {
      const hasBulk = (def?.launch || []).some(l => l.type === 'bulk_lander' || l.type === 'drop_pod');
      const dsCandidates = dropsites.filter(ds => !ds.destroyed && dropsiteController(ds) !== aiSide);
      const preferred = hasBulk
        ? dsCandidates.filter(ds => ds.base?.layer === 'Atmosphere')
        : dsCandidates.filter(ds => (ds.base?.layer === 'Atmosphere' ? 'atmosphere' : 'orbit') === shipLayer);
      const pool = preferred.length ? preferred : dsCandidates;
      const vpDs = pool.sort((a, b) => Math.abs(a.x * INCH - BOARD_PX / 2) - Math.abs(b.x * INCH - BOARD_PX / 2))[0];
      if (vpDs) targetX = vpDs.x * INCH;
    } else {
      let bestDist = Infinity;
      for (const [, eg] of Object.entries(state.groups)) {
        if (eg.def?.side !== enemySide) continue;
        for (const es of eg.ships) {
          if (es.destroyed || es.offTable) continue;
          const d = Math.abs(es.x - BOARD_PX / 2);
          if (d < bestDist) { bestDist = d; targetX = es.x; }
        }
      }
    }
  }

  // Anchor the group inside the legal deployment zone near targetX on the friendly edge,
  // then arrive each ship at a spot whose base doesn't overlap a group-mate's, so they
  // stay in their zone and in formation without conga-lining.
  const clampX = v => Math.max(INCH * 2, Math.min(BOARD_PX - INCH * 2, v));
  const anchor = legalZonePosPx(zoneGeo, clampX(targetX), edgeY) || { x: clampX(targetX), y: edgeY };
  const diamPx = baseDiameterPx(def);
  // Avoid overlapping ANY friendly ship already on the table (every group), not just this
  // group's — cross-group overlap is what gets resolved into a conga line.
  const rSelf = diamPx / 2;
  const placedPos = [];
  for (const g of Object.values(state.groups)) {
    if (g.def?.side !== aiSide) continue;
    const gr = baseDiameterPx(g.def) / 2;
    for (const s of g.ships) if (!s.destroyed && !s.offTable) placedPos.push({ x: s.x, y: s.y, r: gr });
  }
  const liveShips = grp.ships.map((s, si) => ({ s, si })).filter(({ s }) => !s.destroyed && s.offTable);
  liveShips.forEach(({ si }) => {
    const pos = placeNonOverlap(anchor.x, anchor.y, placedPos, diamPx, zoneGeo);
    placedPos.push({ x: pos.x, y: pos.y, r: rSelf });
    applyFn({ type: 'arriveShip', gid, si, x: Math.round(pos.x), y: Math.round(pos.y), heading });
  });
}

// Drop sequencing (Shaltari): the un-activated, on-table Voidgate that should position this
// round, picked as the one nearest its objective so the closest gate parks first. Returns
// { gid, plan } | null.
function pickGateToPosition(state, aiSide) {
  let best = null, bestDist = Infinity;
  for (const [gid, grp] of Object.entries(state.groups)) {
    const def = grp.def;
    if (def?.side !== aiSide || grp.activated) continue;
    if (!def.openNetwork || !(def.gateship > 0)) continue;
    const si = grp.ships.findIndex(s => !s.destroyed && !s.offTable);
    if (si < 0) continue;
    const plan = gateRunnerPlan(state, gid, aiSide);
    if (!plan) continue;
    const sh = grp.ships[si];
    const d = Math.hypot(sh.x - plan.x, sh.y - plan.y);
    if (d < bestDist) { bestDist = d; best = { gid, plan }; }
  }
  return best;
}

// An un-activated, on-table Mothership whose connected gate is already parked within 3" of a
// contestable dropsite (same layer), so it can channel a drop right now. Returns { gid, plan } | null.
function pickMotherToChannel(state, aiSide) {
  for (const [gid, grp] of Object.entries(state.groups)) {
    const def = grp.def;
    if (def?.side !== aiSide || grp.activated) continue;
    if (!(def.launch || []).some(l => l.type === 'gate_dropship')) continue;
    if (!grp.ships.some(s => !s.destroyed && !s.offTable)) continue;
    const plan = gateMotherPlan(state, gid, aiSide);
    if (plan?.launch) return { gid, plan };
  }
  return null;
}

export async function handleActivation(state, rng, aiSide, personality, applyFn, useLlm = false) {
  // Auto-finish reserve groups that have nothing to bring on this round: either no
  // live ship left to arrive (e.g. wiped out mid-round — canActivateOffTable doesn't
  // check for survivors, so without this the AI loops forever "arriving" a dead group)
  // or not yet eligible to arrive.
  for (const [gid, grp] of Object.entries(state.groups)) {
    if (grp.def?.side !== aiSide || grp.activated) continue;
    if (!grp.ships.every(s => s.destroyed || s.offTable)) continue;
    const hasLiveReserve = grp.ships.some(s => !s.destroyed && s.offTable);
    const { eligible } = canActivateOffTable(state, grp.def);
    if (!hasLiveReserve || !eligible) {
      if (applyFn({ type: 'finishActivation', gid })) return;
    }
    // Eligible reserve groups with live ships: leave them — LLM or heuristic chooses which to arrive.
  }

  // Finish any group that already ACTED this round (moved/fired/launched) but couldn't finish its
  // activation because its attack was still mid-resolution. In AI-vs-AI the defender drives the
  // save step, so the attacker's buildActivation hits an open attackModal and finishActivation
  // fails — leaving the group un-activated. Without this it gets re-picked and RE-FIRES every cycle
  // (one Topaz Frigate fired its weapon 12 times in a single round). Now the modal is closed (the
  // defender resolved the save), so finish it instead of activating it again.
  if (!state.attackModal) {
    for (const [gid, grp] of Object.entries(state.groups)) {
      if (grp.def?.side !== aiSide || grp.activated) continue;
      const acted = grp.ships.some(s => !s.destroyed &&
        (s.movedThisRound || s.firedThisActivation || (s.launchedThisRound > 0)));
      if (acted && applyFn({ type: 'finishActivation', gid })) return;
    }
  }

  // Drop sequencing: position Voidgates FIRST so a connected Mothership can channel a drop the
  // same round; then activate any Mothership whose gate is already parked to drop NOW. Gates are
  // weaponless positioning ships, so front-loading them costs no combat tempo, and it's the only
  // way the multi-step gate drop (park → channel) completes inside a single round. This runs
  // before the LLM/MCTS choice because it's mechanical, always-correct play the search can't see.
  const gatePos = pickGateToPosition(state, aiSide);
  if (gatePos) {
    buildActivation(state, rng, gatePos.gid, gatePos.plan.order,
      { x: gatePos.plan.x, y: gatePos.plan.y, reason: 'vp', toggle: gatePos.plan.toggle },
      aiSide, applyFn, null);
    // Guard against a loop if the scripted order was somehow rejected: only consume the
    // activation if the group actually finished; otherwise fall through to normal selection.
    if (state.groups[gatePos.gid]?.activated) return;
  }
  const motherReady = pickMotherToChannel(state, aiSide);
  if (motherReady) {
    buildActivation(state, rng, motherReady.gid, motherReady.plan.order,
      { x: motherReady.plan.x, y: motherReady.plan.y, reason: 'vp' },
      aiSide, applyFn, motherReady.plan.launch);
    if (state.groups[motherReady.gid]?.activated) return;
  }

  // Ask LLM BEFORE arriving any ship.
  // The state briefing already shows reserve ships with entry positions so the LLM
  // can reason about them. We arrive the chosen ship only after the choice is made.
  const progOptions = generateActivationOptions(state, aiSide); // on-table ships only
  let options = progOptions;
  let chosen;

  if (useLlm && llmAvailable) {
    const briefing     = buildStateBriefing(state, aiSide);
    const capabilities = buildGroupCapabilities(state, aiSide);
    try {
      const result = await llmGenerateOptions(briefing, capabilities, personality);
      if (result?.lines?.length) {
        const llmOptions = mapLlmOptions(result.lines, state, aiSide);
        const seenGroups = new Set(llmOptions.map(o => o.groupId));
        const fallback = progOptions.filter(o => !seenGroups.has(o.groupId));
        options = [...llmOptions, ...fallback];
        if (result.chosenIdx !== null && result.chosenIdx < llmOptions.length) {
          chosen = llmOptions[result.chosenIdx];
          console.log(`[AI] LLM chose: ${chosen.label}`);
        }
      }
    } catch { /* generation failed — fall through to heuristic */ }
  }

  // If no options at all (all ships still off-table, LLM failed), arrive the first
  // eligible reserve group so the heuristic has something to work with.
  if (!options.length && !chosen) {
    for (const [gid, grp] of Object.entries(state.groups)) {
      if (grp.def?.side !== aiSide || grp.activated) continue;
      if (!grp.ships.some(s => !s.destroyed && s.offTable)) continue; // need a live ship to arrive
      const { eligible } = canActivateOffTable(state, grp.def);
      if (!eligible) continue;
      arriveGroup(state, gid, grp, aiSide, applyFn);
      return; // next triggerAi call activates this group
    }
    return;
  }

  if (!chosen) chosen = mctsChooseOption(options, state, rng, aiSide, { weights: personality?.weights });
  if (!chosen) return;
  if (!chosen.groupId) { applyFn({ type: 'pass' }); return; }

  // Arrive the chosen group if it's still off-table — BEFORE calling buildActivation.
  const chosenGrp = state.groups[chosen.groupId];
  if (chosenGrp?.ships.every(s => s.destroyed || s.offTable)) {
    // Use movePlan.x as the arrival x if the LLM provided coordinates
    const overrideX = chosen.movePlan?.x ?? null;
    arriveGroup(state, chosen.groupId, chosenGrp, aiSide, applyFn, overrideX);
  }

  // Bioficer porter: deploy attached payload cells BEFORE applying the porter's order,
  // then activate each cell immediately. The porter's finishActivation is blocked
  // (cellPending) until every deployed cell has moved, so cells must act first.
  // Detect porters by object property OR by "Porter" in special text (large Bioficer porters)
  const isPorter = chosenGrp?.def?.porter || /\bPorter\b/i.test(chosenGrp?.def?.special || '');
  if (isPorter) {
    const cells = payloadShips(state, aiSide).filter(p =>
      p.ship.attachedTo?.gid === chosen.groupId && p.ship.offTable && !p.ship.destroyed
    );
    for (const cell of cells) {
      const porterSi = cell.ship.attachedTo.si;
      const porter   = chosenGrp.ships[porterSi];
      if (!porter || porter.offTable) continue;
      // Place cell 2" ahead of the porter (in its heading direction).
      const rad = (porter.heading ?? -90) * Math.PI / 180;
      const cx  = Math.round(Math.max(INCH * 2, Math.min(BOARD_PX - INCH * 2, porter.x + Math.cos(rad) * INCH * 2)));
      const cy  = Math.round(Math.max(INCH * 2, Math.min(BOARD_PX - INCH * 2, porter.y + Math.sin(rad) * INCH * 2)));
      if (!applyFn({ type: 'deployPayload', gid: cell.gid, si: cell.si, porterGid: chosen.groupId, porterSi, x: cx, y: cy })) continue;
      // Cell gets order=GQ automatically from deployPayload; apply it and move toward a dropsite.
      if (applyFn({ type: 'applyOrder', gid: cell.gid, order: 'GQ' })) {
        const ds = (state.scenarioData?.dropsites || [])
          .filter(d => !d.destroyed && dropsiteController(d) !== aiSide)
          .sort((a, b) => Math.hypot(cx - a.x*INCH, cy - a.y*INCH) - Math.hypot(cx - b.x*INCH, cy - b.y*INCH))[0];
        const tx = ds ? ds.x * INCH : cx;
        const ty = ds ? ds.y * INCH : cy;
        buildActivation(state, rng, cell.gid, 'GQ', { x: tx, y: ty }, aiSide, applyFn, null);
      }
    }
  }

  buildActivation(state, rng, chosen.groupId, chosen.order, chosen.movePlan, aiSide, applyFn, chosen.launchPlan ?? null);
}
