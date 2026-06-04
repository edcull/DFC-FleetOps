import { describe, it, expect, beforeEach, vi } from 'vitest';

// deleteSaveDb is called by scheduleExpiry; stub it so tests don't need a real DB.
vi.mock('../../src/db.js', () => ({ deleteSaveDb: vi.fn() }));

// Import after mock is registered.
const {
  createRoom, getRoom, getAllRooms,
  joinRoom, leaveRoom, sideOf,
  broadcast, send, recordIntent,
} = await import('../../src/rooms.js');

// ── helpers ──────────────────────────────────────────────────────────────────

let _idSeq = 0;
function uid() { return `T${String(++_idSeq).padStart(3, '0')}`; }

function mockWs(readyState = 1 /* OPEN */) {
  return { readyState, send: vi.fn(), close: vi.fn() };
}

// ── createRoom / getRoom / getAllRooms ────────────────────────────────────────

describe('createRoom', () => {
  it('returns a room with the expected shape', () => {
    const room = createRoom(uid());
    expect(room.id).toBeTruthy();
    expect(room.state).toBeDefined();
    expect(room.sockets).toEqual({ player1: null, player2: null });
    expect(room.spectators).toEqual([]);
    expect(Array.isArray(room.intentLog)).toBe(true);
    expect(room.aiSide).toBeNull();
  });

  it('uppercases a forced ID', () => {
    const room = createRoom('abc');
    expect(room.id).toBe('ABC');
  });

  it('stores the room so getRoom can retrieve it', () => {
    const id = uid();
    const room = createRoom(id);
    expect(getRoom(id)).toBe(room);
  });

  it('getRoom returns null for an unknown ID', () => {
    expect(getRoom('XXXX')).toBeNull();
  });

  it('getAllRooms includes rooms that were created', () => {
    const id = uid();
    createRoom(id);
    const all = getAllRooms();
    expect(all.some(r => r.id === id)).toBe(true);
  });
});

// ── joinRoom ──────────────────────────────────────────────────────────────────

describe('joinRoom', () => {
  it('accepts a valid side and stores the socket', () => {
    const room = createRoom(uid());
    const ws = mockWs();
    const result = joinRoom(room, 'player1', ws);
    expect(result).toEqual({ ok: true });
    expect(room.sockets.player1).toBe(ws);
  });

  it('rejects an invalid side', () => {
    const room = createRoom(uid());
    const result = joinRoom(room, 'spectator', mockWs());
    expect(result.error).toBeTruthy();
  });

  it('rejects if the slot is already occupied by an OPEN socket', () => {
    const room = createRoom(uid());
    joinRoom(room, 'player1', mockWs(1));
    const result = joinRoom(room, 'player1', mockWs(1));
    expect(result.error).toMatch(/already connected/i);
  });

  it('allows takeover if existing socket is not OPEN (readyState !== 1)', () => {
    const room = createRoom(uid());
    joinRoom(room, 'player1', mockWs(3 /* CLOSED */));
    const ws2 = mockWs();
    const result = joinRoom(room, 'player1', ws2);
    expect(result).toEqual({ ok: true });
    expect(room.sockets.player1).toBe(ws2);
  });

  it('updates lastActivity on join', () => {
    const room = createRoom(uid());
    const before = room.lastActivity;
    joinRoom(room, 'player2', mockWs());
    expect(room.lastActivity).toBeGreaterThanOrEqual(before);
  });
});

// ── leaveRoom ─────────────────────────────────────────────────────────────────

describe('leaveRoom', () => {
  it('clears the socket slot when player leaves', () => {
    const room = createRoom(uid());
    const ws = mockWs();
    joinRoom(room, 'player1', ws);
    leaveRoom(room, ws);
    expect(room.sockets.player1).toBeNull();
  });

  it('removes a spectator from the spectators list', () => {
    const room = createRoom(uid());
    const ws = mockWs();
    room.spectators.push(ws);
    leaveRoom(room, ws);
    expect(room.spectators).not.toContain(ws);
  });

  it('is a no-op for a socket that was never in the room', () => {
    const room = createRoom(uid());
    expect(() => leaveRoom(room, mockWs())).not.toThrow();
  });
});

// ── sideOf ────────────────────────────────────────────────────────────────────

describe('sideOf', () => {
  it('returns player1 for the player1 socket', () => {
    const room = createRoom(uid());
    const ws = mockWs();
    joinRoom(room, 'player1', ws);
    expect(sideOf(room, ws)).toBe('player1');
  });

  it('returns player2 for the player2 socket', () => {
    const room = createRoom(uid());
    const ws = mockWs();
    joinRoom(room, 'player2', ws);
    expect(sideOf(room, ws)).toBe('player2');
  });

  it('returns spectator for an unknown socket', () => {
    const room = createRoom(uid());
    expect(sideOf(room, mockWs())).toBe('spectator');
  });
});

// ── broadcast ─────────────────────────────────────────────────────────────────

describe('broadcast', () => {
  it('sends to both player sockets', () => {
    const room = createRoom(uid());
    const ws1 = mockWs(); const ws2 = mockWs();
    joinRoom(room, 'player1', ws1); joinRoom(room, 'player2', ws2);
    broadcast(room, { type: 'ping' });
    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
  });

  it('excludes the specified socket', () => {
    const room = createRoom(uid());
    const ws1 = mockWs(); const ws2 = mockWs();
    joinRoom(room, 'player1', ws1); joinRoom(room, 'player2', ws2);
    broadcast(room, { type: 'ping' }, ws1);
    expect(ws1.send).not.toHaveBeenCalled();
    expect(ws2.send).toHaveBeenCalled();
  });

  it('does not send to a non-OPEN player socket', () => {
    const room = createRoom(uid());
    const ws = mockWs(3 /* CLOSED */);
    room.sockets.player1 = ws;
    broadcast(room, { type: 'ping' });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('sends to spectators', () => {
    const room = createRoom(uid());
    const ws = mockWs();
    room.spectators.push(ws);
    broadcast(room, { type: 'ping' });
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
  });
});

// ── send ──────────────────────────────────────────────────────────────────────

describe('send', () => {
  it('sends to an open socket', () => {
    const ws = mockWs();
    send(ws, { type: 'hello' });
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'hello' }));
  });

  it('does not send to a closed socket', () => {
    const ws = mockWs(3);
    send(ws, { type: 'hello' });
    expect(ws.send).not.toHaveBeenCalled();
  });
});

// ── recordIntent ──────────────────────────────────────────────────────────────

describe('recordIntent', () => {
  it('appends an entry to intentLog', () => {
    const room = createRoom(uid());
    const intent = { type: 'move', shipId: 's1' };
    recordIntent(room, 'player1', intent);
    expect(room.intentLog).toHaveLength(1);
    expect(room.intentLog[0].side).toBe('player1');
    expect(room.intentLog[0].intent).toBe(intent);
    expect(typeof room.intentLog[0].ts).toBe('number');
  });

  it('accumulates multiple entries in order', () => {
    const room = createRoom(uid());
    recordIntent(room, 'player1', { type: 'a' });
    recordIntent(room, 'player2', { type: 'b' });
    expect(room.intentLog).toHaveLength(2);
    expect(room.intentLog[1].side).toBe('player2');
  });
});
