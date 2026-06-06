import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR  = process.env.DFC_DATA_DIR || join(__dirname, '..', 'data');
const DB_PATH = join(DB_DIR, 'dfc.db');

mkdirSync(DB_DIR, { recursive: true });

export const require = createRequire(import.meta.url);

let _db = null;

export function getDb() {
  if (!_db) throw new Error('DB not initialised — call initDb() first');
  return _db;
}

export function initDb() {
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS saves (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id               TEXT    NOT NULL UNIQUE,
      owner_user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
      player2_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      phase                 TEXT,
      round                 INTEGER,
      is_hotseat            INTEGER NOT NULL DEFAULT 0,
      seed                  INTEGER,
      player_names_json     TEXT,
      factions_json         TEXT,
      side_colors_json      TEXT,
      has_replay            INTEGER NOT NULL DEFAULT 0,
      app_version           TEXT,
      rulebook_version      TEXT,
      errata_version        TEXT,
      current_state_json    TEXT    NOT NULL,
      current_rng_state     INTEGER,
      play_start_state_json TEXT,
      play_start_rng_state  INTEGER,
      intent_log_json       TEXT,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      saved_at              INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_saves_owner ON saves(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_saves_room  ON saves(room_id);

    CREATE TABLE IF NOT EXISTS room_slots (
      room_id   TEXT    NOT NULL,
      side      TEXT    NOT NULL CHECK(side IN ('player1','player2')),
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (room_id, side)
    );
    CREATE INDEX IF NOT EXISTS idx_room_slots_room ON room_slots(room_id);
  `);

  // Migrations — each wrapped individually so an already-applied one doesn't block others.
  try { _db.exec(`ALTER TABLE saves ADD COLUMN player2_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`); } catch {}
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_saves_player2 ON saves(player2_user_id)`);
  try { _db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player'`); } catch {}
  try { _db.exec(`ALTER TABLE users ADD COLUMN ai_access INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { _db.exec(`ALTER TABLE saves ADD COLUMN is_ai INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { _db.exec(`ALTER TABLE saves ADD COLUMN game_over INTEGER NOT NULL DEFAULT 0`); } catch {}

  return _db;
}

// ── Users ────────────────────────────────────────────────────────────────────

export function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function createUser(username, passwordHash) {
  const info = getDb()
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, passwordHash);
  return info.lastInsertRowid;
}

export function getAllUsers() {
  return getDb().prepare('SELECT id, username, role, ai_access, created_at FROM users ORDER BY id').all();
}

export function setUserRole(userId, role) {
  getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
}

export function setUserAiAccess(userId, aiAccess) {
  getDb().prepare('UPDATE users SET ai_access = ? WHERE id = ?').run(aiAccess ? 1 : 0, userId);
}

export function setUserPassword(userId, passwordHash) {
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function deleteUser(userId) {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// ── Saves ─────────────────────────────────────────────────────────────────────

export function upsertSave(data, userId = null, player2UserId = null) {
  const db = getDb();
  const hasReplay = !!(data.playStartState || data.play_start_state_json);
  db.prepare(`
    INSERT INTO saves (
      room_id, owner_user_id, player2_user_id, phase, round, is_hotseat, is_ai, game_over, seed,
      player_names_json, factions_json, side_colors_json, has_replay,
      app_version, rulebook_version, errata_version,
      current_state_json, current_rng_state,
      play_start_state_json, play_start_rng_state, intent_log_json,
      updated_at, saved_at
    ) VALUES (
      @roomId, @ownerId, @player2Id, @phase, @round, @isHotseat, @isAi, @gameOver, @seed,
      @playerNamesJson, @factionsJson, @sideColorsJson, @hasReplay,
      @appVersion, @rulebookVersion, @errataVersion,
      @currentStateJson, @currentRngState,
      @playStartStateJson, @playStartRngState, @intentLogJson,
      unixepoch(), @savedAt
    )
    ON CONFLICT(room_id) DO UPDATE SET
      owner_user_id         = COALESCE(excluded.owner_user_id, owner_user_id),
      player2_user_id       = COALESCE(excluded.player2_user_id, player2_user_id),
      phase                 = excluded.phase,
      round                 = excluded.round,
      is_hotseat            = excluded.is_hotseat,
      is_ai                 = excluded.is_ai,
      game_over             = excluded.game_over,
      seed                  = excluded.seed,
      player_names_json     = excluded.player_names_json,
      factions_json         = excluded.factions_json,
      side_colors_json      = excluded.side_colors_json,
      has_replay            = excluded.has_replay,
      app_version           = excluded.app_version,
      rulebook_version      = excluded.rulebook_version,
      errata_version        = excluded.errata_version,
      current_state_json    = excluded.current_state_json,
      current_rng_state     = excluded.current_rng_state,
      play_start_state_json = excluded.play_start_state_json,
      play_start_rng_state  = excluded.play_start_rng_state,
      intent_log_json       = excluded.intent_log_json,
      updated_at            = unixepoch(),
      saved_at              = excluded.saved_at
  `).run({
    roomId:            data.roomId,
    ownerId:           userId,
    player2Id:         player2UserId,
    phase:             data.phase ?? null,
    round:             data.round ?? null,
    isHotseat:         data.isHotseat ? 1 : 0,
    isAi:              data.isAi     ? 1 : 0,
    gameOver:          data.gameOver ? 1 : 0,
    seed:              data.seed ?? null,
    playerNamesJson:   data.playerNames ? JSON.stringify(data.playerNames) : null,
    factionsJson:      data.factions    ? JSON.stringify(data.factions)    : null,
    sideColorsJson:    data.sideColors  ? JSON.stringify(data.sideColors)  : null,
    hasReplay:         hasReplay ? 1 : 0,
    appVersion:        data.appVersion       ?? null,
    rulebookVersion:   data.rulebookVersion  ?? null,
    errataVersion:     data.errataVersion    ?? null,
    currentStateJson:  JSON.stringify(data.currentState),
    currentRngState:   data.currentRngState  ?? null,
    playStartStateJson:  data.playStartState ? JSON.stringify(data.playStartState) : null,
    playStartRngState:   data.playStartRngState ?? null,
    intentLogJson:     data.intentLog ? JSON.stringify(data.intentLog) : null,
    savedAt:           data.savedAt ?? null,
  });
}

export function getSaveOwners(roomId) {
  return getDb()
    .prepare('SELECT owner_user_id, player2_user_id FROM saves WHERE room_id = ?')
    .get(roomId) ?? { owner_user_id: null, player2_user_id: null };
}

export function deleteSaveDb(roomId) {
  getDb().prepare('DELETE FROM saves WHERE room_id = ?').run(roomId);
}

export function getSaveByRoomId(roomId) {
  const row = getDb().prepare('SELECT * FROM saves WHERE room_id = ?').get(roomId);
  if (!row) return null;
  return _hydrateSave(row);
}

export function getAllSavesForUser(userId) {
  return getDb()
    .prepare('SELECT * FROM saves WHERE owner_user_id = ? OR player2_user_id = ? ORDER BY updated_at DESC')
    .all(userId, userId)
    .map(_hydrateSaveMetadata);
}

export function getAllSaves() {
  return getDb()
    .prepare('SELECT * FROM saves ORDER BY updated_at DESC')
    .all()
    .map(_hydrateSaveMetadata);
}

// Full hydration — parses all JSON blobs (for /api/saves/:id and replay endpoints)
function _hydrateSave(row) {
  return {
    roomId:            row.room_id,
    phase:             row.phase,
    round:             row.round,
    isHotseat:         !!row.is_hotseat,
    isAi:              !!row.is_ai,
    seed:              row.seed,
    playerNames:       _parseJson(row.player_names_json),
    factions:          _parseJson(row.factions_json),
    sideColors:        _parseJson(row.side_colors_json),
    hasReplay:         !!row.has_replay,
    appVersion:        row.app_version,
    rulebookVersion:   row.rulebook_version,
    errataVersion:     row.errata_version,
    currentState:      _parseJson(row.current_state_json),
    currentRngState:   row.current_rng_state,
    playStartState:    _parseJson(row.play_start_state_json),
    playStartRngState: row.play_start_rng_state,
    intentLog:         _parseJson(row.intent_log_json) ?? [],
    savedAt:           row.saved_at,
    createdAt:         row.created_at * 1000,
  };
}

// Metadata-only hydration — no JSON blob parsing (for the saves list)
function _hydrateSaveMetadata(row) {
  return {
    roomId:      row.room_id,
    phase:       row.phase,
    round:       row.round,
    isHotseat:   !!row.is_hotseat,
    isAi:        !!row.is_ai,
    gameOver:    !!row.game_over,
    savedAt:     row.saved_at,
    hasReplay:   !!row.has_replay,
    playerNames: _parseJson(row.player_names_json) ?? {},
    factions:    _parseJson(row.factions_json)     ?? {},
    sideColors:  _parseJson(row.side_colors_json)  ?? null,
  };
}

function _parseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

// ── Room slots ────────────────────────────────────────────────────────────────

export function getRoomSlot(roomId, side) {
  return getDb()
    .prepare('SELECT * FROM room_slots WHERE room_id = ? AND side = ?')
    .get(roomId, side);
}

export function setRoomSlot(roomId, side, userId) {
  getDb()
    .prepare(`
      INSERT INTO room_slots (room_id, side, user_id)
      VALUES (?, ?, ?)
      ON CONFLICT(room_id, side) DO UPDATE SET user_id = excluded.user_id, joined_at = unixepoch()
    `)
    .run(roomId, side, userId);
}

export function deleteRoomSlots(roomId) {
  getDb().prepare('DELETE FROM room_slots WHERE room_id = ?').run(roomId);
}
