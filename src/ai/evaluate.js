// Heuristic evaluation function for MCTS rollouts.
// Returns a score in [0, 1] from `side`'s perspective (higher = better).
//
// The objective in DFC is Victory Points, which come almost entirely from
// controlling dropsites with landed Battalions. VP only updates at the R4/R6
// scoring rounds, so between them we lean on proxy signals: dropsite control,
// battalions landed, and drop-capable ships closing on contestable dropsites.
// Combat (damage dealt / own survival) is the secondary lever — chiefly to stop
// the opponent landing.

import { INCH } from '../engine/constants.js';
import { dropsiteController, dsBattalions } from '../engine/mutators.js';

const OPP = { player1: 'player2', player2: 'player1' };
const BOARD_PX = 48 * INCH;

const DROP_TYPES = ['bulk_lander', 'dropship', 'drop_pod', 'gate_dropship'];
function isDropper(def) {
  return !!def && ((def.launch || []).some(l => DROP_TYPES.includes(l.type)) || (def.gateship || 0) > 0);
}
function sideBattalions(ds, side) {
  const b = dsBattalions(ds);
  return Object.values(b).reduce((sum, loc) => sum + (loc[side] || 0), 0);
}

export function evaluate(state, side) {
  const opp = OPP[side];

  // ── Hull: damage dealt to the opponent + own survival ───────────────────────
  let myLost = 0, myMax = 0, oppLost = 0, oppMax = 0;
  for (const grp of Object.values(state.groups || {})) {
    const gs = grp.def?.side;
    if (gs !== side && gs !== opp) continue;
    for (const ship of grp.ships) {
      const mx = ship.maxHull; if (!mx) continue;
      const lost = ship.destroyed ? mx : (mx - (ship.hull ?? mx));
      if (gs === side) { myLost += lost; myMax += mx; }
      else             { oppLost += lost; oppMax += mx; }
    }
  }
  const hullScore = oppMax > 0 ? oppLost / oppMax : 0.5;     // damage dealt to opponent
  const survScore = myMax  > 0 ? 1 - myLost / myMax : 0.5;   // own survival

  // ── VP advantage (Laplace-smoothed) ─────────────────────────────────────────
  const myVP  = state.score?.[side]?.vp || 0;
  const oppVP = state.score?.[opp]?.vp  || 0;
  const vpScore = (myVP + 1) / (myVP + oppVP + 2);

  // ── Dropsite objective: control + battalions landed (the win condition) ──────
  const dropsites = (state.scenarioData?.dropsites || []).filter(d => !d.destroyed);
  let myCtrl = 0, oppCtrl = 0, myBn = 0, oppBn = 0;
  for (const ds of dropsites) {
    const c = dropsiteController(ds);
    if (c === side) myCtrl++; else if (c === opp) oppCtrl++;
    myBn  += sideBattalions(ds, side);
    oppBn += sideBattalions(ds, opp);
  }
  const ctrlScore = dropsites.length ? (myCtrl + 0.5) / (myCtrl + oppCtrl + 1) : 0.5;
  const bnScore   = (myBn + oppBn) > 0 ? (myBn + 1) / (myBn + oppBn + 2) : 0.5;

  // ── Approach: drop-capable ships closing on contestable dropsites, and combat
  //    ships closing on enemy droppers (to contest the landing). Guides movement
  //    early, before any battalion has actually landed. ─────────────────────────
  let dropApproach = 0.5, hunt = 0.5;
  if (dropsites.length) {
    const myShips = [];
    const enemyDroppers = [];
    for (const grp of Object.values(state.groups || {})) {
      const gs = grp.def?.side, dropper = isDropper(grp.def);
      for (const sh of grp.ships) {
        if (sh.destroyed || sh.offTable) continue;
        if (gs === side) myShips.push({ sh, dropper });
        else if (gs === opp && dropper) enemyDroppers.push(sh);
      }
    }
    // my droppers → nearest dropsite I don't already control
    let near = 0, nDrop = 0;
    for (const { sh, dropper } of myShips) {
      if (!dropper) continue;
      nDrop++;
      let best = Infinity;
      for (const ds of dropsites) {
        if (dropsiteController(ds) === side) continue;
        best = Math.min(best, Math.hypot(sh.x - ds.x * INCH, sh.y - ds.y * INCH));
      }
      if (best !== Infinity) near += Math.max(0, 1 - best / BOARD_PX);
    }
    if (nDrop > 0) dropApproach = near / nDrop;
    // my combat ships → nearest enemy dropper (intercept)
    let close = 0, nCombat = 0;
    if (enemyDroppers.length) {
      for (const { sh, dropper } of myShips) {
        if (dropper) continue;
        nCombat++;
        let best = Infinity;
        for (const ed of enemyDroppers) best = Math.min(best, Math.hypot(sh.x - ed.x, sh.y - ed.y));
        if (best !== Infinity) close += Math.max(0, 1 - best / BOARD_PX);
      }
    }
    hunt = nCombat > 0 ? close / nCombat : 0.5;
  }

  // Weights: dropsite objective dominates (control + battalions + approach), then
  // combat (damage + survival + hunting enemy droppers), then realised VP.
  return 0.28 * ctrlScore
       + 0.18 * bnScore
       + 0.12 * dropApproach
       + 0.13 * hullScore
       + 0.10 * survScore
       + 0.09 * hunt
       + 0.10 * vpScore;
}
