// REST routes and WebSocket connection handler.

import { Router } from 'express';
import { createRoom, getRoom, getAllRooms, joinRoom, leaveRoom, broadcast, send, recordIntent } from './rooms.js';
import { isLegal } from './engine/gating.js';
import { apply, dsBattalions, kindsForAssetType } from './engine/mutators.js';
import { saveRoom, loadSave, loadAllSaves } from './saves.js';
import { APP_VERSION, RULEBOOK_VERSION, ERRATA_VERSION } from './engine/version.js';
import { getRoomSlot, setRoomSlot, getSaveOwners, deleteSaveDb } from './db.js';
import { triggerAi, shouldAiAct } from './ai/index.js';
import { buildAiFleet } from './ai/fleet-builder.js';
import { parseNewRecruit } from './fleet/parser.js';
import { FLEET_DB } from './fleet/db.js';

// ── AI vs AI test-mode helpers ────────────────────────────────────────────────
// AI vs AI uses only standard (core-rulebook) scenario components — no Scenario Expansion
// (SE1 / bespoke) layouts, deployments or objectives. All of these are the standard d6
// tables; the se1_* layouts and the bespoke:true deployments/objectives are excluded.
const _AI_FACTIONS   = ['ucm', 'shaltari', 'phr', 'resistance', 'scourge', 'bioficer'];
const _AI_LAYOUTS    = ['diagonal', 'edge_case', 'eruption', 'gatecrash', 'moonlight',
                        'moonstruck', 'take_and_hold', 'power_grab', 'shock_and_yaw'];
const _AI_APPROACHES = ['close_enough', 'standoff', 'column', 'counterattack'];
const _AI_DEPLOYMENTS = ['line', 'table_corners', 'midboard', 'from_corners',
                         'attacker_defender', 'encirclement'];
const _AI_OBJECTIVES = ['standard', 'attrition', 'survey'];
const _AI_SECONDARIES = ['annihilate', 'take_prizes', 'gather_intel', 'decapitate',
                         'key_site', 'priority_target', 'long_shot', 'objectives_beyond'];
const _AI_PERSONALITIES = ['aggressive', 'positional', 'defensive', 'balanced', 'opportunist'];
function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function _pickN(arr, n) { return [...arr].sort(() => Math.random() - 0.5).slice(0, n); }

// True when all activations are done and no end-of-round state is pending.
function _needsRoundEnd(state) {
  if (state.phase !== 'play' || state.gameOver) return false;
  if (state.attackModal || state.dropsiteActivation || state.assetPhase ||
      state.battalionCombat || state.repairPhase || state.atmoDamage) return false;
  if (state.activeSide || state.initiative) return false;
  return true;
}

// AI vs AI: apply an intent as whichever side it's legal for (both sides are AI,
// so e.g. the defender's save and the attacker's advances each resolve correctly).
function _applyAnySide(room, intent) {
  for (const who of ['player1', 'player2']) {
    if (isLegal(room.state, intent, who)) {
      apply(room.state, intent, room.rng);
      if (room.playStartState) recordIntent(room, who, intent);
      return true;
    }
  }
  return false;
}

// AI vs AI: fully resolve a stuck attack modal, applying each step as the legal side
// (a human normally drives the defender's part). Mirrors translator.js#resolveAttackModal.
function _resolveAttackModalBoth(room) {
  let guard = 200;
  while (room.state.attackModal && guard-- > 0) {
    const M = room.state.attackModal;
    let to = null;
    switch (M.step) {
      case 'intro': to = 'hit'; break;
      case 'hit': to = M.hitResult ? 'save' : 'hit'; break;
      case 'save': {
        if (!M.saveResult) { to = 'save'; break; }
        const sr = M.saveResult;
        const needBackup = !sr.backupRolled && sr.hitsList?.some(h => !h.saved && h.sv != null) && sr.backupVal != null;
        to = needBackup ? 'rollbackup' : 'apply'; break;
      }
      case 'crippling': { const c = M.crippleQueue?.[0]; to = c ? (c.rolled ? 'crippling-next' : 'crippling-roll') : null; break; }
      case 'explosion': { const e = M.explodeQueue?.[0]; to = e ? (e.rolled ? 'explosion-next' : 'explosion-roll') : null; break; }
      case 'impel': { if (!_applyAnySide(room, { type: 'attackDeclare', what: 'impel', choice: 'turn' })) return; continue; }
      case 'bombardCollateral': {
        const q = M.bombardCollateralQueue?.[0];
        if (!q) { to = null; break; }
        // Gating requires dsId to match the queue head and loc to hold ≥1 of q.side's
        // battalions — pick any such location (ground/orbit or a feature key).
        const ds = room.state.scenarioData?.dropsites?.find(d => d.id === q.dsId);
        const b = ds ? dsBattalions(ds) : {};
        const loc = Object.keys(b).find(L => (b[L]?.[q.side] || 0) > 0);
        if (loc && _applyAnySide(room, { type: 'resolveBombardCollateral', dsId: q.dsId, loc })) continue;
        return; // nothing removable (shouldn't happen) — bail rather than spin
      }
      default: to = null;
    }
    if (to ? !_applyAnySide(room, { type: 'attackStep', to }) : !_applyAnySide(room, { type: 'finishAttack' })) return;
  }
}

// AI vs AI: resolve the asset-phase bomber/torpedo attacks a human normally drives.
// When a bomber/torpedo moves into base contact it auto-locks a target, and
// assetStageDone flags state.assetPhase._pendingBomberResolve instead of advancing.
// Mirrors the client's resolvePendingBomberAttacks: open one attack modal per
// target group, resolve it, drop dead targets, then re-run assetStageDone to advance.
// All progress is made through recorded intents so AI-vs-AI replays stay consistent.
function _resolvePendingBomberBoth(room) {
  const ap = room.state.assetPhase;
  const pbr = ap && ap._pendingBomberResolve;
  if (!pbr) return false;
  const kinds = kindsForAssetType(pbr.type);
  const assets = room.state.launchedAssets || [];
  const inScope = a => a.bomberTarget && a.side === pbr.side && kinds.includes(a.kind);
  // Drop any lock on a target that's already gone (recorded, so replay matches).
  const dead = assets.find(a => {
    if (!inScope(a)) return false;
    const ts = room.state.groups[a.bomberTarget.gid]?.ships[a.bomberTarget.si];
    return !ts || ts.destroyed || ts.offTable;
  });
  if (dead) return _applyAnySide(room, { type: 'assetUntarget', assetId: dead.id });
  const live = assets.filter(inScope);
  if (live.length) {
    const f = live[0];
    const pool = live.filter(a => a.kind === f.kind
      && a.bomberTarget.gid === f.bomberTarget.gid && a.bomberTarget.si === f.bomberTarget.si);
    if (!_applyAnySide(room, { type: 'beginBomberAttack', assetIds: pool.map(a => a.id),
        targetGid: f.bomberTarget.gid, targetSi: f.bomberTarget.si, side: f.side, kind: f.kind })) return false;
    _resolveAttackModalBoth(room);
    return true;
  }
  // No live attacks remain — re-run the stage advance, which clears _pendingBomberResolve.
  return _applyAnySide(room, { type: 'assetStageDone', side: pbr.side, assetType: pbr.type });
}

export const router = Router();

// GET /api/meta — app and ruleset version info.
router.get('/meta', (_req, res) => {
  res.json({ appVersion: APP_VERSION, rulebookVersion: RULEBOOK_VERSION, errataVersion: ERRATA_VERSION });
});

// POST /api/rooms — create a new room, return its code.
// Accepts optional body { aiOpponent, aiSide, aiPersonality, aiFaction, aiSecondaries, targetPts }
// for solo-vs-AI rooms. aiFaction is optional — omit to defer fleet building to /build-ai.
router.post('/rooms', (req, res) => {
  const room = createRoom();
  console.log(`Room ${room.id} created (seed ${room.seed})`);
  if (req.user) {
    room.creatorUserId = req.user.id;
    setRoomSlot(room.id, 'player1', req.user.id);
  }

  const { aiOpponent, aiVsAi, aiSide, aiPersonality, aiFaction, aiSecondaries, aiUseLlm } = req.body || {};

  if (aiVsAi) {
    // Two random 1000pt AI fleets battle each other; spectators watch. Uses the
    // fallback (non-LLM) AI by leaving aiUseLlm unset, so both sides don't hit the LLM.
    const LABELS = { aggressive:'Aggressive', positional:'Positional', defensive:'Defensive', balanced:'Balanced', opportunist:'Opportunist' };
    // Each side gets its own random personality (an explicit aiPersonality in the request,
    // if given, pins both sides; otherwise each is rolled independently).
    const persP1 = aiPersonality || _pick(_AI_PERSONALITIES);
    const persP2 = aiPersonality || _pick(_AI_PERSONALITIES);
    const factionP1 = _pick(_AI_FACTIONS);
    const factionP2 = _pick(_AI_FACTIONS);
    room.aiSide        = 'both';
    room.aiPersonality = persP1; // legacy single-value field (player1's)
    room.aiPersonalities = { player1: persP1, player2: persP2 };
    room.allowSpectators = true; // AI vs AI games are always public
    room.state.aiSide  = 'both';
    room.state.aiVsAi  = true;
    room.state.aiPersonality = persP1;
    room.state.aiPersonalities = { player1: persP1, player2: persP2 };
    room.state.fleetChoices.f1 = factionP1;
    room.state.fleetChoices.f2 = factionP2;
    room.state.secondaryChoice.f1 = _pickN(_AI_SECONDARIES, 2);
    room.state.secondaryChoice.f2 = _pickN(_AI_SECONDARIES, 2);
    room.state.playerNames = { f1: `AI-Red (${LABELS[persP1] || 'Balanced'})`, f2: `AI-Blue (${LABELS[persP2] || 'Balanced'})` };
    room.state.scenario = {
      layout:     _pick(_AI_LAYOUTS),
      approach:   _pick(_AI_APPROACHES),
      deployment: _pick(_AI_DEPLOYMENTS), // give the game a real deployment zone
      objective:  _pick(_AI_OBJECTIVES),
      variant:    'none',
    };
    for (const [slot, faction, persona] of [['f1', factionP1, persP1], ['f2', factionP2, persP2]]) {
      const fleet = buildAiFleet({ faction, targetPts: 1000, admiralLevel: 0, personality: persona });
      if (fleet) room.state.importedFleets[slot] = fleet;
    }
    apply(room.state, { type: 'readySetup', side: 'player1' }, room.rng);
    apply(room.state, { type: 'readySetup', side: 'player2' }, room.rng);
    console.log(`Room ${room.id} — AI vs AI (${factionP1}/${persP1} vs ${factionP2}/${persP2}, ${room.state.scenario.layout})`);
    setImmediate(() => maybeAiTurn(room).catch(err => console.error(`[${room.id}] AI vs AI error:`, err.message)));
    return res.json({ roomId: room.id });
  }

  if (aiOpponent) {
    const side = aiSide === 'player1' ? 'player1' : 'player2';
    const slot = side === 'player1' ? 'f1' : 'f2';
    room.aiSide        = side;
    room.aiPersonality = aiPersonality || 'balanced';
    room.aiUseLlm      = !!aiUseLlm;
    room.state.aiSide  = side; // persisted in state JSON for resume

    const PERSONALITY_LABELS = { aggressive:'Aggressive', positional:'Positional', defensive:'Defensive', balanced:'Balanced', opportunist:'Opportunist' };
    room.state.aiOpponent   = true;
    room.state.aiPersonality = room.aiPersonality;
    room.state.fleetChoices[slot]    = aiFaction || null;
    room.state.secondaryChoice[slot] = Array.isArray(aiSecondaries) && aiSecondaries.length ? aiSecondaries.slice(0, 2) : null; // resolved after fleet build
    room.state.playerNames[slot]     = `AI (${PERSONALITY_LABELS[room.aiPersonality] || 'Balanced'})`;

    if (aiFaction) {
      const fleet = buildAiFleet({
        faction:      aiFaction,
        targetPts:    req.body.targetPts || 1500,
        admiralLevel: req.body.aiAdmiralLevel || 0,
        personality:  room.aiPersonality,
      });
      if (fleet) {
        room.state.importedFleets[slot] = fleet;
        room.aiTactics = fleet.tactics || [];
        if (room.state.secondaryChoice[slot] === null) {
          room.state.secondaryChoice[slot] = fleet.secondaries || [];
        }
      }
    }
    if (room.state.secondaryChoice[slot] === null) room.state.secondaryChoice[slot] = [];
    console.log(`Room ${room.id} — AI on ${side} (${room.aiPersonality}, ${aiFaction || 'no faction'})`);
  }

  const { allowSpectators } = req.body || {};
  if (allowSpectators === false) room.allowSpectators = false;

  res.json({ roomId: room.id, seed: room.seed });
});

// POST /api/rooms/:id/build-ai — build/rebuild the AI fleet. Called at "Begin vs AI".
// Body: { mode: 'fastplay'|'generate'|'import', personality, useLlm, secondaries,
//         faction (fastplay/generate), targetPts (generate), importText (import) }
router.post('/rooms/:id/build-ai', (req, res) => {
  const room = getRoom(req.params.id.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!room.aiSide) return res.status(400).json({ error: 'Not a solo room' });

  const slot = room.aiSide === 'player1' ? 'f1' : 'f2';
  const { mode = 'generate', faction, targetPts, useLlm, secondaries, importText, personality } = req.body || {};

  room.aiPersonality           = personality || 'balanced';
  room.aiUseLlm                = !!useLlm;
  room.state.aiPersonality     = room.aiPersonality;

  let fleet = null;
  let resolvedFaction = faction;

  if (mode === 'fastplay' || mode === 'quickplay') {
    if (!faction) return res.status(400).json({ error: 'Select an AI faction first' });
    fleet = buildAiFleet(faction); // legacy string call → fastplay list
    resolvedFaction = faction;

  } else if (mode === 'generate') {
    const allFactions = Object.keys(FLEET_DB);
    resolvedFaction = (!faction || faction === 'random')
      ? allFactions[Math.floor(Math.random() * allFactions.length)]
      : faction;
    fleet = buildAiFleet({ faction: resolvedFaction, targetPts: targetPts || 1500, personality: room.aiPersonality });
    if (!fleet) return res.status(500).json({ error: 'Fleet builder failed — try a different faction or point total' });

  } else if (mode === 'import') {
    if (!importText?.trim()) return res.status(400).json({ error: 'Paste a fleet list first' });
    const parsed = parseNewRecruit(importText);
    if (!parsed?.valid || !parsed.groups?.length) return res.status(400).json({ error: 'Could not parse fleet list — check the format' });
    fleet = { faction: parsed.faction, groups: parsed.groups, admirals: parsed.admirals || [], admiralLevel: parsed.admiralLevel || 0, secondaries: parsed.secondaries || [], tactics: [] };
    resolvedFaction = parsed.faction;

  } else {
    return res.status(400).json({ error: 'Unknown mode' });
  }

  room.state.fleetChoices[slot]   = resolvedFaction;
  room.state.importedFleets[slot] = fleet;
  room.aiTactics = fleet.tactics || [];

  if (Array.isArray(secondaries) && secondaries.length) {
    room.state.secondaryChoice[slot] = secondaries.slice(0, 2);
  } else {
    room.state.secondaryChoice[slot] = fleet.secondaries || [];
  }

  const PERSONALITY_LABELS = { aggressive:'Aggressive', positional:'Positional', defensive:'Defensive', balanced:'Balanced', opportunist:'Opportunist' };
  room.state.playerNames[slot] = `AI (${PERSONALITY_LABELS[room.aiPersonality] || 'Balanced'})`;
  broadcast(room, { type: 'full', state: room.state });
  console.log(`Room ${room.id} — AI fleet built [${mode}]: ${resolvedFaction} ${room.aiPersonality}`);
  res.json({ ok: true, faction: resolvedFaction, secondaries: room.state.secondaryChoice[slot] });
});

// POST /api/rooms/:id/configure-ai — update AI personality/useLlm/secondaries without rebuilding fleet.
router.post('/rooms/:id/configure-ai', (req, res) => {
  const room = getRoom(req.params.id.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!room.aiSide) return res.status(400).json({ error: 'Not a solo room' });
  const { personality, useLlm, secondaries } = req.body || {};
  const slot = room.aiSide === 'player1' ? 'f1' : 'f2';
  const PERSONALITY_LABELS = { aggressive:'Aggressive', positional:'Positional', defensive:'Defensive', balanced:'Balanced', opportunist:'Opportunist' };
  if (personality) {
    room.aiPersonality = personality;
    room.state.aiPersonality = personality;
    room.state.playerNames[slot] = `AI (${PERSONALITY_LABELS[personality] || personality})`;
  }
  if (useLlm !== undefined) room.aiUseLlm = !!useLlm;
  if (Array.isArray(secondaries) && secondaries.length) room.state.secondaryChoice[slot] = secondaries.slice(0, 2);
  broadcast(room, { type: 'full', state: room.state });
  res.json({ ok: true });
});

// GET /api/rooms — list live spectatable games.
router.get('/rooms', (_req, res) => {
  res.json(
    getAllRooms()
      .filter(r => r.allowSpectators && r.state.phase !== 'setup')
      .map(r => ({
        roomId:      r.id,
        phase:       r.state.phase,
        round:       r.state.round,
        playerNames: r.state.playerNames,
        factions:    { player1: r.state.fleetChoices?.f1, player2: r.state.fleetChoices?.f2 },
        spectators:  r.spectators.length,
      }))
  );
});

// GET /api/rooms/:id — check whether a room exists and who has joined.
router.get('/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  res.json({
    roomId:          room.id,
    sides:           { player1: !!room.sockets.player1, player2: !!room.sockets.player2 },
    phase:           room.state.phase,
    allowSpectators: room.allowSpectators !== false,
  });
});

// GET /api/saves — list saved games. Authenticated users see only their own saves.
router.get('/saves', async (req, res) => {
  const userId = req.user?.id ?? null;
  const saves = await loadAllSaves(userId);
  res.json(
    saves
      .filter(s => s.phase && s.phase !== 'setup')
      .map(s => ({
        roomId:      s.roomId,
        phase:       s.phase,
        round:       s.round,
        savedAt:     s.savedAt,
        playerNames: s.playerNames ?? {},
        factions:    s.factions    ?? {},
        sideColors:  s.sideColors  ?? null,
        isHotseat:   s.isHotseat || false,
        isAi:        s.isAi      || false,
        gameOver:    s.gameOver  || false,
        hasReplay:   !!s.hasReplay,
      }))
  );
});

// POST /api/saves/hotseat — save a hotseat game state snapshot.
router.post('/saves/hotseat', async (req, res) => {
  const { roomId, state, seed, currentRngState, playStartState, playStartRngState, intentLog } = req.body;
  if (!roomId || !state) return res.status(400).json({ error: 'Missing roomId or state.' });
  const room = {
    id: roomId,
    state,
    seed: seed ?? null,
    createdAt: state.createdAt || Date.now(),
    rng: { getState: () => currentRngState ?? null },
    playStartState: playStartState || null,
    playStartRngState: playStartRngState ?? null,
    intentLog: intentLog || [],
    isHotseat: true,
  };
  try {
    await saveRoom({ ...room, isHotseat: true }, req.user?.id ?? null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/saves/:id — full save data for resume/replay.
router.get('/saves/:id', async (req, res) => {
  try {
    const save = await loadSave(req.params.id.toUpperCase());
    res.json(save);
  } catch {
    res.status(404).json({ error: 'Save not found.' });
  }
});

// DELETE /api/saves/:id — delete a save. Only owner or player2 may delete.
router.delete('/saves/:id', (req, res) => {
  const roomId = req.params.id.toUpperCase();
  if (req.user) {
    const owners = getSaveOwners(roomId);
    if (owners.owner_user_id !== req.user.id && owners.player2_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your save.' });
    }
  }
  try {
    deleteSaveDb(roomId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rooms/:id/replay — full replay data for a room (from its save file).
router.get('/rooms/:id/replay', async (req, res) => {
  try {
    const save = await loadSave(req.params.id);
    if (!save.playStartState) {
      return res.status(404).json({ error: 'No replay data — game has not started yet.' });
    }
    res.json({
      roomId:            save.roomId,
      seed:              save.seed,
      playerNames:       save.playerNames,
      factions:          save.factions,
      playStartState:    save.playStartState,
      playStartRngState: save.playStartRngState,
      intentLog:         save.intentLog,
    });
  } catch {
    res.status(404).json({ error: 'Save not found.' });
  }
});

// POST /api/rooms/resume — recreate a live room from a saved game.
router.post('/rooms/resume', async (req, res) => {
  const { saveId } = req.body || {};
  if (!saveId) return res.status(400).json({ error: 'saveId required.' });
  let save;
  try {
    save = await loadSave(saveId);
  } catch {
    return res.status(404).json({ error: 'Save not found.' });
  }
  // If the room is already live in memory (the other player already resumed it),
  // reuse it rather than overwriting it — otherwise the first player's WebSocket
  // closure would reference a stale room object and chat / broadcasts would break.
  let room = getRoom(save.roomId);
  if (!room) {
    room = createRoom(save.roomId);
    room.state             = save.currentState;
    room.seed              = save.seed;
    room.rng.setState(save.currentRngState);
    room.intentLog         = save.intentLog        || [];
    room.playStartState    = save.playStartState    || null;
    room.playStartRngState = save.playStartRngState ?? null;
    room.createdAt         = save.createdAt         || room.createdAt;
    room.aiSide        = save.currentState?.aiSide        || null;
    room.aiPersonality = save.currentState?.aiPersonality || null;
    room.aiPersonalities = save.currentState?.aiPersonalities || null;
  }

  // Restore slot ownership from the save's stored user IDs.
  // Determine which side the requesting user held in the original game.
  let userSide = null;
  if (req.user) {
    const owners = getSaveOwners(save.roomId);
    if (owners.owner_user_id === req.user.id) {
      userSide = 'player1';
      setRoomSlot(room.id, 'player1', req.user.id);
      if (owners.player2_user_id) setRoomSlot(room.id, 'player2', owners.player2_user_id);
    } else if (owners.player2_user_id === req.user.id) {
      userSide = 'player2';
      setRoomSlot(room.id, 'player2', req.user.id);
      if (owners.owner_user_id) setRoomSlot(room.id, 'player1', owners.owner_user_id);
    } else {
      // User not in the original game — default to player1 if free.
      userSide = 'player1';
      setRoomSlot(room.id, 'player1', req.user.id);
    }
  }

  console.log(`Room ${room.id} resumed from save ${save.roomId} (round ${save.round})${room.aiSide ? ` — AI on ${room.aiSide}` : ''}`);
  res.json({ roomId: room.id, seed: room.seed, userSide });
  if (room.aiSide) setImmediate(() => maybeAiTurn(room).catch(err => console.error(`[${room.id}] resume AI error:`, err.message)));
});

// ---------------------------------------------------------------------------
// WebSocket connection handler
// ---------------------------------------------------------------------------

function broadcastSpectatorList(room) {
  const list = room.spectators
    .filter(ws => ws.readyState === 1)
    .map(ws => ws._spectatorUsername || 'Spectator');
  broadcast(room, { type: 'spectators', list });
}

export function handleConnection(ws, req) {
  const url = new URL(req.url, 'http://localhost');
  const roomId  = (url.searchParams.get('room') || '').toUpperCase();
  const rawSide = (url.searchParams.get('side')  || 'spectator').toLowerCase();
  const side    = rawSide; // 'player1' | 'player2' | 'spectator'

  const room = getRoom(roomId);
  if (!room) {
    send(ws, { type: 'error', reason: 'Room not found.' });
    ws.close();
    return;
  }

  // Capture the authenticated user id at connection time so message handlers
  // can pass it to saveRoom without holding a reference to req.
  const connectedUserId = req.user?.id ?? null;

  if (side === 'player1' || side === 'player2') {
    // Slot ownership check: if the slot is claimed, only the owning user may connect.
    const slot = getRoomSlot(roomId, side);
    if (slot) {
      if (slot.user_id !== connectedUserId) {
        send(ws, { type: 'error', reason: 'This player slot is reserved for another user.' });
        ws.close();
        return;
      }
    } else if (connectedUserId) {
      // Slot is free — authenticated user claims it.
      setRoomSlot(roomId, side, connectedUserId);
    }

    const result = joinRoom(room, side, ws);
    if (result.error) {
      send(ws, { type: 'error', reason: result.error });
      ws.close();
      return;
    }
  } else {
    if (room.allowSpectators === false) {
      send(ws, { type: 'error', reason: 'Spectators are not allowed in this room.' });
      ws.close();
      return;
    }
    ws._spectatorUsername = req.user?.username || 'Spectator';
    room.spectators.push(ws);
  }

  // Register lifecycle handlers immediately so they're always wired,
  // regardless of any exception in the setup code below.
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    onMessage(room, ws, side, msg, connectedUserId);
  });
  ws.on('close', () => {
    console.log(`[${roomId}] ${side} disconnected`);
    leaveRoom(room, ws);
    broadcast(room, { type: 'opponentLeft', side });
    broadcastSpectatorList(room);
  });
  ws.on('error', err => console.error(`[${roomId}/${side}] WS error: ${err.message}`));

  console.log(`[${roomId}] ${side} connected${req.user ? ` (${req.user.username})` : ''}`);

  // Update the player name in game state from the authenticated username.
  if (req.user && (side === 'player1' || side === 'player2')) {
    const slot = side === 'player1' ? 'f1' : 'f2';
    room.state.playerNames[slot] = req.user.username;
    broadcast(room, { type: 'full', state: room.state }, ws);
  }

  send(ws, { type: 'joined', side, roomId, state: room.state });
  if ((room.chatHistory || []).length > 0) send(ws, { type: 'chatHistory', messages: room.chatHistory });
  broadcast(room, { type: 'peerJoined', side }, ws);
  broadcastSpectatorList(room); // updates everyone's spectator chip, including the new arrival
  // Re-trigger AI in case it should act (e.g. after a resume where it was the AI's turn).
  if (room.aiSide) setImmediate(() => maybeAiTurn(room).catch(err => console.error(`[${room.id}] connect AI error:`, err.message)));
}

// ---------------------------------------------------------------------------
// AI trigger
// ---------------------------------------------------------------------------

async function maybeAiTurn(room) {
  if (!room.aiSide || room.aiPending) return;

  // Which side has the next decision right now? For AI vs AI (aiSide==='both')
  // this resolves the acting side from the current phase.
  function effectiveAiSide() {
    if (room.aiSide !== 'both') return room.aiSide;
    const s = room.state;
    if (s.phase === 'scenery')     return (s.sceneryReady    ||{}).player1 ? 'player2' : 'player1';
    if (s.phase === 'nominations') return (s.nominationsReady||{}).player1 ? 'player2' : 'player1';
    if (s.phase === 'protect')     return (s.protectNomReady ||{}).player1 ? 'player2' : 'player1';
    if (s.phase === 'deploy')      return (s.deployDone||{}).player1 ? 'player2' : 'player1';
    if (s.activeSide) return s.activeSide;
    if (s.dropsiteActivation) return s.dropsiteActivation.side;
    if (s.assetPhase?.step === 'assets') {
      if (s.assetActiveSide) return s.assetActiveSide;
      const done = s.assetPhase.doneSides || [];
      return done.includes('player1') ? 'player2' : 'player1';
    }
    if (s.battalionCombat) return s.initiativeHolder || 'player1';
    if (s.initiative?.winner && !s.initiative?.holder) return s.initiative.winner;
    if (s.initiative?.holder && !s.activeSide) return s.initiative.holder;
    return s.initiativeHolder || 'player1';
  }

  const side0 = effectiveAiSide();
  if (!shouldAiAct(room.state, side0) && !_needsRoundEnd(room.state)) return;

  room.aiPending = true;
  broadcast(room, { type: 'aiThinking', thinking: true });
  console.log(`[${room.id}] AI${room.aiSide === 'both' ? ' vs AI' : ''} turn — phase:${room.state.phase} activeSide:${room.state.activeSide}`);
  try {
    const both = room.aiSide === 'both';
    // AI vs AI runs the whole game in one call (no human to re-trigger it), so the
    // guard is large; solo only runs until it's the human's turn.
    let guard = both ? 200000 : 200;
    let iters = 0;
    // Defensive no-progress guard for AI vs AI: if the game state stops changing for a
    // long stretch, break rather than spin to the 200000 guard (which would block the
    // event loop for minutes and lock the spectator's view).
    let progSig = '', progStuck = 0;
    const computeProgSig = () => {
      const s = room.state;
      let n = 0;
      for (const g of Object.values(s.groups || {})) for (const sh of g.ships) {
        n += (sh.activated ? 1 : 0) + (sh.destroyed ? 2 : 0) + (sh.offTable ? 4 : 0)
           + (sh.movedThisRound ? 8 : 0) + (sh.firedThisActivation ? 16 : 0);
      }
      const aps = (s.launchedAssets || []).reduce((a, x) => a + (x.moved ? 1 : 0) + (x.count || 0), 0);
      return `${s.phase}|${s.round}|${s.activeSide}|${!!s.gameOver}|${s.assetPhase?.step}|${s.assetActiveSide}|${s.battalionCombat?.stage}|${s.dropsiteActivation?.side}|${n}|${aps}`;
    };
    while (guard-- > 0) {
      if (room.state.gameOver) break;
      // Capture the play-start snapshot as soon as we enter play phase.
      // (Normally done in onMessage, but AI vs AI bypasses the WS handler.)
      if (room.state.phase === 'play' && !room.playStartState) {
        room.playStartState    = structuredClone(room.state);
        room.playStartRngState = room.rng.getState();
      }

      if (both) {
        // Resolve the interrupt states a human/client normally drives.
        if (room.state.attackModal)      { _resolveAttackModalBoth(room); }
        else if (room.state.assetPhase?._pendingBomberResolve) { if (!_resolvePendingBomberBoth(room)) break; }
        else if (room.state.atmoDamage)  { if (!_applyAnySide(room, { type: 'confirmEndActivation' })) break; }
        else if (room.state.repairPhase) { if (!_applyAnySide(room, { type: 'advanceRound' })) break; } // finishes repair → advances
        // Battalion-combat init: the asset phase opened (step !== 'assets') but isn't
        // resolved — contested dropsites remain (autoAdvanceAssetPhase sets resolved=true
        // only when none are contested). A human clicks "BATTALION COMBAT ▸" here; the
        // driver casts it, then handleBattalion drives the bc* sub-steps to completion.
        else if (room.state.assetPhase && room.state.assetPhase.step !== 'assets'
                 && !room.state.assetPhase.resolved && !room.state.battalionCombat) {
          if (!_applyAnySide(room, { type: 'startBattalionCombat' })) break;
        }
        else {
          const side = effectiveAiSide();
          if (shouldAiAct(room.state, side)) {
            // Each side plays with its own (randomised) personality in AI-vs-AI.
            const sidePers = room.aiPersonalities?.[side] || room.aiPersonality;
            await triggerAi({ ...room, aiSide: side, aiPersonality: sidePers }, (intent) => {
              if (room.playStartState) recordIntent(room, side, intent);
            });
          } else if (_needsRoundEnd(room.state)) {
            if (!_applyAnySide(room, { type: 'endRound' })) break; // begin the end-of-round sequence
          } else break;
        }
        // No-progress safety net: any real progress (activations, kills, arrivals,
        // moves, asset/phase changes) flips the signature; 3000 unchanged iterations
        // means we're stuck, so bail instead of freezing the server.
        const sigNow = computeProgSig();
        if (sigNow === progSig) {
          if (++progStuck > 3000) { console.warn(`[${room.id}] AI vs AI no progress — stopping`); break; }
        } else { progSig = sigNow; progStuck = 0; }
        // Yield after EVERY step so the event loop can service spectator connections,
        // new requests and outgoing broadcasts between activations. A single MCTS-heavy
        // activation can take hundreds of ms; only yielding every 40 steps let those
        // pile up and the whole app appeared to lock up. Broadcast the running state on
        // a light time throttle so spectators watch it unfold live.
        iters++;
        const now = Date.now();
        if (now - (room._lastAiBcast || 0) >= 200) {
          room._lastAiBcast = now;
          broadcast(room, { type: 'full', state: room.state });
        }
        await new Promise(r => setImmediate(r));
        continue;
      }

      // Solo vs AI — run until it's the human's turn.
      const side = effectiveAiSide();
      if (shouldAiAct(room.state, side)) {
        await triggerAi({ ...room, aiSide: side }, (intent) => {
          if (room.playStartState) recordIntent(room, side, intent);
        });
      } else break;
    }
    if (guard <= 0) console.warn(`[${room.id}] AI guard exhausted — possible loop`);
  } catch (err) {
    console.error(`[${room.id}] AI error:`, err.message, err.stack);
  } finally {
    // Always broadcast so the client is never stuck waiting for the AI.
    broadcast(room, { type: 'aiThinking', thinking: false });
    broadcast(room, { type: 'full', state: room.state });
    saveRoom(room, null).catch(err => console.error(`[${room.id}] AI save error:`, err.message));
    room.aiPending = false;
    console.log(`[${room.id}] AI done — phase:${room.state.phase} activeSide:${room.state.activeSide}`);
  }
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

function onMessage(room, ws, side, msg, userId) {
  room.lastActivity = Date.now();

  // Spectators are read-only — only allow resync and chat.
  if (side === 'spectator' && msg.type !== 'resync' && msg.type !== 'chat') return;

  switch (msg.type) {

    case 'state': {
      if (!msg.state || typeof msg.state !== 'object') {
        send(ws, { type: 'error', reason: 'Invalid state payload.' });
        return;
      }
      room.state = msg.state;
      saveRoom(room, userId).catch(err => console.error(`[${room.id}] save error:`, err.message));
      broadcast(room, { type: 'full', state: room.state }, ws);
      break;
    }

    case 'resync': {
      send(ws, { type: 'full', state: room.state });
      break;
    }

    case 'intent': {
      const intent = msg.intent;
      if (!intent || typeof intent !== 'object') {
        send(ws, { type: 'error', reason: 'Invalid intent payload.' });
        return;
      }
      if (!isLegal(room.state, intent, side)) {
        send(ws, { type: 'error', reason: `Illegal action: ${intent.type}` });
        send(ws, { type: 'full', state: room.state });
        return;
      }
      if (intent.type === 'endRound') {
        room.endRoundVotes.add(side);
        if (room.aiSide === 'both') { room.endRoundVotes.add('player1'); room.endRoundVotes.add('player2'); }
        else if (room.aiSide) room.endRoundVotes.add(room.aiSide);
        const connected = Object.values(room.sockets).filter(Boolean).length;
        broadcast(room, { type: 'endRoundVotes', votes: [...room.endRoundVotes] });
        if (room.endRoundVotes.size < Math.max(connected, 2)) return;
        room.endRoundVotes.clear();
      }
      if (intent.type === 'advanceRound') {
        room.advanceRoundVotes.add(side);
        if (room.aiSide === 'both') { room.advanceRoundVotes.add('player1'); room.advanceRoundVotes.add('player2'); }
        else if (room.aiSide) room.advanceRoundVotes.add(room.aiSide);
        const connected = Object.values(room.sockets).filter(Boolean).length;
        broadcast(room, { type: 'advanceRoundVotes', votes: [...room.advanceRoundVotes] });
        if (room.advanceRoundVotes.size < Math.max(connected, 2)) return;
        room.advanceRoundVotes.clear();
      }
      const ASSET_PHASE_TRANSITIONS = ['startBattalionCombat'];
      if (ASSET_PHASE_TRANSITIONS.includes(intent.type)) {
        // Different transition types reset the vote (prevents cross-type vote accumulation).
        if (room.assetPhaseVotes._type !== intent.type) {
          room.assetPhaseVotes.clear();
          room.assetPhaseVotes._type = intent.type;
        }
        room.assetPhaseVotes.add(side);
        if (room.aiSide === 'both') { room.assetPhaseVotes.add('player1'); room.assetPhaseVotes.add('player2'); }
        else if (room.aiSide) room.assetPhaseVotes.add(room.aiSide);
        const connected = Object.values(room.sockets).filter(Boolean).length;
        broadcast(room, { type: 'assetPhaseVotes', votes: [...room.assetPhaseVotes], voteType: intent.type });
        if (room.assetPhaseVotes.size < Math.max(connected, 2)) return;
        room.assetPhaseVotes.clear();
        room.assetPhaseVotes._type = null;
      }
      apply(room.state, intent, room.rng);
      if (room.state.phase === 'play' && !room.playStartState) {
        room.playStartState    = structuredClone(room.state);
        room.playStartRngState = room.rng.getState();
      }
      if (room.playStartState) recordIntent(room, side, intent);
      saveRoom(room, userId).catch(err => console.error(`[${room.id}] save error:`, err.message));
      broadcast(room, { type: 'full', state: room.state });

      // AI solo mode: auto-ready the AI side immediately after the human readies.
      // apply() is called directly (no isLegal) since this is an authoritative server action.
      if (intent.type === 'readySetup' && room.aiSide &&
          room.state.phase === 'setup' &&
          room.state.setupReady?.[intent.side] &&
          !room.state.setupReady?.[room.aiSide]) {
        apply(room.state, { type: 'readySetup', side: room.aiSide }, room.rng);
        saveRoom(room, userId).catch(err => console.error(`[${room.id}] save error:`, err.message));
        broadcast(room, { type: 'full', state: room.state });
      }

      // Let the AI act if it's its turn (fire-and-forget — don't block the response).
      maybeAiTurn(room).catch(err => console.error(`[${room.id}] AI fire error:`, err.message));
      break;
    }

    case 'peerView': {
      broadcast(room, { type: 'peerView', peerView: msg.peerView }, ws);
      break;
    }

    case 'chat': {
      const text = (typeof msg.text === 'string') ? msg.text.trim().slice(0, 500) : '';
      if (!text) return;
      const username = side === 'spectator'
        ? (ws._spectatorUsername || 'Spectator')
        : (room.state.playerNames?.[side === 'player1' ? 'f1' : 'f2'] || side);
      const chatMsg = { side, username, text, ts: Date.now() };
      if (!room.chatHistory) room.chatHistory = [];
      room.chatHistory.push(chatMsg);
      if (room.chatHistory.length > 200) room.chatHistory.shift();
      broadcast(room, { type: 'chat', ...chatMsg });
      break;
    }

    default:
      send(ws, { type: 'error', reason: `Unknown message type: ${msg.type}` });
  }
}
