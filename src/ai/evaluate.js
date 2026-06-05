// Heuristic evaluation function for MCTS rollouts.
// Returns a score in [0, 1] from `side`'s perspective.
// Higher = better for `side`. Tune weights here as the AI develops.

import { INCH } from '../engine/constants.js';

const OPP = { player1: 'player2', player2: 'player1' };

export function evaluate(state, side) {
  const opp = OPP[side];

  // ── Hull advantage ──────────────────────────────────────────────────────────
  let myHullLost = 0, myHullMax = 0;
  let oppHullLost = 0, oppHullMax = 0;

  for (const grp of Object.values(state.groups)) {
    for (const ship of grp.ships) {
      if (!ship.hullMax) continue;
      const lost = ship.hullMax - (ship.hull ?? ship.hullMax);
      if (grp.side === side) { myHullLost  += lost; myHullMax  += ship.hullMax; }
      else                   { oppHullLost += lost; oppHullMax += ship.hullMax; }
    }
  }
  const hullScore   = oppHullMax  > 0 ? oppHullLost  / oppHullMax  : 0.5;
  const survivScore = myHullMax   > 0 ? 1 - myHullLost / myHullMax : 0.5;

  // ── VP advantage (Laplace-smoothed ratio) ───────────────────────────────────
  const myVP  = (state.vp && state.vp[side]) || 0;
  const oppVP = (state.vp && state.vp[opp])  || 0;
  const vpScore = (myVP + 1) / (myVP + oppVP + 2);

  // ── Cluster proximity: reward ships near clusters ───────────────────────────
  let clusterScore = 0.5;
  if (state.clusters && state.clusters.length) {
    let myNear = 0, oppNear = 0;
    const threshold = 6 * INCH;
    for (const grp of Object.values(state.groups)) {
      for (const ship of grp.ships) {
        if (ship.destroyed || ship.offTable) continue;
        for (const cl of state.clusters) {
          const d = Math.hypot(ship.x - cl.x, ship.y - cl.y);
          if (d <= threshold) {
            if (grp.side === side) myNear++;
            else oppNear++;
          }
        }
      }
    }
    clusterScore = (myNear + 1) / (myNear + oppNear + 2);
  }

  return 0.35 * hullScore + 0.30 * survivScore + 0.25 * vpScore + 0.10 * clusterScore;
}
