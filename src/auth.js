import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getUserByUsername, createUser } from './db.js';

export const authRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

authRouter.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !USERNAME_RE.test(username))
    return res.status(400).json({ error: 'Username must be 3–32 characters (letters, numbers, underscore).' });
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  if (getUserByUsername(username))
    return res.status(409).json({ error: 'Username already taken.' });

  const hash = await bcrypt.hash(password, 12);
  const id = createUser(username, hash);
  req.session.userId = id;
  res.json({ ok: true, username, userId: id, role: 'player', aiAccess: false });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });

  const user = getUserByUsername(username);
  const valid = user && await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return res.status(401).json({ error: 'Invalid credentials.' });

  req.session.userId = user.id;
  res.json({ ok: true, username: user.username, userId: user.id, role: user.role || 'player', aiAccess: !!user.ai_access });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

authRouter.get('/me', (req, res) => {
  if (req.user) {
    res.json({
      loggedIn:  true,
      username:  req.user.username,
      userId:    req.user.id,
      role:      req.user.role || 'player',
      aiAccess:  !!req.user.ai_access,
      createdAt: req.user.created_at * 1000,
    });
  } else {
    res.json({ loggedIn: false });
  }
});
