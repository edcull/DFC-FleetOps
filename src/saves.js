import { APP_VERSION, RULEBOOK_VERSION, ERRATA_VERSION } from './engine/version.js';
import { upsertSave, getSaveByRoomId, getAllSaves as dbGetAllSaves, getAllSavesForUser, getRoomSlot } from './db.js';

export async function saveRoom(room, userId = null) {
  if (room.state?.phase === 'setup') return;
  const slot1 = getRoomSlot(room.id, 'player1');
  const slot2 = getRoomSlot(room.id, 'player2');
  const ownerId   = room.creatorUserId ?? slot1?.user_id ?? userId;
  const player2Id = slot2?.user_id ?? null;

  const data = {
    appVersion:        APP_VERSION,
    rulebookVersion:   RULEBOOK_VERSION,
    errataVersion:     ERRATA_VERSION,
    roomId:            room.id,
    seed:              room.seed,
    createdAt:         room.createdAt,
    savedAt:           Date.now(),
    phase:             room.state.phase,
    round:             room.state.round,
    playerNames:       room.state.playerNames,
    factions:          room.state.factions,
    sideColors:        room.state.sideColors || null,
    isHotseat:         room.isHotseat || false,
    isAi:              !!room.aiSide,
    gameOver:          !!room.state.gameOver,
    playStartState:    room.playStartState,
    playStartRngState: room.playStartRngState,
    currentState:      structuredClone(room.state),
    currentRngState:   room.rng.getState(),
    intentLog:         room.intentLog,
  };
  try {
    upsertSave(data, ownerId, player2Id);
  } catch (err) {
    console.error(`[${room.id}] SQLite save error:`, err.message);
  }
}

export async function loadSave(roomId) {
  const row = getSaveByRoomId(roomId.toUpperCase());
  if (row) return row;
  throw new Error(`Save not found: ${roomId}`);
}

export async function loadAllSaves(userId = null) {
  return userId ? getAllSavesForUser(userId) : dbGetAllSaves();
}
