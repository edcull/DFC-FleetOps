import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock db layer ─────────────────────────────────────────────────────────────

const mockUpsertSave      = vi.fn();
const mockGetSaveByRoomId = vi.fn();
const mockGetAllSaves     = vi.fn();
const mockGetAllSavesForUser = vi.fn();
const mockGetRoomSlot     = vi.fn();

vi.mock('../../src/db.js', () => ({
  upsertSave:         (...a) => mockUpsertSave(...a),
  getSaveByRoomId:    (...a) => mockGetSaveByRoomId(...a),
  getAllSaves:         (...a) => mockGetAllSaves(...a),
  getAllSavesForUser:  (...a) => mockGetAllSavesForUser(...a),
  getRoomSlot:        (...a) => mockGetRoomSlot(...a),
}));

const { saveRoom, loadSave, loadAllSaves } = await import('../../src/saves.js');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRoom(overrides = {}) {
  return {
    id: 'ABCD',
    seed: 42,
    createdAt: 1000000,
    creatorUserId: null,
    isHotseat: false,
    aiSide: null,
    playStartState: null,
    playStartRngState: null,
    intentLog: [],
    rng: { getState: () => 99 },
    state: {
      phase: 'play',
      round: 2,
      playerNames: { player1: 'Alice', player2: 'Bob' },
      factions: { player1: 'ucm', player2: 'scourge' },
      sideColors: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRoomSlot.mockReturnValue(null);
});

// ── saveRoom ──────────────────────────────────────────────────────────────────

describe('saveRoom', () => {
  it('does nothing when phase is setup', async () => {
    const room = makeRoom({ state: { phase: 'setup' } });
    await saveRoom(room);
    expect(mockUpsertSave).not.toHaveBeenCalled();
  });

  it('calls upsertSave with structured data for a play-phase room', async () => {
    const room = makeRoom();
    await saveRoom(room);
    expect(mockUpsertSave).toHaveBeenCalledOnce();
    const [data] = mockUpsertSave.mock.calls[0];
    expect(data.roomId).toBe('ABCD');
    expect(data.phase).toBe('play');
    expect(data.round).toBe(2);
    expect(data.isHotseat).toBe(false);
    expect(data.isAi).toBe(false);
  });

  it('sets isAi=true when room.aiSide is set', async () => {
    const room = makeRoom({ aiSide: 'player2' });
    await saveRoom(room);
    const [data] = mockUpsertSave.mock.calls[0];
    expect(data.isAi).toBe(true);
  });

  it('resolves ownerId from creatorUserId first', async () => {
    const room = makeRoom({ creatorUserId: 7 });
    mockGetRoomSlot.mockReturnValueOnce({ user_id: 99 }); // slot1 — should not win
    await saveRoom(room);
    const [, ownerId] = mockUpsertSave.mock.calls[0];
    expect(ownerId).toBe(7);
  });

  it('falls back to slot1 user_id when creatorUserId is null', async () => {
    const room = makeRoom({ creatorUserId: null });
    mockGetRoomSlot
      .mockReturnValueOnce({ user_id: 5 })  // slot1
      .mockReturnValueOnce(null);            // slot2
    await saveRoom(room);
    const [, ownerId] = mockUpsertSave.mock.calls[0];
    expect(ownerId).toBe(5);
  });

  it('falls back to the userId argument when both creatorUserId and slot1 are null', async () => {
    const room = makeRoom({ creatorUserId: null });
    await saveRoom(room, 42);
    const [, ownerId] = mockUpsertSave.mock.calls[0];
    expect(ownerId).toBe(42);
  });

  it('passes player2_user_id from slot2', async () => {
    const room = makeRoom();
    mockGetRoomSlot
      .mockReturnValueOnce(null)            // slot1
      .mockReturnValueOnce({ user_id: 8 }); // slot2
    await saveRoom(room);
    const [, , player2Id] = mockUpsertSave.mock.calls[0];
    expect(player2Id).toBe(8);
  });

  it('does not throw if upsertSave throws — logs the error', async () => {
    const room = makeRoom();
    mockUpsertSave.mockImplementation(() => { throw new Error('db gone'); });
    await expect(saveRoom(room)).resolves.toBeUndefined();
  });
});

// ── loadSave ──────────────────────────────────────────────────────────────────

describe('loadSave', () => {
  it('returns the row when found', async () => {
    const row = { roomId: 'ABCD', phase: 'play' };
    mockGetSaveByRoomId.mockReturnValue(row);
    await expect(loadSave('ABCD')).resolves.toBe(row);
  });

  it('uppercases the room ID before querying', async () => {
    mockGetSaveByRoomId.mockReturnValue({ roomId: 'ABCD' });
    await loadSave('abcd');
    expect(mockGetSaveByRoomId).toHaveBeenCalledWith('ABCD');
  });

  it('throws when the save is not found', async () => {
    mockGetSaveByRoomId.mockReturnValue(null);
    await expect(loadSave('ZZZZ')).rejects.toThrow('Save not found');
  });
});

// ── loadAllSaves ──────────────────────────────────────────────────────────────

describe('loadAllSaves', () => {
  it('calls getAllSavesForUser when a userId is supplied', async () => {
    mockGetAllSavesForUser.mockReturnValue([]);
    await loadAllSaves(3);
    expect(mockGetAllSavesForUser).toHaveBeenCalledWith(3);
    expect(mockGetAllSaves).not.toHaveBeenCalled();
  });

  it('calls getAllSaves when no userId is supplied', async () => {
    mockGetAllSaves.mockReturnValue([]);
    await loadAllSaves();
    expect(mockGetAllSaves).toHaveBeenCalled();
    expect(mockGetAllSavesForUser).not.toHaveBeenCalled();
  });
});
