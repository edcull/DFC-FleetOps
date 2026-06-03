# DFC Fleet Ops — Electron Desktop Distribution Plan

> **Status:** Proposed. Target: Windows `.exe` (NSIS installer + portable).
> Scope decided with maintainer:
> - **Full app** — embed the existing Express + WebSocket + SQLite server inside Electron.
> - **Internet play without port forwarding** — peer-hosting brokered by a small cloud **relay** (both machines dial outbound).
> - **AI** — runs in the embedded server using the user's **Anthropic API key**, entered in app config.
> - **Offline 3D** — Three.js vendored locally (no CDN).
> - **Platform** — Windows only (for now).

---

## 1. Why Electron fits

The app is already structured as **static ES-module client + optional Node server**:

- `client/index.html` is the entire UI; the engine (`src/engine/*`) runs identically in browser and Node.
- `server.js` is authoritative for online play (`isLegal` → `apply` → broadcast `full`), and also backs hotseat saves, replays, auth, and AI.

So the cleanest desktop model is **not** "load `file://` and rip the server out" — it's **embed the existing server in Electron's main process** and point the renderer at `http://127.0.0.1:<port>`. Nothing in the client has to change to keep hotseat / online / saves / replays / AI working. We only:

1. Make the server **embeddable** (export a `startServer()`; don't hardcode paths).
2. Relocate writable data to a per-user directory.
3. Vendor Three.js for offline use.
4. Add the **relay transport** for port-forward-free internet play.
5. Add a **Settings** surface for the Anthropic API key + relay URL + display name.

---

## 2. Process & runtime architecture

```
┌─────────────────────────── Electron app (Windows .exe) ───────────────────────────┐
│                                                                                    │
│  Main process (Node)                          Renderer (Chromium)                  │
│  ────────────────────                         ───────────────────                  │
│  • app config (userData/config.json)          • BrowserWindow →                    │
│  • sets DFC_DATA_DIR, AI_* env                   http://127.0.0.1:<port>           │
│  • startServer() ── embedded ──┐              • client/index.html (unchanged)       │
│      Express + ws + sqlite     │              • Three.js served locally             │
│      (authoritative engine)    │                                                    │
│  • preload (contextIsolated)   │                                                    │
│      exposes settings IPC      │                                                    │
└────────────────────────────────┼──────────────────────────────────────────────────┘
                                  │
              outbound WSS        │ outbound WSS
        ┌─────────────────────────▼───────────────────────────┐
        │             Cloud Relay (tiny, always-on)            │
        │   forwards opaque frames by room code; no game state │
        └──────────────────────────────────────────────────────┘
                                  ▲
                                  │ outbound WSS
                        Remote joiner's Electron app
```

- **Local / hotseat / AI / saves / replays:** renderer ↔ embedded localhost server. Zero network.
- **LAN play (optional):** joiner connects directly to `ws://<host-LAN-ip>:<port>/ws`.
- **Internet play (no port forwarding):** host and joiner both dial **outbound** to the relay; the relay pipes frames between them; the **host's embedded server remains authoritative**.

---

## 3. Internet play without port forwarding

### The constraint
A home "host" cannot accept inbound connections without port forwarding / UPnP. Any solution needs an **outbound-only** path for both peers. There is **no transport that traverses all NATs without some always-on cloud component** — even WebRTC falls back to a **TURN relay** for symmetric NATs (~10–20% of home networks). So a small relay is effectively required for *guaranteed* connectivity.

### Recommended: rendezvous **relay** (reuses all server logic)
A ~150-line stateless service (can live inside the already-deployed `server.js`, or stand alone):

- **Host** opens `wss://relay/host?room=CODE` (CODE = 6-char room code shown in the UI).
- **Joiner** opens `wss://relay/join?room=CODE`.
- Relay matches the pair by CODE and **pipes raw frames** in both directions. It never parses game messages, holds no state, and stores nothing.
- On the **host**, the relayed joiner socket is handed to the existing `handleConnection` exactly as if it were a direct WebSocket — `isLegal`/`apply`/broadcast are unchanged.

Properties: both peers dial outbound (no port forwarding); host is the true authority (real peer-hosting); cheap to run (no game compute, no DB); turn-based game ⇒ relay latency is irrelevant.

### Client changes for relay mode
- New online entry points: **Host over Internet** (registers CODE on relay, embedded server treats relayed peer as player2) and **Join over Internet** (enter CODE → dial relay).
- Transport seam is small: today the client builds `ws://${location.host}/ws?...` (`client/index.html:15222`). Add a relay branch that dials `wss://<relayUrl>/join?room=CODE` instead. The host side adds an outbound relay-registration socket in the embedded server that re-emits frames into `handleConnection`.

### Alternatives (documented, not chosen)
- **Central cloud server (MVP fallback):** deploy `server.js`; both desktops connect out to it. Trivial, but the cloud — not a peer — is the host.
- **WebRTC DataChannels (true P2P):** signaling server + STUN + TURN fallback. More moving parts and a transport rewrite for no practical benefit in a turn-based game. Keep as a future option only if eliminating the relay's bandwidth becomes a goal.

---

## 4. AI with a user-supplied Anthropic key

Today the AI is server-side and reads `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` from env at module load (`src/ai/llm.js:17`). In the desktop build the embedded server runs locally, so the LLM AI runs in-process using **the user's key**.

Work:
- **Settings UI** (in-app): provider (Anthropic), API key, model, "fallback-only" toggle. Persist to `userData/config.json`; optionally store the key in the OS credential vault (`keytar`) rather than plaintext.
- **Inject before use:** main process sets `AI_API_KEY` etc. from config before `startServer()`. Refactor `llm.js` to read the key **at call time** (function-local) instead of a module-load `const`, so changing it in Settings doesn't require an app restart, and `llmAvailable` is recomputed per request.
- **Default stays free:** the heuristic fallback AI (`src/ai/fallback.js`) needs no key and remains the default; LLM AI is opt-in once a key is present. Make it explicit in the UI that LLM games bill the user's own Anthropic account.

---

## 5. Offline Three.js (3D view)

Today: `<script type="importmap">` → jsdelivr (`client/index.html:1151`). For a desktop app the 3D view must work offline.

Plan:
- Add `three` as an npm dependency (pinned to the current `0.176.0`).
- Mount it from the embedded server: `app.use('/three', express.static(<three pkg dir>))`.
- Rewrite the importmap to local paths:
  ```json
  { "imports": {
      "three": "/three/build/three.module.js",
      "three/addons/": "/three/examples/jsm/"
  } }
  ```
- Served by the embedded localhost server ⇒ works fully offline, no `file://` module-resolution headaches.

---

## 6. Writable data directory

`src/db.js:8` hardcodes `src/data/dfc.db`; the session store (`server.js`) and saves write there too. In a packaged app the install dir is read-only.

Plan:
- Introduce `DFC_DATA_DIR` (env), default to the current path for `npm start`, set by Electron main to `app.getPath('userData')`.
- Route through it: `db.js` (sqlite), `connect-sqlite3` store `dir`, any save/replay file writes.
- `asarUnpack` the `better-sqlite3` native binding; DB lives in userData, never inside the asar.

---

## 7. Build tooling

- **electron-builder** (Windows): `nsis` (installer) + `portable` (single-file exe).
- **Native module:** `@electron/rebuild` (electron-builder runs it; rebuild `better-sqlite3` against Electron's ABI). Verify on a clean Windows runner.
- **Icon:** convert `favicon.svg` → `build/icon.ico`.
- **Hardening:** `contextIsolation: true`, `nodeIntegration: false`, minimal `preload` exposing only settings IPC; single-instance lock; load only `127.0.0.1`.
- **Optional:** `electron-updater` + a releases feed for auto-update; Windows **code-signing cert** to avoid SmartScreen/AV warnings on an unsigned exe (strongly recommended for distribution).

New layout:
```
electron/
  main.js        # config → env → startServer() → BrowserWindow(127.0.0.1:port)
  preload.js     # contextBridge: getConfig/setConfig (API key, relay URL, name)
build/
  icon.ico
server.js        # refactored: export startServer(); no side-effect listen on import
```

---

## 8. Phased delivery

**Phase 0 — Make the server embeddable (no behaviour change)**
- Export `startServer({ port? })` from `server.js`; pick a free port; return the actual port.
- `DFC_DATA_DIR` plumbing; vendor + mount Three; rewrite importmap.
- Refactor `llm.js` to read AI config at call time.
- ✅ Still runs identically via `npm start`. Tests unaffected.

**Phase 1 — Electron shell + Windows exe (local play)**
- `electron/main.js` + `preload.js`; embed server; load localhost.
- electron-builder config; rebuild `better-sqlite3`; produce installer + portable exe.
- ✅ Deliverable: a Windows exe with working **hotseat, AI (heuristic), saves, replays, offline 3D**.

**Phase 2 — Internet play without port forwarding**
- Relay service (standalone or folded into the deployed `server.js`): `/host` + `/join` by room code, frame piping.
- Client: **Host/Join over Internet** flows; embedded server accepts the relayed peer via `handleConnection`.
- ✅ Deliverable: two desktop apps on different networks play online, no port forwarding.

**Phase 3 — Settings, polish, distribution**
- Settings UI (Anthropic key, model, relay URL, display name); optional `keytar`.
- Bypass/auto-guest the login screen for desktop; icon; about/version.
- Optional `electron-updater` + code signing.
- ✅ Deliverable: signed, auto-updating installer; LLM AI enabled when a key is set.

---

## 9. Risks & open questions

| Risk | Mitigation |
| --- | --- |
| `better-sqlite3` ABI mismatch / asar packing | `@electron/rebuild` + `asarUnpack`; CI build on clean Windows. |
| Unsigned exe → SmartScreen/AV flags | Acquire a code-signing certificate (OV/EV). |
| Relay uptime/cost | Stateless, tiny; co-host with existing server; cheap VPS. |
| Anthropic key storage | `keytar` (OS vault) preferred over plaintext `config.json`. |
| App size (~150–250 MB, Chromium) | Expected for Electron; acceptable for a desktop title. |
| Login screen friction on desktop | Auto-guest local user; reserve accounts for online if desired. |

**Open questions for maintainer:**
1. Relay hosting — fold into the existing deployed server, or a separate tiny service? Who operates it?
2. Code signing — budget for an OV/EV cert, or ship unsigned initially (users click through SmartScreen)?
3. Online accounts — keep the auth/account system for internet play, or rely on room codes + display names only?
4. Auto-update — in scope now (`electron-updater` + release feed), or manual downloads to start?

---

## 10. Effort estimate (rough)

- Phase 0: ~0.5–1 day (mechanical refactors + Three vendoring).
- Phase 1: ~1–2 days (Electron shell, native rebuild, first Windows build).
- Phase 2: ~1–2 days (relay + client host/join flows + host-side relay acceptor).
- Phase 3: ~1–2 days (settings, signing, auto-update, polish).
