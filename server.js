import 'dotenv/config';
// DFC Fleet Ops — server entry point.
// Serves static files, REST API, and WebSocket rooms.
//
// Usage:
//   node server.js            (production)
//   node --watch server.js    (dev — auto-restart on file changes)
//
// Then open: http://localhost:3000

import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';
import express from 'express';
import session from 'express-session';
import { WebSocketServer } from 'ws';
import { router as apiRouter, handleConnection } from './src/api.js';
import { initDb, getUserById } from './src/db.js';
import { authRouter } from './src/auth.js';
import { adminRouter } from './src/admin.js';
import { APP_VERSION, RULEBOOK_VERSION, ERRATA_VERSION } from './src/engine/version.js';

const require = createRequire(import.meta.url);
const ConnectSqlite3 = require('connect-sqlite3')(session);

const PORT = parseInt(process.env.PORT || '3000', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me-in-production') {
  console.warn('[auth] WARNING: SESSION_SECRET is not set. Set it in production via the SESSION_SECRET environment variable.');
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.set('trust proxy', 1); // trust nginx X-Forwarded-Proto for secure cookies
app.use(express.json());

// Session middleware — extracted to a named variable so it can also be used
// in the WebSocket upgrade handler below (Express middleware does not run there).
const sessionMiddleware = session({
  store: new ConnectSqlite3({ db: 'sessions.db', dir: process.env.DFC_DATA_DIR || './data' }),
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000, // 12 hours
  },
});
app.use(sessionMiddleware);

// Auth middleware — sets req.user from the session on every /api request.
app.use('/api', (req, _res, next) => {
  req.user = req.session?.userId ? (getUserById(req.session.userId) ?? null) : null;
  next();
});

// Auth routes (/api/auth/register, /api/auth/login, …)
app.use('/api/auth', authRouter);

// Admin routes (/api/admin/users, /api/admin/rooms, /api/admin/saves)
app.use('/api/admin', adminRouter);

// REST API
app.use('/api', apiRouter);

// Serve everything from the repo root as static files so the browser can load:
//   /client/index.html        — module-based client
//   /src/engine/constants.js  — ES modules imported by the client
app.use(express.static(__dirname));

// Redirect bare /client → /client/index.html
app.get('/client', (_req, res) => res.redirect('/client/index.html'));

// Redirect root → /client/index.html
app.get('/', (_req, res) => res.redirect('/client/index.html'));

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

// Upgrade HTTP → WebSocket only for /ws paths.
// Run the session middleware first so req.session (and req.user) are populated
// for the connection handler — Express middleware does not run on upgrades.
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  sessionMiddleware(req, {}, () => {
    req.user = req.session?.userId ? (getUserById(req.session.userId) ?? null) : null;
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
});

wss.on('connection', handleConnection);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

initDb();

server.listen(PORT, () => {
  console.log(`DFC Fleet Ops v${APP_VERSION}  |  Rulebook v${RULEBOOK_VERSION}  |  Errata v${ERRATA_VERSION}`);
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`  Client : http://localhost:${PORT}`);
  console.log(`  API    : http://localhost:${PORT}/api/rooms`);
});
