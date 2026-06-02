# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

DFC Fleet Ops is a browser-based battlemat for the **Dropfleet Commander** tabletop game.

- **`client/index.html`** — the entire client (HTML/CSS/JS, ES modules, no build step). Run via any static server or the Node server below.
- **`server.js`** — optional Express + WebSocket server for online two-player rooms. `npm start` / `npm run dev`.

No build step, no lint, no test suite. Browser client has zero runtime deps; Node deps are server-only.

## Architecture

### Engine (`src/engine/`)

Pure game logic, zero DOM dependencies, runs identically in browser and server.

- **`constants.js`** — all data: `FACTIONS`, `ORDERS`, `LAYOUTS`, `DEPLOYMENTS`, `OBJECTIVES`, `ASSET_PROFILES`, `SECONDARY_OBJECTIVES`, etc.
- **`state.js`** — `createState()`, `buildSideFleet()`, `buildScenarioState()`
- **`mutators.js`** — all state-mutating functions + `apply(state, intent, rng)` dispatcher
- **`gating.js`** — `isLegal(state, intent, side)` + `legalActions(state, side)`
- **`rng.js`** — seeded PRNG (`makeRng(seed)`) + `localRng` (Math.random wrapper)

### Intent pattern

An **intent** is `{ type, ...payload }`. Every action that can happen online must go through this:

1. `gating.js#isLegal` — single legality gate, run by server before apply and by client before local mutation in hotseat
2. `mutators.js#apply` — dispatches to the appropriate mutator
3. **Every `apply()` case must have a matching `isLegal` case** — keep them in lockstep.

### Client (`client/index.html`)

**Shim pattern** — state-bound wrappers so render/handler code doesn't pass `state` everywhere:
```js
function moveShip(...args) { return _moveShip(state, rng, ...args); }
```

**`dispatch(intent)`** — all in-game actions go through this. In hotseat: validates via `isLegal`, applies locally. Online: sends `{type:'intent'}` to server, waits for authoritative `{type:'full'}` broadcast.

**State & render** — single global `state` object, `renderAll()` re-renders everything from scratch on each change. All render functions are pure reads from `state`.

### Online server

Intent path (authoritative): `{type:'intent'}` → `isLegal` → `apply` → broadcast `{type:'full'}`. Client does **not** mutate locally.

Relay path (setup only): `{type:'state'}` → store → rebroadcast. Pre-game setup overlay stays on relay intentionally — it's collaborative config with no legality to enforce.

## Activation flow

1. Select a group (left panel or board click)
2. Pick an Order — other same-side groups lock immediately
3. Move ships (in any order)
4. Click a weapon card → click an enemy ship to lock a target
5. **⊕ ENGAGE (N)** — appears once targets are locked; opens the attack modal
6. After shots resolve, FINISH ACTIVATION

## SE1 scenario notes

- All 14 SE1 scenarios have faithful layouts and engine-scored objectives. Focal-point VP runs at R4 & R6 for any layout with `focalPoints` defined (regardless of primary objective).
- `stationCityLinks` on RSE layouts encodes station↔city pairing for the BS-save and power-link line.
- `moonDropsites` on Moonbreaker identifies which dropsites sit on the Large Object.
- Moonskipper moon position is tracked in `state.moonPos` (updated each End Phase); 2D and 3D renderers both use this override.
- Moonswipe uses `state.moonswipe` for pre-deployment repositioning; positions baked into `scenarioData.largeObjects` at `commitScenario`.
- Orbital Decay tokens: `s.orbitalDecayTokens` per ship; damage (D3 × tokens, 2D3 for Colossal) auto-rolled in `finishActivation` for the two orbital-only layouts.

## Intent migration status

**Server-authoritative:** turn flow, orders, movement, deploy, weapons, combat modal (including `attackSetReroll` / `attackSetFighterSpend` steppers), launches, scoring/round, asset phase (move, T2T, lock, dogfight, merge, scenery), battalion combat, DA transitions (`daPickDropsite`, `openDAFeatureAttack`), scenery placement (`placeScenery`), asset board movement (`assetMove`), dropsite damage (`adjustDropsiteDamage`), battalion counts (`adjustBattalion`). All in-game mutations go through intents; `netAfterRender()` is stubbed out.

**Still relay:** pre-game setup overlay (fleet choices, scenario, names, colours) — intentional.

## Known limitations

- Wrong-side online clicks silently no-op + resync (no visual disabled state).
- No AI opponent.
- Admiral faction/famous abilities shown in AP modal for reference; adjudicated manually.
- Standard-scenario variant feature in-game effects (ODG fire timing, Power-Plant blast, etc.) adjudicated manually.
- Team scenarios (Entrapmoont, Moonswipe) modelled as standard 2-player.
- SE1 still manual: When Backfields Meet colour-ownership scoring; Orbital Decay token *assignment* (damage auto-rolled); Latitudinal Lanes Assess scoring.
