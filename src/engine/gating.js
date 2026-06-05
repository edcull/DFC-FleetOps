// Intent legality — the authoritative gate the server runs before apply(),
// and the same check the local client runs before mutating in hotseat mode.
//
// An "intent" is a small serialisable action object: { type, ...payload }.
//   isLegal(state, intent, side)  — may `side` perform `intent` right now?
//   legalActions(state, side)     — which intents are currently available to a side?
//
// This is Phase 1d of the foundation refactor. Only turn-flow intents (pass,
// endRound) are modelled so far; further action families are migrated out of
// the inline client handlers incrementally. Keep this in lockstep with the
// apply() dispatcher in mutators.js — every intent type apply() handles must
// have a matching case here.

import { ORDERS, INCH, FEATURES } from './constants.js';
import { getDef, assetThrust } from './state.js';
import { nextUndeployedShipIdx, activeGroupIdForSide, moveCone, headingVec, weaponCanTarget, firingOriginShip, pointInWeaponArc, targetingRangePx, effectiveScan, dsBattalions, deploySideAllowed, sideNeedsDeployPhase, transportValue, shipInNetwork, isCapital, objectiveForSide, sceneryValid } from './mutators.js';

const INTENT_TYPES = ['pass', 'endRound', 'commitScenario'];

// True when it is `side`'s turn to act in the play phase (or there is no active
// side yet). Pre-play phases impose no active-side restriction.
function playTurnOk(state, side) {
  return !(state.phase === 'play' && state.activeSide && state.activeSide !== side);
}

export function isLegal(state, intent, side) {
  if (!intent || typeof intent !== 'object') return false;
  // An unconfirmed end-of-activation hazard-damage report freezes the game:
  // the only legal move is the owning side confirming it.
  if (state.atmoDamage && intent.type !== 'confirmEndActivation') return false;
  switch (intent.type) {
    case 'commitScenery': {
      if (state.phase !== 'scenery') return false;
      if (side && intent.side && intent.side !== side) return false;
      const commitSide = intent.side || side;
      if (commitSide && (state.sceneryReady || {})[commitSide]) return false;
      return true;
    }
    case 'beginPlay':
      return state.phase === 'deploy';
    case 'giveInitiative': {
      if (state.phase !== 'play' || !state.initiative) return false;
      return !side || state.initiative.winner === side;
    }
    case 'beginActivation': {
      if (state.phase !== 'play' || !state.initiative) return false;
      return !side || state.initiative.holder === side;
    }
    case 'commitScenario': {
      if (state.phase !== 'setup') return false;
      if (!state.scenario) return false;
      if (!state.fleetChoices || !state.fleetChoices.f1 || !state.fleetChoices.f2) return false;
      const missing = ['deployment','approach','layout','variant'].some(k => !state.scenario[k]);
      if (missing) return false;
      const sc = state.scenario;
      const objectiveOk = sc.objective || (sc.objectives && sc.objectives.player1 && sc.objectives.player2);
      if (!objectiveOk) return false;
      return true;
    }
    case 'readySetup': {
      if (state.phase !== 'setup') return false;
      if (!intent.side || intent.side !== side) return false;
      if (state.setupReady && state.setupReady[side]) return false;
      if (!state.scenario) return false;
      if (!state.fleetChoices || !state.fleetChoices.f1 || !state.fleetChoices.f2) return false;
      const _rsMissing = ['deployment','approach','layout','variant'].some(k => !state.scenario[k]);
      if (_rsMissing) return false;
      const _sc = state.scenario;
      const _objectiveOk = _sc.objective || (_sc.objectives && _sc.objectives.player1 && _sc.objectives.player2);
      if (!_objectiveOk) return false;
      return true;
    }
    case 'unreadySetup': {
      if (state.phase !== 'setup') return false;
      if (!intent.side || intent.side !== side) return false;
      if (!state.setupReady || !state.setupReady[side]) return false;
      return true;
    }
    case 'deployShip': {
      const { gid, si } = intent;
      if (state.phase !== 'deploy') return false;
      const grp = state.groups[gid];
      if (!grp) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      if (!deploySideAllowed(state, side)) return false;
      const ship = grp.ships[si];
      if (!ship || ship.destroyed) return false;
      return true;
    }
    case 'undoDeploy': {
      if (state.phase !== 'deploy' && state.phase !== 'play') return false;
      const grp = state.groups[intent.gid];
      if (!grp) return false;
      const def = getDef(state, intent.gid);
      if (!def || def.side !== side) return false;
      if (state.phase === 'deploy' && !deploySideAllowed(state, side)) return false;
      if (state.phase === 'play' && grp.activated) return false;
      if (state.phase === 'play' && grp.ships.some(s => s.firedThisActivation || (s.launchedThisRound > 0) || s.detectorUsed)) return false;
      return grp.ships.some(s => !s.destroyed && !s.offTable);
    }
    case 'arriveShip': {
      const { gid, si } = intent;
      if (state.phase !== 'play') return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      const ship = grp.ships[si];
      if (!ship || ship.destroyed) return false;
      // Must be off-table OR justArrived (repositionable until group acts)
      if (!ship.offTable && !ship.justArrived) return false;
      // Group must not have acted
      if (grp.ships.some(s => s.movedThisRound || s.firedThisActivation || (s.launchedThisRound > 0) || s.detectorUsed)) return false;
      return true;
    }
    case 'useDetector': {
      const { gid, si, wi, targetGid, targetSi } = intent;
      if (state.phase !== 'play') return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      const ship = grp.ships[si];
      if (!ship || ship.destroyed || ship.offTable || ship.firedThisActivation || ship.detectorUsed) return false;
      const hasDetectorSpecial = /\bDetector\b/i.test(def.special || '');
      const w = def.weapons && def.weapons[wi];
      if (!hasDetectorSpecial && (!w || (w.arc !== 'LoS' && !/^Detector$/i.test(w.name)))) return false;
      const targetGrp = state.groups[targetGid];
      if (!targetGrp) return false;
      const targetDef = getDef(state, targetGid);
      if (!targetDef || targetDef.side === side) return false;
      const targetShip = targetGrp.ships[targetSi];
      if (!targetShip || targetShip.destroyed || targetShip.offTable) return false;
      return true;
    }
    case 'pass': {
      if (state.phase !== 'play') return false;
      if (state.activeSide !== side) return false;
      const P = state.planning;
      return !!(P && P.passTokens && P.passTokens[side] > 0);
    }
    case 'endRound': {
      if (state.phase !== 'play') return false;
      // The active side ends the round. If no side is active (all activations
      // are done) either player may trigger it.
      return state.activeSide === side || state.activeSide === null;
    }
    case 'undoMove': {
      const { gid, si } = intent;
      if (state.phase !== 'play') return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      if (state.activeSide && state.activeSide !== side) return false;
      const ship = grp.ships[si];
      if (!ship || ship.destroyed) return false;
      if (!ship.movedThisRound) return false;
      if (ship.firedThisActivation || ship.detectorUsed || (ship.launchedThisRound > 0)) return false;
      if (Object.values(state.groups).some(g => g.ships.some(s => s.deployedByGid === gid))) return false;
      const trail = grp.moveTrail || [];
      return trail.some(t => t.si === si);
    }
    case 'cancelOrder': {
      const { gid } = intent;
      if (state.phase !== 'play') return false;
      const grp = state.groups[gid];
      if (!grp || !grp.order || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      if (state.activeSide && state.activeSide !== side) return false;
      if (grp.ships.some(s => !s.destroyed && (s.movedThisRound || s.firedThisActivation || s.detectorUsed || (s.launchedThisRound > 0)))) return false;
      return true;
    }
    case 'finishActivation': {
      const { gid } = intent;
      if (state.phase !== 'play') return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      if (state.activeSide && state.activeSide !== side) return false;
      // Allow finish if the group has started activating, OR all alive ships are off-table
      // (group has nothing to activate — auto-skip case).
      const started = grp.order || grp.ships.some(s => s.movedThisRound || s.firedThisActivation || (s.launchedThisRound > 0) || s.detectorUsed);
      const allOffTable = grp.ships.every(s => s.destroyed || s.offTable);
      if (!(started || allOffTable)) return false;
      // Block if a payload cell deployed by this activation hasn't acted yet.
      const cellPending = Object.values(state.groups).some(cgrp =>
        cgrp.ships.some(cs => cs.deployedByGid === gid && !cs.destroyed && !cs.movedThisRound && !cs.firedThisActivation && !(cs.launchedThisRound > 0))
      );
      return !cellPending;
    }
    case 'confirmEndActivation': {
      if (state.phase !== 'play') return false;
      const ad = state.atmoDamage;
      if (!ad) return false;
      return ad.side === side;
    }
    case 'applyOrder': {
      const { gid, order } = intent;
      if (!ORDERS[order]) return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;            // only order your own Group
      if (nextUndeployedShipIdx(state, gid) >= 0) return false; // all ships must be deployed
      if (state.phase === 'play') {
        if (state.activeSide && state.activeSide !== side) return false; // not your turn
        const activatingGid = activeGroupIdForSide(state, def.side);
        if (activatingGid && activatingGid !== gid) return false;        // another Group mid-activation
      }
      // Order is locked once a ship has moved under the current Order.
      if (grp.order && order !== grp.order && grp.ships.some(s => !s.destroyed && s.movedThisRound)) return false;
      // Block order assignment on a cell group while cells are still mid-Porter-activation
      // (their order is locked to GQ via ship.order, set at deploy time).
      if (grp.ships.some(s => !s.destroyed && s.deployedByGid)) return false;
      return true;
    }
    case 'moveShip': {
      const { gid, si } = intent;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      if (!playTurnOk(state, side)) return false;
      const ship = grp.ships[si];
      if (!ship || ship.destroyed || ship.offTable || ship.movedThisRound) return false;
      const { o, maxR, minR, turnDeg } = moveCone(state, gid, si, intent.layerToggle);
      if (!o || o.moveMax <= 0) return false;
      const dx = intent.x - ship.x, dy = intent.y - ship.y;
      const dist = Math.hypot(dx, dy);
      if (dist < minR - 0.5 || dist > maxR + 0.5) return false;
      const fwd = headingVec(ship.heading);
      const cosA = (fwd.x * dx + fwd.y * dy) / Math.max(0.0001, dist);
      const ang = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
      return ang <= turnDeg + 0.5;
    }
    case 'aimShip': {
      const a = state.aiming;
      if (!a || (a.mode !== 'vectored' && a.mode !== 'course_change')) return false;
      const def = getDef(state, a.gid);
      if (!def || def.side !== side) return false;
      return playTurnOk(state, side);
    }
    case 'vectoredMove': {
      const v = state.vectoredSecondMove;
      if (!v) return false;
      const def = getDef(state, v.gid);
      if (!def || def.side !== side) return false;
      if (!playTurnOk(state, side)) return false;
      const vship = state.groups[v.gid] && state.groups[v.gid].ships[v.si];
      if (!vship) return false;
      const dx = intent.x - vship.x, dy = intent.y - vship.y;
      const dist = Math.hypot(dx, dy);
      const fwd = headingVec(vship.heading);
      const cos = (fwd.x * dx + fwd.y * dy) / Math.max(0.0001, dist);
      const angOff = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      return dist <= v.remaining + 0.5 && angOff <= 20;
    }
    case 'endVectoredMove': {
      const v = state.vectoredSecondMove;
      if (!v) return false;
      const def = getDef(state, v.gid);
      if (!def || def.side !== side) return false;
      return playTurnOk(state, side);
    }
    case 'beginLaunch': {
      const { gid, si, li } = intent;
      if (state.phase !== 'play') return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      const ship = grp.ships[si];
      if (!ship || ship.destroyed || ship.offTable) return false;
      if (!def.launch || !def.launch[li]) return false;
      return true;
    }
    case 'selectGate': {
      const { gid, si } = intent;
      if (!state.launching || state.launching.gid !== gid || state.launching.si !== si) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      return true;
    }
    case 'cancelLaunch': {
      const { gid, si } = intent;
      if (!state.launching || state.launching.gid !== gid || state.launching.si !== si) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      return true;
    }
    case 'launchAsset': {
      const { gid, si, kind, count } = intent;
      if (state.phase !== 'play') return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      const ship = grp.ships[si];
      if (!ship || ship.destroyed || ship.offTable) return false;
      if (ship.hasAssessed) return false;
      if (!kind || !(count > 0)) return false;
      return true;
    }
    case 'launchGroundAsset': {
      const { gid, si, gateSel } = intent;
      if (state.phase !== 'play') return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      const ship = grp.ships[si];
      if (!ship || ship.destroyed || ship.offTable) return false;
      // Voidgate route: the selected Voidgate must not be on MT, WF, or DC order
      // (those orders disable the gateship network).
      if (gateSel) {
        const gateGrp = state.groups[gateSel.gid];
        const gateOrder = gateGrp && gateGrp.order;
        if (gateOrder && ['MT', 'WF', 'DC'].includes(gateOrder)) return false;
      }
      return true;
    }
    case 'deployPayload': {
      const { gid, si, porterGid, porterSi, x, y } = intent;
      if (state.phase !== 'play') return false;
      const porterGrp = state.groups[porterGid];
      if (!porterGrp || porterGrp.activated) return false;
      const porterDef = getDef(state, porterGid);
      if (!porterDef || porterDef.side !== side) return false;
      const porter = porterGrp.ships[porterSi];
      if (!porter || porter.destroyed || porter.offTable) return false;
      const payGrp = state.groups[gid];
      const payShip = payGrp && payGrp.ships[si];
      if (!payShip || !payShip.offTable || !payShip.attachedTo) return false;
      if (payShip.attachedTo.gid !== porterGid || payShip.attachedTo.si !== porterSi) return false;
      const distPx = Math.hypot(x - porter.x, y - porter.y);
      if (distPx > 3 * INCH + 2) return false;
      return true;
    }
    case 'attackSetReroll': {
      if (state.phase !== 'play' || !state.attackModal) return false;
      if (!['hit','save'].includes(state.attackModal.step)) return false;
      if (intent.delta !== 1 && intent.delta !== -1) return false;
      // Attacker adjusts hit rerolls; defender adjusts save rerolls.
      const M = state.attackModal;
      const atkSide = M.bomber ? M.bomberSide : (M.attackerGid ? getDef(state, M.attackerGid)?.side : null);
      const defSide = atkSide === 'player1' ? 'player2' : 'player1';
      const isDefensiveReroll = M.step === 'save';
      return side === (isDefensiveReroll ? defSide : atkSide);
    }
    case 'attackSetFighterSpend': {
      if (state.phase !== 'play' || !state.attackModal) return false;
      if (state.attackModal.step !== 'save') return false;
      if (intent.delta !== 1 && intent.delta !== -1) return false;
      const M = state.attackModal;
      const s = M.shots && M.shots[M.shotIdx];
      if (!s) return false;
      const td = getDef(state, s.targetGid);
      return !!(td && td.side === side);
    }
    case 'adjustDropsiteDamage': {
      if (state.phase !== 'play' && state.phase !== 'da') return false;
      const { dsId, delta } = intent;
      if (delta !== 1 && delta !== -1) return false;
      const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === dsId);
      if (!ds || ds.destroyed) return false;
      if (delta === -1 && (ds.damage || 0) <= 0) return false;
      return true;
    }
    case 'adjustBattalion': {
      if (state.phase !== 'play' && state.phase !== 'da') return false;
      const { dsId, side: bSide, delta } = intent;
      if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) return false;
      if (!['player1','player2'].includes(bSide)) return false;
      const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === dsId);
      if (!ds) return false;
      return true;
    }
    case 'openDAFeatureAttack': {
      if (state.phase !== 'da' && state.phase !== 'play') return false;
      if (!state.dropsiteActivation || (side && state.dropsiteActivation.side !== side)) return false;
      const { dsId, fi } = intent;
      const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === dsId);
      if (!ds) return false;
      const fk = ds.features && ds.features[fi];
      if (!fk || !FEATURES[fk] || !(FEATURES[fk].weapon || FEATURES[fk].launch)) return false;
      if ((ds.destroyedFeatures || []).includes(fi)) return false;
      if (FEATURES[fk].weapon && (ds.firedFeatures || []).includes(fi)) return false;
      return true;
    }
    case 'daPickDropsite': {
      if (state.phase !== 'da' && state.phase !== 'play') return false;
      if (!state.dropsiteActivation || (side && state.dropsiteActivation.side !== side)) return false;
      const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === intent.dsId);
      return !!ds;
    }
    case 'attackSelectShot': {
      const M = state.attackModal;
      if (!M || M.step !== 'select') return false;
      if (intent.shotIdx == null || intent.shotIdx < 0 || intent.shotIdx >= M.shots.length) return false;
      return !(M.resolvedShots || []).includes(intent.shotIdx);
    }
    case 'attackStep':
    case 'attackReroll':
    case 'attackFighterReroll':
    case 'finishAttack':
    case 'attackDeclare': {
      if (state.phase !== 'play' || !state.attackModal) return false;
      // Bomber attacks in the asset phase: the attacker is the bomber's side, which may
      // differ from assetActiveSide (opponent's bombers resolve during your stage turn).
      const atk = (state.attackModal.bomber ? state.attackModal.bomberSide : null)
                  || state.assetActiveSide || state.activeSide;
      let def = atk === 'player1' ? 'player2' : atk === 'player2' ? 'player1' : null; // defender owns defensive choices
      // Defensive decisions (Shields / Brace / Contain, save re-rolls, Close
      // Protection) belong to the defender; the rest (advances, hit re-rolls,
      // Overcharge / Escort / Impel, finish) to the attacker.
      const defensive =
        (intent.type === 'attackFighterReroll') ||
        (intent.type === 'attackReroll' && intent.which === 'save') ||
        (intent.type === 'attackStep' && (intent.to === 'apply' || intent.to === 'rollbackup')) ||
        (intent.type === 'attackDeclare' && (intent.what === 'shield' || intent.what === 'shieldBooster' || intent.what === 'brace' || intent.what === 'contain'));
      // If activeSide is null (all activations done but attackModal still open), derive
      // the defender from the first target ship's faction so the shield intent can pass.
      if (defensive && def === null) {
        const M = state.attackModal;
        const firstShot = M.shots && M.shots[0];
        if (firstShot && firstShot.targetGid) {
          const tDef = getDef(state, firstShot.targetGid);
          if (tDef) def = tDef.side;
        }
      }
      return side === (defensive ? def : atk);
    }
    case 'nominateLead': {
      const { gid, si } = intent;
      if (state.phase !== 'play') return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      if (si == null) return true; // clearing the lead is always allowed
      const ship = grp.ships[si];
      if (!ship || ship.destroyed || ship.offTable) return false;
      return true;
    }
    case 'lockWeaponTarget': {
      const { gid, si, wi, targetGid, targetSi } = intent;
      if (state.phase !== 'play') return false;
      if (state.attackModal) return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      if (grp.order && ORDERS[grp.order]?.fireRule === 'none') return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      if (!playTurnOk(state, side)) return false;
      const ship = grp.ships[si];
      if (!ship || ship.destroyed || ship.offTable) return false;
      const w = def.weapons[wi];
      if (!w) return false;
      const tgrp = state.groups[targetGid];
      const tship = tgrp && tgrp.ships[targetSi];
      if (!tship || tship.destroyed || tship.offTable) return false;
      const origin = firingOriginShip(state, def, grp, si);
      if (!origin) return false;
      const tDef = getDef(state, targetGid);
      return weaponCanTarget(state, def, origin, w, tDef, tship, tgrp);
    }
    case 'lockBombardmentTarget': {
      const { gid, si, wi, dsId } = intent;
      if (state.phase !== 'play') return false;
      if (state.attackModal) return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      if (grp.order && ORDERS[grp.order]?.fireRule === 'none') return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      if (!playTurnOk(state, side)) return false;
      const ship = grp.ships[si];
      if (!ship || ship.destroyed || ship.offTable) return false;
      if ((ship.layer || 'orbit') !== 'orbit') return false;
      const w = def.weapons[wi];
      if (!w || !/Bombardment/i.test(w.special || '')) return false;
      const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === dsId);
      if (!ds) return false;
      const origin = firingOriginShip(state, def, grp, si);
      if (!origin) return false;
      const dsX = ds.x * INCH, dsY = ds.y * INCH;
      if (!pointInWeaponArc(origin, w, dsX, dsY)) return false;
      const scanRangePx = effectiveScan(def, origin) * INCH;
      if (Math.hypot(dsX - origin.x, dsY - origin.y) > scanRangePx) return false;
      return true;
    }
    case 'resolveBombardCollateral': {
      const M = state.attackModal;
      if (!M || M.step !== 'bombardCollateral') return false;
      if (!M.bombardCollateralQueue || !M.bombardCollateralQueue.length) return false;
      const q = M.bombardCollateralQueue[0];
      if (q.side !== side) return false;
      if (q.dsId !== intent.dsId) return false;
      const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === intent.dsId);
      if (!ds) return false;
      const b = dsBattalions(ds);
      if (!b[intent.loc] || (b[intent.loc][side] || 0) < 1) return false;
      return true;
    }
    case 'unlockWeapon': {
      const { gid, si } = intent;
      if (state.phase !== 'play') return false;
      if (state.attackModal) return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      const ship = grp.ships[si];
      if (!ship) return false;
      return true;
    }
    case 'fireWeapons': {
      const { gid } = intent;
      if (state.phase !== 'play') return false;
      if (state.attackModal) return false;
      const grp = state.groups[gid];
      if (!grp || grp.activated) return false;
      // The group's order must permit firing. MT / SR have fireRule 'none'.
      if (grp.order && ORDERS[grp.order]?.fireRule === 'none') return false;
      const def = getDef(state, gid);
      if (!def || def.side !== side) return false;
      if (!playTurnOk(state, side)) return false;
      // At least one ship must have a weapon locked onto a valid target.
      return grp.ships.some(ship => {
        if (ship.destroyed || ship.offTable || !ship.weaponTargets) return false;
        return Object.keys(ship.weaponTargets).length > 0;
      });
    }
    case 'advanceRound':
      return state.phase === 'play';

    case 'daFinishDropsite':
      // dsId is local-only; just verify DA is active and the dropsite isn't already done
      return !!(state.dropsiteActivation && intent.dsId
        && !state.dropsiteActivation.done.includes(intent.dsId));

    case 'daSwitchSide':
      return !!(state.dropsiteActivation);

    case 'daEnd':
      return !!(state.dropsiteActivation);

    case 'launchDropsiteAsset': {
      const da = state.dropsiteActivation;
      if (!da) return false;
      // dsId is local-only; validate using the intent's fromDropsite field instead
      const ds = intent.fromDropsite && state.scenarioData && state.scenarioData.dropsites &&
                 state.scenarioData.dropsites.find(d => d.id === intent.fromDropsite);
      if (!ds) return false;
      return true;
    }

    case 'setNomination': {
      const { side: nomSide, key: nomKey } = intent;
      if (!nomSide || !nomKey) return false;
      if (nomSide !== side) return false;
      if (state.phase !== 'nominations') return false;
      return true;
    }
    case 'confirmNominations': {
      if (state.phase !== 'nominations') return false;
      if (side && intent.side && intent.side !== side) return false;
      const confirmSide = intent.side || side;
      if (confirmSide && (state.nominationsReady || {})[confirmSide]) return false;
      return true;
    }
    case 'setProtectNom':
      return state.phase === 'protect' && (!intent.side || intent.side === side);
    case 'confirmProtectNom': {
      if (state.phase !== 'protect') return false;
      if (side && intent.side && intent.side !== side) return false;
      const protectSide = intent.side || side;
      if (protectSide && (state.protectNomReady || {})[protectSide]) return false;
      return true;
    }

    case 'applyShipOrder': {
      if (state.phase !== 'play') return false;
      const asGrp = state.groups[intent.gid];
      if (!asGrp || asGrp.activated) return false;
      const asDef = getDef(state, intent.gid);
      if (!asDef || asDef.side !== side) return false;
      if (!asDef.openNetwork) return false;
      const asShip = asGrp.ships[intent.si];
      if (!shipInNetwork(state, asDef, asShip)) return false;
      if (!ORDERS[intent.order]) return false;
      return true;
    }
    case 'holdPosition': {
      if (state.phase !== 'play') return false;
      const hpGrp = state.groups[intent.gid];
      if (!hpGrp || hpGrp.activated) return false;
      const hpDef = getDef(state, intent.gid);
      if (!hpDef || hpDef.side !== side) return false;
      if (!playTurnOk(state, side)) return false;
      const hpShip = hpGrp.ships[intent.si];
      if (!hpShip || hpShip.destroyed || hpShip.offTable) return false;
      if (hpShip.firedThisActivation || (hpShip.launchedThisRound > 0)) return false;
      const hpOrd = hpGrp.order;
      const inCourseChange = state.aiming && state.aiming.mode === 'course_change'
        && state.aiming.gid === intent.gid && state.aiming.si === intent.si;
      return (hpOrd === 'CC' || hpOrd === 'DC') && (!hpShip.movedThisRound || inCourseChange);
    }
    case 'surveySite':
    case 'objectivesFlyoff':
    case 'breakthroughFlyoff':
    case 'extractRecon': {
      if (state.phase !== 'play') return false;
      const { gid: exGid, si: exSi, dsId: exDsId } = intent;
      const exGrp = state.groups[exGid];
      if (!exGrp || exGrp.activated) return false;
      const exDef = getDef(state, exGid);
      if (!exDef || exDef.side !== side) return false;
      const exShip = exGrp.ships[exSi];
      if (!exShip || exShip.destroyed || exShip.offTable) return false;
      if (exShip.firedThisActivation || (exShip.launchedThisRound > 0)) return false;
      if (transportValue(exDef) <= 0) return false;
      const exDs = state.scenarioData?.dropsites?.find(d => d.id === exDsId);
      if (!exDs || !(exDs.reconOps > 0)) return false;
      if (Math.hypot(exShip.x - exDs.x * INCH, exShip.y - exDs.y * INCH) > 6 * INCH) return false;
      return true;
    }
    case 'assessDropsite': {
      if (state.phase !== 'play') return false;
      const { gid: asGid, si: asSi, dsId: asDsId } = intent;
      const asGrp = state.groups[asGid];
      if (!asGrp || asGrp.activated) return false;
      const asDef = getDef(state, asGid);
      if (!asDef || asDef.side !== side) return false;
      if (objectiveForSide(state, side) !== 'assess') return false;
      if (!isCapital(asDef)) return false;
      const asShip = asGrp.ships[asSi];
      if (!asShip || asShip.destroyed || asShip.offTable) return false;
      if (asShip.firedThisActivation || (asShip.launchedThisRound > 0) || asShip.hasAssessed) return false;
      if (asGrp.order !== 'GQ') return false;
      const asDs = state.scenarioData?.dropsites?.find(d => d.id === asDsId);
      if (!asDs || asDs.destroyed) return false;
      const asAssessed = (state.assessedDropsites && state.assessedDropsites[side]) || [];
      if (asAssessed.includes(asDsId)) return false;
      const asSr = asDs.siteRules || [];
      const asZone = state.deployZone && state.deployZone[side];
      if (!(asSr.includes('assess') || (asZone && asSr.includes(`assess_${asZone}`)))) return false;
      if (Math.hypot(asShip.x - asDs.x * INCH, asShip.y - asDs.y * INCH) > 6 * INCH) return false;
      return true;
    }
    case 'assetStageDone': {
      if (!state.assetPhase || state.assetPhase.step !== 'assets') return false;
      if (state.assetActiveSide !== intent.side || state.assetPhase.assetType !== intent.assetType) return false;
      if (side && intent.side !== side) return false;
      return true;
    }
    case 'assetPhaseDone': {
      if (!state.assetPhase || state.assetPhase.step !== 'assets') return false;
      if (state.assetActiveSide) return false;
      if (state.assetPhase._pendingBomberResolve) return false;
      if (side && intent.side !== side) return false;
      const doneSides = state.assetPhase.doneSides || [];
      if (doneSides.includes(intent.side)) return false; // already confirmed
      return true;
    }
    case 'placeScenery': {
      if (state.phase !== 'scenery') return false;
      const { sceneryType, x, y } = intent;
      if (!['micrometeor', 'dense'].includes(sceneryType)) return false;
      if (state.sceneryTurn && state.sceneryTurn !== side) return false;
      const placed = ((state.scenarioData && state.scenarioData.placedScenery) || []).filter(s => s.type === sceneryType).length;
      const target = ((state.scenarioData && state.scenarioData.sceneryTargets) || {})[sceneryType] || 0;
      if (placed >= target) return false;
      return sceneryValid(state, sceneryType, x, y).ok;
    }
    case 'assetMove': {
      if (!state.assetPhase || state.assetPhase.step !== 'assets') return false;
      const { assetId, x, y } = intent;
      const asset = (state.launchedAssets || []).find(a => a.id === assetId);
      if (!asset || asset.moved || asset.count <= 0) return false;
      if (side && asset.side !== side) return false;
      if (state.assetActiveSide && asset.side !== state.assetActiveSide) return false;
      if (asset.kind === 'mine') return false;
      const thrPx = assetThrust(state, asset) * INCH;
      return Math.hypot(x - asset.x, y - asset.y) <= thrPx + 2;
    }
    case 'fireFeatureWeapon': {
      if (state.phase !== 'da' && state.phase !== 'play') return false;
      // daActiveSide is set by openDAFeatureAttack; fall back to dropsiteActivation.side
      const _daActive = state.daActiveSide || state.dropsiteActivation?.side;
      if (!_daActive || (side && _daActive !== side)) return false;
      const { dsId, fi, targetGid, targetSi } = intent;
      const fwDs = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === dsId);
      if (!fwDs) return false;
      const fwFk = fwDs.features && fwDs.features[fi];
      if (!fwFk || !FEATURES[fwFk] || !FEATURES[fwFk].weapon) return false;
      if ((fwDs.destroyedFeatures || []).includes(fi)) return false;
      const fwTg = state.groups && state.groups[targetGid];
      if (!fwTg) return false;
      const fwTs = fwTg.ships && fwTg.ships[targetSi];
      return !!(fwTs && !fwTs.destroyed && !fwTs.offTable);
    }
    case 'startAssetMove':
      return !!(state.assetPhase && state.assetPhase.step !== 'assets');

    case 'assetT2T':
    case 'selectAssetMove':
    case 'assetLockTarget':
    case 'assetUntarget':
      return state.phase === 'play' || state.phase === 'deploy';

    case 'dismissDogfight':
      return !!state.dogfightResult;

    case 'beginBomberAttack':
      return !!(state.assetPhase && state.assetPhase.step === 'assets'
                && intent.side === side && !state.attackModal);

    case 'assetResetMove':
    case 'skipBattalionCombat':
    case 'resolveBoarding':
    case 'startBattalionCombat':
    case 'bcPickDropsite':
    case 'bcAssignGround':
    case 'bcSkipAssign':
    case 'bcToDestroy':
    case 'bcFinish':
    case 'daDestroyFeature':
      return state.phase === 'play' || state.phase === 'deploy';
    case 'deployDone': {
      if (state.phase !== 'deploy') return false;
      if (!intent.side || intent.side !== side) return false;
      if (state.deployDone && state.deployDone[side]) return false;
      // player2 must wait for player1 only if player1 actually has ships to deploy.
      if (side === 'player2' && sideNeedsDeployPhase(state, 'player1') && !(state.deployDone && state.deployDone.player1)) return false;
      return true;
    }

    case 'adjustAP': {
      if (!state.planning) return false;
      const { side: tSide, delta } = intent;
      if (!['player1','player2'].includes(tSide)) return false;
      if (typeof delta !== 'number' || !Number.isInteger(delta)) return false;
      if (side && tSide !== side) return false; // online: only own side can adjust their AP
      return true;
    }

    case 'adjustSpike': {
      const { gid, delta } = intent;
      const grp = state.groups && state.groups[gid];
      if (!grp) return false;
      if (delta !== 1 && delta !== -1) return false;
      if (side && grp.def.side !== side) return false;
      return true;
    }

    case 'adjustOrbitalDecay': {
      const { gid, si, delta } = intent;
      const grp = state.groups && state.groups[gid];
      if (!grp) return false;
      if (delta !== 1 && delta !== -1) return false;
      const ship = grp.ships && grp.ships[si];
      if (!ship || ship.destroyed) return false;
      if (delta === -1 && !(ship.orbitalDecayTokens > 0)) return false;
      return true;
    }

    case 'adjustHull': {
      const { gid, si, delta } = intent;
      const grp = state.groups && state.groups[gid];
      if (!grp) return false;
      const ship = grp.ships && grp.ships[si];
      if (!ship) return false;
      if (delta !== 1 && delta !== -1) return false;
      if (side && grp.def.side !== side) return false;
      return true;
    }

    default:
      return false;
  }
}

export function legalActions(state, side) {
  const out = [];

  // Always check the simple flow intents
  for (const type of INTENT_TYPES) {
    if (isLegal(state, { type }, side)) out.push({ type });
  }

  if (state.phase !== 'play') return out;

  // Initiative / planning
  if (isLegal(state, { type: 'giveInitiative' }, side)) out.push({ type: 'giveInitiative' });
  if (isLegal(state, { type: 'beginActivation' }, side)) out.push({ type: 'beginActivation' });

  // Per-group intents
  for (const gid of Object.keys(state.groups || {})) {
    // finishActivation
    const finIntent = { type: 'finishActivation', gid };
    if (isLegal(state, finIntent, side)) out.push(finIntent);

    // applyOrder — enumerate all orders
    for (const order of Object.keys(ORDERS)) {
      const oIntent = { type: 'applyOrder', gid, order };
      if (isLegal(state, oIntent, side)) out.push(oIntent);
    }
  }

  return out;
}
