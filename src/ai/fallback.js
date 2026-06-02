// Heuristic option scorer — used when no LLM is configured or it times out.
// Returns the index of the highest-scoring option.

import { INCH } from '../engine/constants.js';
import { dropsiteController } from '../engine/mutators.js';

const BOARD_PX = 48 * INCH;

function dist2d(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function lockHitProb(lock) {
  const n = parseInt(String(lock).replace('+', '')) || 5;
  return Math.max(0, (7 - n) / 6);
}

// Estimate kill potential: expected damage output from locked targets.
function estimateKillPotential(option, state) {
  if (!option.weapTargets?.length) return 0;
  const def = option.groupId ? state.groups[option.groupId]?.def : null;
  if (!def?.weapons) return 0;
  let total = 0;
  for (const { wi, targetGid, targetSi } of option.weapTargets) {
    const w = def.weapons[wi];
    if (!w) continue;
    const tship = state.groups[targetGid]?.ships?.[targetSi];
    if (!tship || tship.destroyed) continue;
    const expectedHits = w.att * lockHitProb(w.lock);
    total += expectedHits * (w.dmg || 1);
  }
  return total;
}

// Estimate VP gain: moving toward or into battalion-drop range of dropsites.
function estimateVpGain(option, state, aiSide) {
  if (!option.groupId || !option.movePos) return 0;
  const grp = state.groups[option.groupId];
  if (!grp?.def?.launch) return 0;
  const canDrop = grp.def.launch.some(l => l.type === 'bulk_lander' || l.type === 'dropship');
  if (!canDrop) return 0;

  const dropsites = state.scenarioData?.dropsites || [];
  let score = 0;
  for (const ds of dropsites) {
    if (ds.destroyed) continue;
    const ctrl = dropsiteController(ds);
    if (ctrl === aiSide) continue; // already ours
    const dPx = dist2d(option.movePos.x, option.movePos.y, ds.x * INCH, ds.y * INCH);
    if (dPx <= 6 * INCH) score += ctrl === null ? 1.0 : 1.5; // uncontrolled: 1, enemy: 1.5
  }
  return score;
}

// Estimate survival: fewer enemy weapons pointing at destination = better.
function estimateSurvival(option, state, aiSide) {
  if (!option.movePos) return 0;
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  let threatDice = 0;
  for (const [, grp] of Object.entries(state.groups)) {
    if (grp.def?.side !== enemySide) continue;
    for (const ship of grp.ships) {
      if (ship.destroyed || ship.offTable) continue;
      for (const w of grp.def?.weapons || []) {
        const dx = option.movePos.x - ship.x, dy = option.movePos.y - ship.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 20 * INCH) threatDice += w.att || 0;
      }
    }
  }
  return -threatDice * 0.05; // negative: more threat = lower score
}

// Estimate objective progress: bonus for advancing toward secondary objectives.
function estimateObjectiveProgress(option, state, aiSide) {
  const objectives = state.secondaries?.[aiSide];
  if (!objectives || !objectives.length) return 0;

  const nom = state.secondaryNominations?.[aiSide] || {};
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  let score = 0;

  for (const obj of objectives) {
    // Key Site / Priority Target: move toward or hold near the nominated dropsite.
    if ((obj === 'key_site' || obj === 'priority_target') && nom.dropsite && option.movePos) {
      const ds = (state.scenarioData?.dropsites || []).find(d => d.id === nom.dropsite);
      if (ds) {
        const d = dist2d(option.movePos.x, option.movePos.y, ds.x * INCH, ds.y * INCH);
        score += d <= 6 * INCH ? 0.8 : d <= 12 * INCH ? 0.3 : 0;
      }
    }

    // Gather Intel: move any ship within 6" of an unsurveyed dropsite.
    if (obj === 'gather_intel' && option.movePos && option.groupId) {
      for (const ds of (state.scenarioData?.dropsites || [])) {
        if (ds.destroyed || ds.surveyed?.[aiSide]) continue;
        const d = dist2d(option.movePos.x, option.movePos.y, ds.x * INCH, ds.y * INCH);
        if (d <= 6 * INCH) score += 0.4;
      }
    }

    // Decapitate: target the opponent's admiral group.
    if (obj === 'decapitate' && option.weapTargets?.length) {
      const asns = state.admiralAssignments?.[enemySide] || [];
      for (const { targetGid } of option.weapTargets) {
        if (asns.some(a => targetGid === enemySide + ':' + a.baseId)) {
          score += 0.8;
          break;
        }
      }
    }

    // Objectives Beyond: move the nominated ship toward the opponent's board edge.
    if (obj === 'objectives_beyond' && nom.ship && option.groupId === nom.ship && option.movePos) {
      // Player1 deploys near y=0; player2 near y=BOARD_PX. Score progress to enemy half.
      const targetY = aiSide === 'player1' ? BOARD_PX : 0;
      const progress = 1 - Math.abs(option.movePos.y - targetY) / BOARD_PX;
      score += progress * 0.5;
    }
  }

  return score;
}

function scoreOption(option, state, aiSide, weights) {
  if (!option.groupId) return -1; // pass is last resort

  const kill      = estimateKillPotential(option, state, aiSide)   * weights.kill;
  const vp        = estimateVpGain(option, state, aiSide)          * weights.vp;
  const survival  = estimateSurvival(option, state, aiSide)        * weights.survival;
  const objective = estimateObjectiveProgress(option, state, aiSide) * weights.objective;
  const momentum  = (option.groupId ? 1 : 0)                      * weights.momentum;

  return kill + vp + survival + objective + momentum;
}

// Returns the chosen option object (highest score).
export function chooseOption(options, state, aiSide, personality) {
  if (!options.length) return null;
  let bestIdx = 0, bestScore = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const s = scoreOption(options[i], state, aiSide, personality.weights);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  return options[bestIdx];
}

// Score planning: take initiative when VP-ahead or fleet is heavy.
export function scorePlanning(state, aiSide) {
  const aiVp  = state.score?.[aiSide]?.vp ?? 0;
  const oppVp = state.score?.[aiSide === 'player1' ? 'player2' : 'player1']?.vp ?? 0;
  return aiVp >= oppVp; // prefer first mover when tied or ahead
}
