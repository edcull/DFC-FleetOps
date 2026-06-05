// Monte Carlo evaluation for AI option selection.
//
// Primary entry point: mctsChooseOption(options, state, rng, side, opts)
//   Scores each activation option by simulating the full activation then
//   running short random rollouts. Drop-in replacement for chooseOption()
//   in handlers/activation.js when useLlm is false.
//
// Secondary entry point: selectAction(state, side, opts)
//   Full UCB1 tree search returning a single intent. Reserved for future
//   use in phases where option-level planning isn't available.

import { makeRng } from '../engine/rng.js';
import { apply } from '../engine/mutators.js';
import { legalActions } from '../engine/gating.js';
import { evaluate } from './evaluate.js';
import { moveCandidates, targetCandidates } from './candidates.js';
import { buildActivation } from './translator.js';

// ── State cloning ─────────────────────────────────────────────────────────────
function cloneState(s) {
  return structuredClone(s);
}

// ── Silent applyFn for simulation ─────────────────────────────────────────────
// Applies intents to a cloned state without logging or broadcasting.
function makeSimApply(state, rng) {
  return function simApply(intent) {
    try {
      apply(state, intent, rng);
      return true;
    } catch {
      return false;
    }
  };
}

// ── Random rollout ────────────────────────────────────────────────────────────
// Plays random intents from `state` for `depth` steps, alternating sides.
function rollout(state, rootSide, depth, rng) {
  const s = cloneState(state);
  let activeSide = rootSide;

  for (let i = 0; i < depth; i++) {
    // Collect candidates (legal flow intents + sampled move/target intents)
    const base = legalActions(s, activeSide);
    const activeGid = Object.keys(s.groups || {}).find(gid => {
      const grp = s.groups[gid];
      return grp.def?.side === activeSide && grp.order && !grp.activated;
    });
    if (activeGid) {
      const grp = s.groups[activeGid];
      grp.ships.forEach((ship, si) => {
        if (!ship.destroyed && !ship.offTable && !ship.movedThisRound) {
          base.push(...moveCandidates(s, activeGid, si, { steps: 4, rings: 2 }));
        }
      });
      base.push(...targetCandidates(s, activeGid));
    }
    if (!base.length) break;

    // Bias toward decisive intents so rollouts converge on meaningful states
    const priority = base.filter(a =>
      a.type === 'finishActivation' || a.type === 'beginActivation' ||
      a.type === 'applyOrder' || a.type === 'endRound' ||
      a.type === 'lockWeaponTarget'
    );
    const pool = priority.length ? priority : base;
    const intent = pool[Math.floor(rng() * pool.length)];
    try { apply(s, intent, rng); } catch { break; }
    activeSide = activeSide === 'player1' ? 'player2' : 'player1';
  }

  return evaluate(s, rootSide);
}

// ── Option-level Monte Carlo ───────────────────────────────────────────────────
/**
 * Score each activation option by simulating it then rolling out.
 * Returns the best option object, or null if options is empty.
 *
 * @param {object[]} options  - from generateActivationOptions()
 * @param {object}   state    - current authoritative state (not mutated)
 * @param {function} rng      - room's seeded rng (used for sim seed derivation)
 * @param {string}   side     - AI side ('player1' | 'player2')
 * @param {object}   opts
 * @param {number}   opts.rollouts     - rollouts per option (default 6)
 * @param {number}   opts.rolloutDepth - steps per rollout (default 12)
 */
export function mctsChooseOption(options, state, rng, side, { rollouts = 6, rolloutDepth = 12 } = {}) {
  if (!options.length) return null;

  // Pass options (no groupId) are last resort — only consider them if they're the only choice
  const activatable = options.filter(o => o.groupId);
  const pool = activatable.length ? activatable : options;

  let bestOption = pool[0];
  let bestScore  = -Infinity;
  // Derive a seed from the current rng state so simulations are deterministic
  // but different each call.
  let seedBase = rng.getState ? rng.getState() : 1;

  for (const option of pool) {
    let totalScore = 0;

    for (let r = 0; r < rollouts; r++) {
      const simState = cloneState(state);
      const simRng   = makeRng(seedBase ^ (r * 0x9e3779b9));
      const simApply = makeSimApply(simState, simRng);

      // Simulate the full activation for this option
      if (option.groupId) {
        try {
          buildActivation(
            simState, simRng,
            option.groupId,
            option.order || 'GQ',
            option.movePlan,
            side,
            simApply,
            option.launchPlan ?? null
          );
        } catch { /* activation failed on this clone — still evaluate current state */ }
      }

      // Short rollout from the post-activation state
      totalScore += rollout(simState, side, rolloutDepth, makeRng(simRng.getState ? simRng.getState() : seedBase ^ r));
      seedBase = (seedBase + 0x6d2b79f5) >>> 0;
    }

    const avgScore = totalScore / rollouts;
    if (avgScore > bestScore) {
      bestScore  = avgScore;
      bestOption = option;
    }
  }

  console.log(`[MCTS] chose: ${bestOption.label} (score ${bestScore.toFixed(3)}, ${pool.length} options × ${rollouts} rollouts)`);
  return bestOption;
}

// ── Full tree search (future use) ─────────────────────────────────────────────
// UCB1 tree search returning a single intent.
// Useful for phases where the option abstraction isn't available.

class Node {
  constructor(state, side, intent, parent) {
    this.state          = state;
    this.side           = side;
    this.intent         = intent;
    this.parent         = parent;
    this.wins           = 0;
    this.visits         = 0;
    this.children       = [];
    this.untriedActions = legalActions(state, side);
  }

  isFullyExpanded() { return this.untriedActions.length === 0; }

  ucb1(parentVisits, C = 1.41) {
    if (this.visits === 0) return Infinity;
    return (this.wins / this.visits) + C * Math.sqrt(Math.log(parentVisits) / this.visits);
  }

  bestChild(C = 1.41) {
    return this.children.reduce((best, c) =>
      c.ucb1(this.visits, C) > best.ucb1(this.visits, C) ? c : best
    );
  }
}

export function selectAction(state, side, { timeBudgetMs = 3000, rngSeed = 1, rolloutDepth = 20 } = {}) {
  const rng      = makeRng(rngSeed);
  const root     = new Node(cloneState(state), side, null, null);
  const deadline = Date.now() + timeBudgetMs;

  while (Date.now() < deadline) {
    let node = root;
    while (node.isFullyExpanded() && node.children.length > 0) node = node.bestChild();

    if (node.untriedActions.length > 0) {
      const idx    = Math.floor(rng() * node.untriedActions.length);
      const intent = node.untriedActions.splice(idx, 1)[0];
      const cs     = cloneState(node.state);
      try { apply(cs, intent, rng); } catch { continue; }
      const child = new Node(cs, side, intent, node);
      node.children.push(child);
      node = child;
    }

    const score = rollout(node.state, side, rolloutDepth, makeRng(rng.getState ? rng.getState() : rngSeed));
    for (let n = node; n; n = n.parent) { n.visits++; n.wins += score; }
  }

  if (!root.children.length) {
    const fallback = legalActions(state, side);
    return fallback[0] ?? null;
  }
  return root.children.reduce((b, c) => c.visits > b.visits ? c : b).intent;
}
