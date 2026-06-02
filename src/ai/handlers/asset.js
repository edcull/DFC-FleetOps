// Asset phase handler.
// Moves launched assets toward tactically useful positions:
//   fighters  — toward the nearest on-table enemy to provide close cover
//   bombers   — toward the highest-HP enemy ship (maximum kill potential)
//   torpedoes — toward the nearest on-table enemy
//   others    — hold position (zero-distance move marks them as moved)
//
// assetStageDone has a broken gating check so we never call it; zero-distance
// assetMove triggers afterAssetMove() which auto-advances the stage internally.

import { INCH } from '../../engine/constants.js';

const BOARD_PX = 48 * INCH;

function dist(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function nearestEnemy(state, aiSide) {
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  let best = null, bestD = Infinity;
  for (const grp of Object.values(state.groups)) {
    if (grp.def?.side !== enemySide) continue;
    for (const s of grp.ships) {
      if (s.destroyed || s.offTable) continue;
      const d = dist(BOARD_PX / 2, BOARD_PX / 2, s.x, s.y); // use centroid as proxy
      if (d < bestD) { bestD = d; best = s; }
    }
  }
  return best;
}

function highestHpEnemy(state, aiSide) {
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  let best = null, bestHp = 0;
  for (const grp of Object.values(state.groups)) {
    if (grp.def?.side !== enemySide) continue;
    const alive = grp.ships.filter(s => !s.destroyed && !s.offTable);
    const hp = alive.reduce((s, sh) => s + sh.hull, 0);
    if (hp > bestHp) { bestHp = hp; best = alive[0] || null; }
  }
  return best;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function moveToward(asset, targetX, targetY, thrustPx, margin) {
  const dx = targetX - asset.x, dy = targetY - asset.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) return { x: asset.x, y: asset.y };
  const moveDist = Math.min(thrustPx, d);
  return {
    x: clamp(asset.x + (dx / d) * moveDist, margin, BOARD_PX - margin),
    y: clamp(asset.y + (dy / d) * moveDist, margin, BOARD_PX - margin),
  };
}

export function handleAsset(state, aiSide, personality, applyFn) {
  const ap = state.assetPhase;
  if (!ap || ap.step !== 'assets') return;

  if (state.assetActiveSide === aiSide && ap.assetType) {
    const assets = (state.launchedAssets || []).filter(a =>
      a.side === aiSide && !a.moved && a.count > 0 && a.kind !== 'mine'
    );

    for (const asset of assets) {
      const kind = asset.kind; // 'fighter', 'bomber', 'torpedo', 'fireship', etc.
      let dest = { x: asset.x, y: asset.y }; // default: hold

      // Determine thrust from asset profile (approximate from ASSET_PROFILES if available)
      const thrustIn = (kind === 'fighter') ? 13
                     : (kind === 'bomber') ? 10
                     : (kind === 'torpedo') ? 6
                     : (kind === 'fireship') ? 8
                     : 10;
      const thrustPx = thrustIn * INCH;
      const margin   = INCH * 2;

      if (kind === 'fighter') {
        const target = nearestEnemy(state, aiSide);
        if (target) dest = moveToward(asset, target.x, target.y, thrustPx, margin);
      } else if (kind === 'bomber' || kind === 'fireship') {
        const target = highestHpEnemy(state, aiSide);
        if (target) dest = moveToward(asset, target.x, target.y, thrustPx, margin);
      } else if (kind === 'torpedo') {
        const target = highestHpEnemy(state, aiSide);
        if (target) dest = moveToward(asset, target.x, target.y, thrustPx, margin);
      }

      applyFn({ type: 'assetMove', assetId: asset.id, x: Math.round(dest.x), y: Math.round(dest.y) });
    }
    return;
  }

  // All stages done: confirm this side is finished.
  if (!state.assetActiveSide) {
    const doneSides = ap.doneSides || [];
    if (!doneSides.includes(aiSide)) {
      applyFn({ type: 'assetPhaseDone', side: aiSide });
    }
  }
}
