import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getAllUsers, getUserById, setUserRole, setUserAiAccess, setUserPassword, deleteUser, getAllSaves, getSaveByRoomId, deleteSaveDb } from './db.js';
import { getAllRooms } from './rooms.js';

export const adminRouter = Router();

// Guard: all admin routes require an authenticated admin.
adminRouter.use((req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
});

// GET /api/admin/users
adminRouter.get('/users', (_req, res) => {
  res.json(getAllUsers().map(u => ({ id: u.id, username: u.username, role: u.role, aiAccess: !!u.ai_access, createdAt: u.created_at * 1000 })));
});

// DELETE /api/admin/users/:id
adminRouter.delete('/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account.' });
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  deleteUser(id);
  res.json({ ok: true });
});

// PATCH /api/admin/users/:id/role
adminRouter.patch('/users/:id/role', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { role } = req.body || {};
  if (!['player', 'admin'].includes(role)) return res.status(400).json({ error: 'Role must be player or admin.' });
  if (!getUserById(id)) return res.status(404).json({ error: 'User not found.' });
  setUserRole(id, role);
  res.json({ ok: true });
});

// PATCH /api/admin/users/:id/ai-access
adminRouter.patch('/users/:id/ai-access', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { aiAccess } = req.body || {};
  if (!getUserById(id)) return res.status(404).json({ error: 'User not found.' });
  setUserAiAccess(id, aiAccess);
  res.json({ ok: true });
});

// POST /api/admin/users/:id/reset-password
adminRouter.post('/users/:id/reset-password', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!getUserById(id)) return res.status(404).json({ error: 'User not found.' });
  const hash = await bcrypt.hash(newPassword, 12);
  setUserPassword(id, hash);
  res.json({ ok: true });
});

// GET /api/admin/rooms — all live rooms
adminRouter.get('/rooms', (_req, res) => {
  const rooms = getAllRooms().map(r => ({
    id:          r.id,
    phase:       r.state?.phase ?? 'unknown',
    round:       r.state?.round ?? null,
    p1:          !!r.sockets?.player1,
    p2:          !!r.sockets?.player2,
    spectators:  r.spectators?.length ?? 0,
    lastActivity: r.lastActivity,
    createdAt:   r.createdAt,
  }));
  res.json(rooms);
});

// GET /api/admin/saves/:id/state — download game state JSON for any save
adminRouter.get('/saves/:id/state', (req, res) => {
  const roomId = req.params.id.toUpperCase();
  const save = getSaveByRoomId(roomId);
  if (!save) return res.status(404).json({ error: 'Save not found.' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="dfc-${roomId}-state.json"`);
  res.json(save.currentState ?? {});
});

// DELETE /api/admin/saves/:id — admin can delete any save
adminRouter.delete('/saves/:id', (req, res) => {
  const roomId = req.params.id.toUpperCase();
  try {
    deleteSaveDb(roomId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/saves — all saves
adminRouter.get('/saves', (_req, res) => {
  const saves = getAllSaves().map(s => ({
    roomId:      s.roomId,
    phase:       s.phase,
    round:       s.round,
    isHotseat:   s.isHotseat,
    savedAt:     s.savedAt,
    hasReplay:   s.hasReplay,
    playerNames: s.playerNames ?? {},
    factions:    s.factions    ?? {},
  }));
  res.json(saves);
});
