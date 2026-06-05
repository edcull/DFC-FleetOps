// REST routes and WebSocket connection handler.

import { Router } from 'express';
import { createRoom, getRoom, getAllRooms, joinRoom, leaveRoom, broadcast, send, recordIntent } from './rooms.js';
import { isLegal } from './engine/gating.js';
import { apply } from './engine/mutators.js';
import { saveRoom, loadSave, loadAllSaves } from './saves.js';
import { APP_VERSION, RULEBOOK_VERSION, ERRATA_VERSION } from './engine/version.js';
import { getRoomSlot, setRoomSlot, getSaveOwners, deleteSaveDb } from './db.js';
import { triggerAi, shouldAiAct } from './ai/index.js';
import { buildAiFleet } from './ai/fleet-builder.js';

export const router = Router();

// GET /api/meta — app and ruleset version info.
router.get('/meta', (_req, res) => {
  res.json({ appVersion: APP_VERSION, rulebookVersion: RULEBOOK_VERSION, errataVersion: ERRATA_VERSION });
});

// POST /api/rooms — create a new room, return its code.
// Accepts optional body { aiOpponent, aiSide, aiPersonality, aiFaction, aiSecondaries }
// for solo-vs-AI rooms (Phase A stub — full fleet-builder not yet implemented).
router.post('/rooms', (req, res) => {
  const room = createRoom();
  console.log(`Room ${room.id} created (seed ${room.seed})`);
  if (req.user) {
    room.creatorUserId = req.user.id;
    setRoomSlot(room.id, 'player1', req.user.id);
  }

  const { aiOpponent, aiSide, aiPersonality, aiFaction, aiSecondaries } = req.body || {};
  if (aiOpponent) {
    const side = aiSide === 'player1' ? 'player1' : 'player2';
    const slot = side === 'player1' ? 'f1' : 'f2';
    room.aiSide        = side;
    room.aiPersonality = aiPersonality || 'balanced';
    room.state.aiSide  = side; // persisted in state JSON for resume

    const PERSONALITY_LABELS = { aggressive:'Aggressive', positional:'Positional', defensive:'Defensive', balanced:'Balanced', opportunist:'Opportunist' };
    room.state.aiOpponent   = true;
    room.state.aiPersonality = room.aiPersonality;
    room.state.fleetChoices[slot]    = aiFaction || null;
    room.state.secondaryChoice[slot] = Array.isArray(aiSecondaries) ? aiSecondaries.slice(0, 2) : [];
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
      }
    }
    console.log(`Room ${room.id} — AI on ${side} (${room.aiPersonality}, ${aiFaction || 'no faction'})`);
  }

  const { allowSpectators } = req.body || {};
  if (allowSpectators === false) room.allowSpectators = false;

  res.json({ roomId: room.id, seed: room.seed });
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
  if (!shouldAiAct(room.state, room.aiSide)) return;
  room.aiPending = true;
  broadcast(room, { type: 'aiThinking', thinking: true });
  console.log(`[${room.id}] AI turn — phase:${room.state.phase} activeSide:${room.state.activeSide}`);
  try {
    let guard = 200; // planning(2) + deploy(N ships) + activations(N groups) + sub-phases
    while (shouldAiAct(room.state, room.aiSide) && guard-- > 0) {
      await triggerAi(room, (intent) => {
        if (room.playStartState) recordIntent(room, room.aiSide, intent);
      });
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
        if (room.aiSide) room.endRoundVotes.add(room.aiSide);
        const connected = Object.values(room.sockets).filter(Boolean).length;
        broadcast(room, { type: 'endRoundVotes', votes: [...room.endRoundVotes] });
        if (room.endRoundVotes.size < Math.max(connected, 2)) return;
        room.endRoundVotes.clear();
      }
      if (intent.type === 'advanceRound') {
        room.advanceRoundVotes.add(side);
        if (room.aiSide) room.advanceRoundVotes.add(room.aiSide);
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
        if (room.aiSide) room.assetPhaseVotes.add(room.aiSide);
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
