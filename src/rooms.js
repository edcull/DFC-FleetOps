// Room lifecycle. Rooms live in memory; games are persisted to saves/ for resume/replay.
// Each room holds the authoritative game state and two player WebSocket slots.

import { createState, rebuildFleets } from './engine/state.js';
import { makeRng } from './engine/rng.js';
import { deleteSaveDb } from './db.js';

const ROOM_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours of inactivity
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit 0/O/1/I

const rooms = new Map();

function randomId(len = 4) {
  let id = '';
  for (let i = 0; i < len; i++) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return id;
}

export function createRoom(forceId = null) {
  let id;
  if (forceId) {
    id = forceId.toUpperCase();
  } else {
    do { id = randomId(); } while (rooms.has(id));
  }

  const seed = Math.floor(Math.random() * 0xFFFFFFFF);
  const state = createState();
  rebuildFleets(state);

  const room = {
    id,
    seed,
    rng: makeRng(seed),
    state,
    sockets: { player1: null, player2: null },
    spectators: [],
    lastActivity: Date.now(),
    endRoundVotes: new Set(),
    advanceRoundVotes: new Set(),
    assetPhaseVotes: new Set(),      // tracks ready votes for asset-phase step transitions
    createdAt: Date.now(),
    intentLog: [],          // [{ts, side, intent}] — play phase only
    playStartState: null,   // deep clone of state the moment beginPlay is applied
    playStartRngState: null,
    creatorUserId: null,    // set by POST /api/rooms for save attribution
    chatHistory: [],        // [{side, username, text, ts}] — ephemeral, capped at 200
    aiSide: null,           // 'player1' | 'player2' | null — slot occupied by the AI
    aiPersonality: null,    // personality key ('balanced', 'aggressive', etc.)
    aiUseLlm: false,        // true = use LLM for decisions (requires llmAvailable on server)
    aiPending: false,       // guard against concurrent AI triggers
    allowSpectators: true,  // host can disable spectating
  };

  rooms.set(id, room);
  scheduleExpiry(id);
  return room;
}

export function getRoom(id) {
  return rooms.get(id) || null;
}

export function getAllRooms() {
  return [...rooms.values()];
}

// Returns { ok: true } or { error: string }.
export function joinRoom(room, side, ws) {
  if (side !== 'player1' && side !== 'player2') return { error: 'Invalid side — use player1 or player2.' };
  const existing = room.sockets[side];
  if (existing && existing.readyState === 1 /* OPEN */) {
    return { error: `Side ${side} is already connected.` };
  }
  room.sockets[side] = ws;
  room.lastActivity = Date.now();
  return { ok: true };
}

export function leaveRoom(room, ws) {
  for (const side of ['player1', 'player2']) {
    if (room.sockets[side] === ws) room.sockets[side] = null;
  }
  room.spectators = room.spectators.filter(s => s !== ws);
}

// Returns the side ('player1' | 'player2' | 'spectator') this ws is connected as.
export function sideOf(room, ws) {
  if (room.sockets.player1 === ws) return 'player1';
  if (room.sockets.player2 === ws) return 'player2';
  return 'spectator';
}

// Broadcast a message to all room participants, optionally excluding one socket.
export function broadcast(room, msg, exclude = null) {
  const data = JSON.stringify(msg);
  for (const side of ['player1', 'player2']) {
    const ws = room.sockets[side];
    if (ws && ws !== exclude && ws.readyState === 1) ws.send(data);
  }
  for (const ws of room.spectators) {
    if (ws !== exclude && ws.readyState === 1) ws.send(data);
  }
}

// Send a message to a single socket.
export function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

export function recordIntent(room, side, intent) {
  room.intentLog.push({ ts: Date.now(), side, intent });
}

function scheduleExpiry(id) {
  setTimeout(() => {
    const room = rooms.get(id);
    if (!room) return;
    if (Date.now() - room.lastActivity < ROOM_TTL_MS) {
      scheduleExpiry(id); // still active — check again later
      return;
    }
    for (const side of ['player1', 'player2']) {
      if (room.sockets[side]) try { room.sockets[side].close(); } catch {}
    }
    for (const ws of room.spectators) try { ws.close(); } catch {}
    rooms.delete(id);
    deleteSaveDb(id);
    console.log(`Room ${id} expired and removed.`);
  }, ROOM_TTL_MS).unref();
}
