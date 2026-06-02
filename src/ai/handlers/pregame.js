// Pre-game handlers: nominations, Protect phase, and scenery (AI skips placement).

export function handlePreGame(state, rng, aiSide, applyFn) {
  const phase = state.phase;

  if (phase === 'scenery') {
    _handleScenery(state, aiSide, applyFn);
    return;
  }
  if (phase === 'nominations') {
    applyFn({ type: 'confirmNominations', side: aiSide });
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

function _handleScenery(state, aiSide, applyFn) {
  // Skip placement — commitScenery has no requirement that pieces were placed,
  // and sceneryValid depends on board layout details that are hard to satisfy
  // blindly. The human places all scenery; the AI just readies immediately.
  applyFn({ type: 'commitScenery', side: aiSide });
}
