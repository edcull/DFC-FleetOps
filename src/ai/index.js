// AI entry point — triggerAi and shouldAiAct.

import { isLegal } from '../engine/gating.js';
import { apply } from '../engine/mutators.js';
import { deploySideAllowed, undeployedDeployableCount, sideHasPendingActivation } from '../engine/mutators.js';
import { getPersonality } from './personalities.js';
import { handleActivation } from './handlers/activation.js';
import { handlePlanning } from './handlers/planning.js';
import { handleDeploy } from './handlers/deploy.js';
import { handleDropsite } from './handlers/dropsite.js';
import { handleAsset } from './handlers/asset.js';
import { handleRepair } from './handlers/repair.js';
import { handlePreGame } from './handlers/pregame.js';
import { handleBattalion } from './handlers/battalion.js';

// Returns true when the AI has a decision to make right now.
export function shouldAiAct(state, side) {
  const phase = state.phase;

  if (phase === 'scenery') {
    // commitScenery gating has no sceneryTurn restriction, so the AI can commit
    // at any point — sceneryTurn only gates placeScenery (which we skip).
    return !(state.sceneryReady || {})[side];
  }
  if (phase === 'nominations') {
    return !(state.nominationsReady || {})[side];
  }
  if (phase === 'protect') {
    return !(state.protectNomReady || {})[side];
  }

  if (phase === 'deploy') {
    if (!deploySideAllowed(state, side)) return false;
    if (undeployedDeployableCount(state, side) > 0) return true;
    if ((state.deployDone || {})[side]) return false; // already signalled done
    // player2 must wait for player1 to call deployDone first (per gating rule)
    if (side === 'player2' && !((state.deployDone || {}).player1)) return false;
    return true; // all ships placed, need to call deployDone
  }

  if (phase !== 'play') return false;

  // An unconfirmed end-of-activation hazard-damage report freezes the game;
  // the owning side (here, the AI) must acknowledge it.
  if (state.atmoDamage) return state.atmoDamage.side === side;

  // Defender save step: AI must advance the attack modal past the save phase.
  if (state.attackModal?.step === 'save') {
    const atkSide = state.attackModal.bomberSide || state.activeSide;
    const defSide = atkSide === 'player1' ? 'player2' : 'player1';
    if (side === defSide) return true;
  }

  if (state.repairPhase) return false; // repair is handled client-side

  // Battalion combat: AI acts at every stage (gating is permissive, no side lock)
  if (state.battalionCombat) return true;

  if (state.assetPhase) {
    if (state.assetPhase.step !== 'assets') return false;
    if (state.assetActiveSide === side) return true;
    // When all asset stages are done (assetActiveSide is null), confirm if not yet done
    if (!state.assetActiveSide) {
      const doneSides = state.assetPhase.doneSides || [];
      return !doneSides.includes(side);
    }
    return false;
  }

  if (state.dropsiteActivation) return state.dropsiteActivation.side === side;

  // Only act if there's genuinely something to activate or a pass token available.
  // Without this check, all-reserve fleets cause an infinite loop.
  if (state.activeSide === side) {
    return sideHasPendingActivation(state, side) ||
           ((state.planning?.passTokens?.[side] ?? 0) > 0);
  }

  // Planning: initiative winner must assign initiative
  if (state.initiative && state.initiative.winner === side && !state.initiative.holder) return true;
  // Planning: initiative holder must start activations
  if (state.initiative && state.initiative.holder === side && !state.activeSide) return true;

  return false;
}

// Dispatch to the correct sub-phase handler and apply its intents.
// One call = one atomic AI action. Caller loops until shouldAiAct returns false.
export async function triggerAi(room, onRecord = null) {
  const { state, rng, aiSide, aiPersonality } = room;
  const personality = getPersonality(aiPersonality);

  function applyFn(intent) {
    if (!isLegal(state, intent, aiSide)) {
      console.warn(`[AI] illegal intent skipped: ${intent.type}`, JSON.stringify(intent));
      return false;
    }
    console.log(`[AI] apply: ${intent.type}${intent.gid ? ' ' + intent.gid : ''}${intent.order ? ' ' + intent.order : ''}${intent.side ? ' ' + intent.side : ''}`);
    apply(state, intent, rng);
    if (onRecord) onRecord(intent);
    return true;
  }

  const phase = state.phase;

  if (phase === 'scenery' || phase === 'nominations' || phase === 'protect') {
    handlePreGame(state, rng, aiSide, applyFn);
    return;
  }

  if (phase === 'deploy') {
    handleDeploy(state, rng, aiSide, applyFn);
    return;
  }

  if (phase !== 'play') return;

  // Acknowledge an end-of-activation hazard-damage report so play can advance.
  if (state.atmoDamage && state.atmoDamage.side === aiSide) {
    applyFn({ type: 'confirmEndActivation' });
    return;
  }

  // Defender save step: apply damage (or roll backup saves first if available).
  if (state.attackModal?.step === 'save') {
    const M = state.attackModal;
    const atkSide = M.bomberSide || state.activeSide;
    const defSide = atkSide === 'player1' ? 'player2' : 'player1';
    if (aiSide === defSide) {
      const sr = M.saveResult;
      if (sr) {
        const needBackup = !sr.backupRolled &&
          sr.hitsList?.some(h => !h.saved && h.sv != null) && sr.backupVal != null;
        applyFn({ type: 'attackStep', to: needBackup ? 'rollbackup' : 'apply' });
      }
      return;
    }
  }

  if (state.repairPhase) {
    handleRepair(state, rng, aiSide, personality, applyFn);
    return;
  }

  if (state.battalionCombat) {
    handleBattalion(state, aiSide, applyFn);
    return;
  }

  if (state.assetPhase) {
    handleAsset(state, aiSide, personality, applyFn);
    return;
  }

  if (state.dropsiteActivation?.side === aiSide) {
    handleDropsite(state, rng, aiSide, personality, applyFn);
    return;
  }

  const ini = state.initiative;
  const isPlanningPhase = ini && (!ini.holder || (ini.holder === aiSide && !state.activeSide));
  if (isPlanningPhase) {
    handlePlanning(state, rng, aiSide, personality, applyFn);
    return;
  }

  await handleActivation(state, rng, aiSide, personality, applyFn);
}
