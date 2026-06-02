// Dropsite activation (DA) phase handler.
//
// Gating for openDAFeatureAttack / daPickDropsite / fireFeatureWeapon now allows
// both 'play' and 'da' phases, so we can use them directly without the old workaround.

import { dropsiteController, dropsiteContested, dsSideBattalions } from '../../engine/mutators.js';
import { FEATURES } from '../../engine/constants.js';

// Find the nearest on-table enemy ship to fire a feature weapon at.
function nearestEnemyShip(state, aiSide) {
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  let best = null, bestDist = Infinity;
  for (const [gid, grp] of Object.entries(state.groups)) {
    if (grp.def?.side !== enemySide) continue;
    grp.ships.forEach((s, si) => {
      if (s.destroyed || s.offTable) return;
      // Prefer drop-capable ships and heavy ships
      const pts = grp.def?.pts ?? 0;
      const score = pts + ((grp.def?.launch || []).some(l => l.type === 'bulk_lander' || l.type === 'gate_dropship') ? 200 : 0);
      if (score > bestDist) { bestDist = score; best = { gid, si }; }
    });
  }
  return best;
}

// Fire all unfired feature weapons on a dropsite against the nearest enemy.
function fireFeatureWeapons(state, dsId, aiSide, applyFn) {
  const ds = state.scenarioData?.dropsites?.find(d => d.id === dsId);
  if (!ds) return;
  (ds.features || []).forEach((fk, fi) => {
    const feat = FEATURES[fk];
    if (!feat?.weapon) return;                               // no weapon
    if ((ds.destroyedFeatures || []).includes(fi)) return;  // destroyed
    if ((ds.firedFeatures || []).includes(fi)) return;      // already fired this round
    // Open the feature attack
    if (!applyFn({ type: 'openDAFeatureAttack', dsId, fi })) return;
    // Find and lock an enemy target
    const target = nearestEnemyShip(state, aiSide);
    if (target) {
      applyFn({ type: 'fireFeatureWeapon', dsId, fi, targetGid: target.gid, targetSi: target.si });
    }
  });
}

export function handleDropsite(state, rng, aiSide, personality, applyFn) {
  const da = state.dropsiteActivation;
  if (!da || da.side !== aiSide) return;

  const dropsites = state.scenarioData?.dropsites || [];
  const done = da.done || [];

  // If already mid-activation (dsId set), fire feature weapons then finish.
  if (da.dsId) {
    fireFeatureWeapons(state, da.dsId, aiSide, applyFn);
    applyFn({ type: 'daFinishDropsite', dsId: da.dsId });
    return;
  }

  // Dropsites the AI controls that haven't been activated yet.
  const pending = dropsites.filter(ds =>
    !ds.destroyed && dropsiteController(ds) === aiSide && !done.includes(ds.id)
  );

  if (pending.length > 0) {
    // Prioritise contested dropsites (trigger battalion combat) then most-battalions.
    const sorted = pending.slice().sort((a, b) => {
      const aContested = dropsiteContested(a) ? 1 : 0;
      const bContested = dropsiteContested(b) ? 1 : 0;
      if (bContested !== aContested) return bContested - aContested;
      return dsSideBattalions(b, aiSide) - dsSideBattalions(a, aiSide);
    });
    const target = sorted[0];
    // daPickDropsite now works in play phase (gating fixed).
    if (applyFn({ type: 'daPickDropsite', dsId: target.id })) {
      // da.dsId is now set; fire feature weapons then finish on next call.
      // (Return here; next triggerAi call handles the dsId branch above.)
      return;
    }
    // Fallback if daPickDropsite still fails: set dsId directly.
    da.dsId = target.id;
    fireFeatureWeapons(state, target.id, aiSide, applyFn);
    applyFn({ type: 'daFinishDropsite', dsId: target.id });
    return;
  }

  // No AI dropsites left — check if the opponent has any.
  const otherSide = aiSide === 'player1' ? 'player2' : 'player1';
  const opponentPending = dropsites.some(ds =>
    !ds.destroyed && dropsiteController(ds) === otherSide && !done.includes(ds.id)
  );

  if (opponentPending) {
    applyFn({ type: 'daSwitchSide' });
  } else {
    applyFn({ type: 'daEnd' });
  }
}
