// Move candidate generator for MCTS.
// isLegal(moveShip) validates a specific (x,y) but legalActions() can't
// enumerate every pixel, so we sample points within the move cone instead.

import { isLegal } from '../engine/gating.js';
import { moveCone, headingVec } from '../engine/mutators.js';

const TWO_PI = Math.PI * 2;

/**
 * Return a list of candidate moveShip intents for one ship.
 * Samples `steps` headings × `rings` distance increments within the legal cone.
 */
export function moveCandidates(state, gid, si, { steps = 8, rings = 3 } = {}) {
  const grp  = state.groups[gid];
  const ship = grp && grp.ships[si];
  if (!ship) return [];

  const { o, maxR, minR, turnDeg } = moveCone(state, gid, si);
  if (!o || o.moveMax <= 0) return [];

  const candidates = [];
  const fwd = headingVec(ship.heading);
  const baseBearing = Math.atan2(fwd.y, fwd.x);

  for (let r = 1; r <= rings; r++) {
    const dist = minR + (maxR - minR) * (r / rings);
    if (dist < 0.5) continue;

    for (let s = 0; s < steps; s++) {
      const angleOffset = ((s / steps) * 2 - 1) * (turnDeg * Math.PI / 180);
      const bearing = baseBearing + angleOffset;
      const x = ship.x + Math.cos(bearing) * dist;
      const y = ship.y + Math.sin(bearing) * dist;
      const intent = { type: 'moveShip', gid, si, x, y };
      if (isLegal(state, intent, grp.def?.side)) candidates.push(intent);
    }
  }

  return candidates;
}

/**
 * Return candidate lockWeaponTarget intents for all legal weapon/target combos
 * for ships in `gid` (per weapon index, per enemy ship).
 */
export function targetCandidates(state, gid) {
  const grp = state.groups[gid];
  if (!grp || !grp.def?.weapons) return [];
  const side = grp.def?.side;
  const candidates = [];

  grp.ships.forEach((ship, si) => {
    if (ship.destroyed || ship.offTable) return;
    grp.def.weapons.forEach((_w, wi) => {
      for (const [tgid, tgrp] of Object.entries(state.groups)) {
        if (tgrp.def?.side === side) continue;
        tgrp.ships.forEach((tship, tsi) => {
          if (tship.destroyed || tship.offTable) return;
          const intent = { type: 'lockWeaponTarget', gid, si, wi, targetGid: tgid, targetSi: tsi };
          if (isLegal(state, intent, side)) candidates.push(intent);
        });
      }
    });
  });

  return candidates;
}
