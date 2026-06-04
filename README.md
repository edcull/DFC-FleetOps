# DFC Fleet Ops

**App v0.3.0** &nbsp;·&nbsp; Rulebook v2.3.1 &nbsp;·&nbsp; Errata v1.3

A browser-based tactical assistant for **Dropfleet Commander**. The client (`client/index.html`) requires a small static server to load ES modules; an optional Node.js server adds online two-player rooms.

---

## What it is

An interactive 48"×48" virtual battlemat that implements the full DFC rules engine. It handles the fiddly parts of the game — tracking hull, spikes, crippling effects, weapon arcs, AP, VP, asset launches, battalion landing, and all the rules interactions — so players can focus on tactics rather than administration.

Designed for **two player hotseat**, and **full online two-player** support via the Node server. 

---

## Quick start

1. **Hotseat:** serve the repo root with any static server (e.g. `python -m http.server`) and open `client/index.html`. **Online play:** run `npm install && npm start` and open `http://localhost:3000/client/index.html`.
2. **Setup** — choose factions, admirals, secondary objectives for each side, then either pick a **standard scenario** (or roll a random one) or build a custom one from deployment/approach/layout/variant/scoring objective.
3. **Scenery** — place or randomise scenery objects. The 3D view activates automatically when scenery is complete.
4. **Deploy** — click a group in the left panel, then click in your deployment zone to place each ship. Move the mouse and click again to set facing, then hit **✓ CONFIRM PLACEMENT**. Multi-ship groups prompt for each ship in turn. Use **↩ UNDO DEPLOY** in the board HUD to return a whole group off-table.
5. **Play** — activate groups, move ships, assign weapon targets, fire, launch assets, and score VP. Click **FINISH ACTIVATION** after each group.

---

## Accounts & authentication

The Node server supports optional user accounts. On first load the client checks `/api/auth/me` — if you're not logged in, a login/register screen appears before the mode selector. You can dismiss it to play anonymously.

- **Register** — pick a username (3–32 chars, letters/numbers/underscore) and a password (8+ chars).
- **Login / logout** — sessions last 12 hours; the active username appears in the top-right of the screen.
- **Save ownership** — rooms you create or resume are linked to your account; your saves list (`↩ SAVED GAMES`) shows only your own games.
- **Admin panel** — users with the `admin` role can manage users and saves via `/api/admin/*`.

---

## Save, resume, and replay

Online games (Node server) are **auto-saved** to SQLite (`data/dfc.db`) after every action, with a JSON file backup in `saves/<ROOM_ID>.json`. The mode selector (shown on first load) provides:

- **↩ SAVED GAMES** — opens a list of all saves. Each entry shows the round and save time with two actions:
  - **▶ RESUME** — creates a live room from the save (preserving the original room code), shows a side picker with coloured player buttons and an opponent share link, then connects you as the chosen player.
  - **↺ REPLAY** — loads the full intent history and replays it step-by-step. Greyed out if the save pre-dates intent logging. While replaying, the URL updates to `?replay=<ROOM_ID>` and a control bar (◀ PREV / ▶ NEXT / RND ⟩⟩ / ▶ PLAY) appears at the top. **✕ EXIT REPLAY** returns to the mode selector.

Saves contain:
- `currentState` / `currentRngState` — full game snapshot used for resume
- `playStartState` / `playStartRngState` — snapshot at the moment play began, used as the replay starting point
- `intentLog` — ordered list of every server-authoritative action taken during play

---

## Factions

Six factions are fully modelled with correct stats, weapons, specials, and launch profiles. A full ship and weapon database (`src/fleet/db.js`) covers all published ships from all factions for the New Recruit import format.

| Faction | Ships |
|---------|-------|
| **UCM** | Full roster including all Frigates, Cruisers, Heavy Cruisers, Battlecruiser, Carriers, Destroyers, Monitors, and more |
| **Shaltari** | Full roster including Gates, Mothership, Carriers, Cruisers, Frigates |
| **PHR** | Full roster |
| **Resistance** | Full roster |
| **Scourge** | Full roster |
| **Bioficer** | Full Bioficer roster with Payload/Porter mechanics |

---

## Rules implemented

### Core game loop
- Full six-phase round structure (Planning → Activation → Dropsite → Asset → Repair → End)
- All six **Orders**: General Quarters, Silent Running, Weapons Free, Course Change, Max Thrust, Damage Control
- Alternating activation with Pass Tokens
- Initiative roll (Admiral bonus, reversal, tiebreak)
- Coherency and formation benefits (incl. 4+ two-neighbour cluster rule)
- Layer movement (Orbit ↔ Atmosphere), Descent/Ascent costs

### Movement
- Full legal-move cone per order (min/max range, turn limits)
- Vectored thrust (pivot then second move)
- Course Change bonus turn after movement
- Movement-before-firing enforced — group must complete all movement before any ship fires, launches, or uses Detector
- **Hold Position** (CC/DC only) — mark moved-in-place without relocating
- **Undo Move** — reverts last move; disabled once a ship has fired/launched/detected
- Lead-ship measurement — all weapon arcs, range, and scenery effects for group fire measure from the lead ship

### Combat
- Full **attack modal**: hit rolls, critical hits, shield saves (ES/KS/BS), backup saves, Aegis-X, Close Protection (fighter re-rolls), two-phase save/backup sequence
- All weapon specials: Fusillade (per-ship, group fire correctly sums), Volley, Overcharge, Sustained Fire, High/Low Power, Linked, Alt, Limited, Calibre, Mauler, Penetrator, Flash, Bloom, Burnthrough, Scald, Reave, Critical, Arrest, Impel (turn or move choice), Anti-Wing, Crippling-Fire, Saturation
- **Crippling Effects** — abilities declared *before* 2D6 roll; Brace for Impact sets result to 4
- **Explosion AoE** — blast-radius aura shown on map; abilities declared before 1D6 roll; Contain Reactor sets result to 2; all ships on the same layer within range are hit (friend and foe)
- Close Action range uses firer's scan only (target signature/spikes give no extra reach)
- Dropsite feature weapons (Missile Halo, Orbital Defence Gun) fully playable with targeting, arc checks, and right-click cancel

### Ship specials (§15)
Shield-X, Reinforced Armour, Cloak-X, Command Ship-X, Regenerate-X, Stealth, Escort (hit redirect), Detector, Aegis-X, Monitor, Vanguard, Gateship/Mothership (Voidgate BFS network), Open Network (individual orders), Payload/Porter

### Assets
- Fighters, Bombers, Fire Ships, Torpedoes, Mines, Drop Pods, Dropships, Bulk Landers, Boarding Pods, Gate Dropships (Shaltari Voidgate teleport)
- Full asset combat phase (dogfights, bomber/torpedo/fire ship attacks, Close Protection)
- **Time to Target** ability (2 AP — second 6" move for fighters/bombers)
- Ground asset launch exhaustion — each ship can only launch once per activation
- Shaltari **Extract** — per-ship transport-value-limited extraction from Dropsites; carried count shown as ⬆N on ship markers

### Scoring
- **Standard** — control/contest at Rounds 4 & 6, with a per-Dropsite breakdown modal
- **Attrition** — +2 VP / 500 Kill Points at game end
- **Survey** — +1 VP per surveyed Dropsite at game end
- **Extract** — 2 VP per operative aboard a surviving ship; +1 VP per operative-carrier destroyed
- **Protect** — nominated Dropsite scores double while intact; penalty if Levelled; 🛡 marker on map
- **Breakthrough** — Red flies off for 1 VP/200 pts; Blue scores pts-destroyed
- **Raze** — double standard scoring for Levelled/Ruined Dropsites ≥24" from own zone; pts-destroyed
- **Asymmetric scoring** — each side can score against its own objective (e.g. attacker Raze / defender Protect), resolved per-side throughout
- All seven **secondary objectives** with manual nomination and ★ markers
- VP toasts on every award; clicking the faction/VP topbar display opens full breakdown with objective description, Kill Points projection, Assess tracker, and live Focal Points values

**Scenario Expansion 1 scoring (all engine-scored):**
- **Normal** — identical VP table to Standard Scoring (Small 2/0, Medium 3/1, Large 4/2 for Control/Contest), scored on R4 & R6
- **Demolish** — immediate High VP when you Level a Dropsite (2/3/4 by size), immediate Low VP when you Ruin it (0/1/2); no R4/R6 dropsite scoring. Dropsites track a two-stage Ruin → Level lifecycle
- **Kill Points** — +2 VP per 500 pts of Ships & Admirals destroyed at game end
- **Focal Points** — ship value totals (Light 1/Medium 4/Heavy 7/Colossal 11; Low values 0/1/3/5) checked per focal point on R4 & R6; highest value wins 3 VP, ≥ half wins 1 VP. Fires for any scenario that defines focal points, alongside any other objective
- **Assess** — Capital Ship on General Quarters within 6" of an eligible Dropsite (marked in the layout) may Assess it instead of attacking/launching; 1 VP (or 2 VP for `double_assess` dropsites). Engine-gated and server-authoritative

### Admiral abilities (core four)
| Cost | Ability |
|------|---------|
| 1 AP/die | **AP Re-roll** — after any roll, re-roll any dice (once per activation) |
| 2 AP | **Brace for Impact** — declare *before* Crippling roll; set result to 4 |
| 2 AP | **Contain Reactor** — declare *before* Explosion roll; set result to 2 |
| 2 AP | **Time to Target** — move a Fighter/Bomber Wing a second time up to 6" |

### Scenarios
- **Standard scenarios** (one-click presets): Take and Hold, Erupting Battlefront, Power Grab, Shock and Yaw, Orbital Support, Entrapmoont — pick from a dropdown or roll a random one
- Or build a **custom** scenario from the generator:
  - 7 **Deployment types**: Line, Table Corners, Midboard, From Corners, Attacker/Defender, Encirclement + more
  - 6 **Approaches**: Standoff, Close Enough, Column, Counterattack, Delayed Response, Home Fleet Disadvantage
  - 6 **Layouts**: Diagonal, Edge Case, Eruption, Gatecrash, Moonlight, Moonstruck
  - 7 **Variants**: None, Guarded Sectors, Secure Comms Array, Battlescarred, Gridlocked, Expansive Atmosphere, Orbital Complex
  - 7 **Scoring objectives** (see above), with an optional per-side (asymmetric) mode

---

## Interface

### Topbar
- **Faction VS VP display** — shows `{FACTION1} {P1 VP} {P1 name} VS {P2 name} {P2 VP} {FACTION2}` in faction colours. Click to open the full VP breakdown modal with objective details and per-round log.
- Phase breadcrumb (Setup → Scenery → Deploy → Play) always visible.
- Play-phase: round indicator, END ROUND button, opponent-waiting banner in online mode.

### Left panel — Fleet lists
- Group cards for each side, sorted heaviest tonnage first (C→H→M→L)
- Card shows group name, role, tonnage. Admiral flagship marked with ⭐. Deployment/reserve/activation badges as appropriate.
- AP chip at top of each fleet list during play — click to open AP adjuster
- Click the **player name** at the top of each fleet section to open a full fleet view
- Cards dim when it's not your side's turn; locked when another group is mid-activation

### Board (centre)
- 48"×48" SVG with 1" grid, plus an optional **3D view** (toggle top-right of board)
- Ships shown with hull bar, crippling badges (🔥 fire, Nav/Wep/Scan/Def/Decay), spike indicators, carried-operative count (⬆N)
- Lead ship marked with ✦ for group fire
- Move cone shown when a ship is selected and has an order
- Weapon targeting highlights valid targets from the lead ship; right-click cancels
- Range auras: scan/sig/launch/extract/explosion radius as appropriate
- Deployment zones shown during deploy phase and reserve arrival
- 3D view activates automatically when the scenery phase or protect nomination phase ends

### Right panel — Detail + Event Log
- Top section: full ship/dropsite detail, weapon cards, launch cards, move stats, ability buttons
- **Dropsite detail** includes an Objectives section listing any secondary or protect nominations targeting that site (icon, player name in faction colour, objective name)
- **Event Log** always docked at the bottom — last 3 events collapsed; click header to expand full scrollable history. In online mode the log header also shows the room ID and connection status dot. Logs: orders, movement (distance + turn angle), weapon locks, hit/save results, AP use, Brace/Contain, crippling, explosions, launches (all types), detector, anti-wing, extracts, kills/captures, VP awards, round markers

---

## Activation flow

1. Select a group (left panel or click a ship on board)
2. Pick an **Order** — all other same-side groups lock immediately
3. Move each ship in the group (in any order)
4. Assign weapon targets (click weapon card → click enemy ship)
5. Click **⊕ ENGAGE** to open the attack modal and resolve shooting
6. Launch assets, use Detector, or Extract as appropriate
7. Click **FINISH ACTIVATION ▸** — AP is spent, side flips to opponent

---

## Deployment

- **Deploy phase**: click a group, click in your DZ to place the first ship, move the mouse to set facing and click again — then hit **✓ CONFIRM PLACEMENT** to commit. Multi-ship groups repeat the flow for each ship in turn. Use **↩ UNDO DEPLOY** in the board HUD to return the whole group off-table.
- If only one side has Vanguard/Direct-deploy ships, the phase advances as soon as that side confirms; both sides must confirm when both have deployable ships.
- **Reserve arrival (play phase)**: off-table groups show DEPLOY NOW when eligible. Click in DZ to place, then pick an order. Ships can be redeployed (in-zone clicks) until the group acts.

---

## Known limitations

- **Admiral faction abilities** (Mass Driver Volley, Dedicated Survey Teams, etc.) are shown in the AP modal for reference but are adjudicated manually — the engine does not enforce their effects.
- **Online play** requires running the Node server. All in-game actions are server-authoritative; only the pre-game setup overlay (fleet choices, scenario, player names) remains as intentional relay.
- **Wrong-side online clicks** silently no-op + resync rather than having buttons visually disabled.
- **No AI opponent.**
- A few §12 Dropsite interactions (Collateral Damage, attack-damage → feature removal) are partially implemented and worth confirming in play.
- **Standard-scenario variant features** (Military Outposts, ODGs, Power Plants, Hangars, Comms) are placed on dropsites, but their in-game effects and any bespoke special rules are adjudicated manually.
- **Team scenarios** (e.g. Entrapmoont, 2–4 players) are modelled as standard 2-player.
- **SE1 scenarios — engine-scored:** focal-point VP at R4 & R6 (all scenarios with layout-defined focal points), Moonskipper moon path + ship destruction, Moonbreaker moon-break detection + expanding Micrometeor Cloud (1K+1E per End Phase with saves), Moonswipe pre-deployment Large Object repositioning, Very Important Moon end-game crippled-outside-focal VP, Moonguard bonus Secondary Objective, Orbital Decay activation damage (tokens assigned manually via ship panel; rolls automatic), Ready Salted Earth station BS save + debris field placement, Kill Points, Demolish VP.
- **SE1 scenarios — still manually adjudicated** (surfaced as Special Rules notes in the scenario summary):
  - **When Backfields Meet**: asymmetric colour-city ownership, Assess scoring per colour, Demolish-on-level colour restrictions
  - **Orbital Decay token assignment** (both "(Almost) Nothing" scenarios): players add/remove tokens via the ship detail panel; damage rolls are automatic at end of activation
  - **Latitudinal Lanes**: Assess scoring (which dropsites each side may assess)

---

## File structure

```
package.json                    — Node project + deps; npm start / npm run dev
server.js                       — Node server: Express + session middleware + REST API + WebSocket upgrade
client/
  index.html                    — Module-based client (imports src/engine/ and src/fleet/; hotseat + online)
  assets/
    *.glb                       — 3D ship models (per faction × frigate/cruiser) + station + city size variants
src/
  api.js                        — REST routes + WebSocket message handler
  auth.js                       — Auth routes: POST /api/auth/register|login|logout, GET /api/auth/me
  admin.js                      — Admin routes: /api/admin/users|rooms|saves (role=admin required)
  db.js                         — SQLite layer (better-sqlite3): users, saves, room_slots tables + helpers
  rooms.js                      — In-memory room lifecycle (slots, spectators, broadcast, TTL)
  saves.js                      — SQLite persistence: saveRoom(), loadAllSaves() helpers
  engine/
    constants.js                — All fleet defs, ORDERS, LAYOUTS, ASSET_PROFILES, SECONDARY_OBJECTIVES, etc.
    rng.js                      — Seeded PRNG + Math.random wrapper for local play
    state.js                    — createState() factory, buildSideFleet(), rebuildFleets()
    mutators.js                 — All state-mutating functions (movement, combat, scoring, AP…)
    gating.js                   — Intent legality: isLegal() + legalActions()
    version.js                  — APP_VERSION, RULEBOOK_VERSION, ERRATA_VERSION constants
  fleet/
    db.js                       — Full ship/weapon DB + admiral ability data for all 6 factions
    parser.js                   — New Recruit list parser: parseNewRecruit(text)
data/
  dfc.db                        — SQLite database (auto-created; stores users, saves, sessions)
reference/
  *.pdf                         — Faction fleet stat sheets (all 6 factions) + rulebook v2.3.1
plans/
  *.md                          — Design/planning documents (not deployed)
```

---

## Browser compatibility

Chrome, Firefox, and Edge (current versions). SVG, CSS Grid, and ES2020 are required — any browser from 2020+ will work.

`client/index.html` uses ES modules and must be served over HTTP — use any static file server (e.g. `python -m http.server`) or the included Node server rather than opening the file directly.
