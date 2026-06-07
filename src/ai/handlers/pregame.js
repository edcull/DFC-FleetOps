// Pre-game handlers: nominations, Protect phase, and scenery (AI skips placement).

import { secondaryCandidates } from '../../engine/mutators.js';
import { SECONDARY_OBJECTIVES } from '../../engine/constants.js';

export function handlePreGame(state, rng, aiSide, applyFn) {
  const phase = state.phase;

  if (phase === 'scenery') {
    _handleScenery(state, aiSide, applyFn);
    return;
  }
  if (phase === 'nominations') {
    _handleNominations(state, aiSide, applyFn);
    return;
  }
  if (phase === 'protect') {
    // Try to nominate the first available dropsite, then confirm
    const dropsites = state.scenarioData?.dropsites || [];
    const used = Object.values(state.protectNominations || {});
    const pick = dropsites.find(ds => !ds.destroyed && !used.includes(ds.id));
    if (pick) applyFn({ type: 'setProtectNom', side: aiSide, dsId: pick.id });
    applyFn({ type: 'confirmProtectNom', side: aiSide });
  }
}

// Nominate position-based Secondary Objectives sensibly, then confirm. The engine's auto-pick
// sorts key_site AND priority_target by "closest to the enemy zone", so it tends to nominate the
// SAME deep-in-enemy dropsite for both — which is self-defeating: key_site needs you to CONTROL
// the site (near-impossible deep in enemy territory) while priority_target needs you to DESTROY
// it. Instead: never double-book a dropsite, and pick a HOLDABLE site for key_site (one of the
// legal ≥24" sites nearest our own zone) while leaving priority_target as a deep target to bombard.
function _handleNominations(state, aiSide, applyFn) {
  const used = new Set();
  for (const key of (state.secondaries?.[aiSide] || [])) {
    const def = SECONDARY_OBJECTIVES[key];
    if (!def || !def.nominate) continue;
    const cands = secondaryCandidates(state, aiSide, key); // priority order: nearest enemy zone first
    if (!cands.length) continue;
    // key_site (control) → prefer the most holdable legal site (nearest our zone = reversed order);
    // everything else → keep priority order. Skip any dropsite already nominated for another secondary.
    const ordered = key === 'key_site' ? [...cands].reverse() : cands;
    const pick = ordered.find(c => !c.nom?.dsId || !used.has(c.nom.dsId)) || ordered[0];
    if (pick?.nom?.dsId) used.add(pick.nom.dsId);
    if (pick?.nom) applyFn({ type: 'setNomination', side: aiSide, key, nom: pick.nom });
  }
  applyFn({ type: 'confirmNominations', side: aiSide });
}

function _handleScenery(state, aiSide, applyFn) {
  // Skip placement — commitScenery has no requirement that pieces were placed,
  // and sceneryValid depends on board layout details that are hard to satisfy
  // blindly. The human places all scenery; the AI just readies immediately.
  applyFn({ type: 'commitScenery', side: aiSide });
}
