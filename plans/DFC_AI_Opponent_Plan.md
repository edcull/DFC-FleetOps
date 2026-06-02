# DFC Fleet Ops — AI Opponent Plan

> **Status (June 2026): Phase A + B + C substantially complete.**
> All `src/ai/` files exist and are implemented. Phase D (polish) is next.
> See Implementation Phases section for remaining gaps.

---

## Design Philosophy

The AI runs **server-side** as a first-class room participant, replacing one player slot's
WebSocket connection with an internal trigger loop. The human client receives the same
authoritative state broadcasts it would from a human opponent — the AI is invisible at the
protocol level.

Two decision engines share one common interface:

- **Fallback heuristic AI** — always available, offline-capable, instant, rule-based scoring
- **LLM AI** — calls Anthropic or OpenAI with a compressed state briefing and a short
  options list; picks the best activation-level choice

The LLM is an upgrade on top of a functional baseline, not a hard dependency. If the API
key is absent, the call times out, or the response cannot be parsed, the heuristic scorer
takes over silently. The game never stalls.

---

## File Structure

```
src/ai/
  index.js          — triggerAi(room): entry point; dispatches to sub-phase handlers
  state-parser.js   — compresses game state to a ~500-token text briefing
  options.js        — groups legalActions() into activation-level choices with plain-English labels
  personalities.js  — personality definitions: system prompts + heuristic weight maps
  llm.js            — Anthropic / OpenAI API wrapper with timeout + fallback
  fallback.js       — heuristic option scoring (kill potential, VP position, survival, objectives)
  translator.js     — expands a chosen Option into the exact intent sequence for apply()
  handlers/
    planning.js     — planning phase: give / take initiative
    activation.js   — activation phase: pick group, order, move, fire, finish
    dropsite.js     — dropsite activation phase: activate dropsites, drop battalions
    asset.js        — asset phase: move assets, resolve attacks
    repair.js       — repair/end phase: fire damage rolls, crippling repair
    deploy.js       — deployment phase: place vanguard / direct-deploy ships
```

---

## Room Integration (`src/rooms.js`)

### Room structure additions

```js
room.aiSide        = null;          // 'player1' | 'player2' | null
room.aiPersonality = 'balanced';    // key from PERSONALITIES
room.aiLlm         = true;          // use LLM if available; false = heuristic only
room.aiPending     = false;         // guard against concurrent AI triggers
```

### Trigger hook

Called after every intent application and broadcast:

```js
async function maybeAiTurn(room) {
  if (!room.aiSide || room.aiPending) return;
  if (!shouldAiAct(room.state, room.aiSide)) return;
  room.aiPending = true;
  try {
    await triggerAi(room);
  } catch (err) {
    console.error('[AI] unhandled error:', err);
  } finally {
    room.aiPending = false;
  }
}
```

### `shouldAiAct(state, side)` — when does the AI have a decision to make?

```js
function shouldAiAct(state, side) {
  if (state.phase === 'deploy')
    return deploySideAllowed(state, side) && undeployedDeployableCount(state, side) > 0;
  if (state.phase !== 'play') return false;
  if (state.repairPhase)         return repairPhaseNeedsInput(state, side);
  if (state.assetPhase)          return state.assetActiveSide === side;
  if (state.dropsiteActivation)  return state.dropsiteActivation.side === side;
  if (state.activeSide === side) return true;
  // Planning phase: initiative winner must give/take
  if (state.initiative && state.initiative.winner === side && !state.initiative.holder)
    return true;
  return false;
}
```

### Room creation API

New optional fields on `POST /api/rooms`:

```json
{
  "aiOpponent":    true,
  "aiSide":        "player2",
  "aiPersonality": "aggressive",
  "aiLlm":         true
}
```

When `aiOpponent: true` the server fills the chosen slot permanently. The AI slot never
sends or receives WebSocket messages. The human joins as normal on the other side.

### Slot-locking compatibility (auth branch)

The `feature/auth-sqlite` branch locks room slots to user accounts. At WebSocket connect
time, `handleConnection` in `src/api.js` rejects any user whose id doesn't match the
`room_slots` record for that side — and lets any authenticated user *claim* a free slot.

This means the AI's slot must be explicitly reserved so no human can walk in and claim it.
Two options:

1. **Sentinel user_id** — create a dedicated `users` row for the AI (e.g. username
   `_ai`, role `ai`) at server startup. When `aiOpponent: true`, call
   `setRoomSlot(room.id, aiSide, AI_USER_ID)`. The ownership check will then reject any
   real user who tries to connect to that side.

2. **`room.aiSide` guard in `handleConnection`** — before the slot-ownership check, add:
   ```js
   if (room.aiSide === side) {
     send(ws, { type: 'error', reason: 'This slot is reserved for the AI opponent.' });
     return ws.close();
   }
   ```

**Recommended: option 2** — simpler, no DB row needed, and it's explicit. Add this check
at the top of the side-validation block in `handleConnection`, before the existing
`getRoomSlot` call.

Also: `dotenv/config` is now loaded by `server.js`, so `AI_PROVIDER`, `AI_API_KEY`,
`AI_MODEL`, `AI_TIMEOUT_MS`, and `AI_FALLBACK_ONLY` (see Server Config section) work
out of the box from a `.env` file — no additional setup needed.

---

## `triggerAi(room)` — Top-Level Entry (`src/ai/index.js`)

Dispatches to the correct sub-phase handler, applies the intent sequence, and broadcasts:

```js
export async function triggerAi(room) {
  const { state, rng, aiSide, aiPersonality, aiLlm } = room;
  const personality = getPersonality(aiPersonality);

  let intentSequence;
  if (state.phase === 'deploy') {
    intentSequence = await handlers.deploy(state, aiSide, personality, aiLlm);
  } else if (state.initiative && !state.activeSide &&
             !state.dropsiteActivation && !state.assetPhase && !state.repairPhase) {
    intentSequence = await handlers.planning(state, aiSide, personality, aiLlm);
  } else if (state.dropsiteActivation) {
    intentSequence = await handlers.dropsite(state, aiSide, personality, aiLlm);
  } else if (state.assetPhase) {
    intentSequence = await handlers.asset(state, aiSide, personality, aiLlm);
  } else if (state.repairPhase) {
    intentSequence = await handlers.repair(state, aiSide, personality, aiLlm);
  } else {
    intentSequence = await handlers.activation(state, aiSide, personality, aiLlm);
  }

  // Apply the sequence; skip any intent that fails isLegal.
  for (const intent of intentSequence) {
    if (!isLegal(state, intent, aiSide)) {
      console.warn('[AI] illegal intent skipped:', intent.type);
      break;
    }
    apply(state, intent, rng);
  }
  broadcast(room, { type: 'full', state });

  // Chain: if the AI still has something to do, trigger again immediately.
  if (shouldAiAct(state, aiSide)) {
    await maybeAiTurn(room);
  }
}

// ⚠️ Circular-dependency note:
// triggerAi (ai/index.js) calls maybeAiTurn (rooms.js), but rooms.js imports triggerAi.
// Break the cycle by injecting maybeAiTurn as a parameter or callback:
//   export async function triggerAi(room, maybeAiTurn) { ... }
// rooms.js passes its own maybeAiTurn when calling triggerAi.
```

The human client receives a single clean state update per AI activation, not a stream of
intermediate states.

---

## State Parser (`src/ai/state-parser.js`)

Converts the full state object into a compact text briefing (~400–600 tokens).

### Example output

```
=== GAME STATE — Round 3 / 6 ===
Objective: Standard Scoring (control dropsites at R4 and R6)
Secondary (AI): Key Site — nominated DS-2 (Medium, 28" from my zone)

SCORE  AI (PHR) VP:3 KP:120   Human (UCM) VP:5 KP:80

DROPSITES
  DS-1 [S] Orbit  18" from AI zone   CONTESTED  AI:2 bat / Human:1 bat
  DS-2 [M] Atmo   24" from AI zone   HUMAN controlled  3 bat   ← Key Site
  DS-3 [L] Orbit  30" from AI zone   UNCONTROLLED
  DS-4 [M] Orbit  36" from AI zone   AI controlled  4 bat

AI FLEET (PHR) — AP:2  Pass tokens:0
  Theseus Cruiser      [M]  8/8 HP   Orbit NW   not activated   order:—
  Ikarus Vanguard      [M]  9/10 HP  Orbit C    ACTIVATED
  Orpheus Troopship    [M]  7/10 HP  Atmo SW    not activated   order:GQ  Spk:1
  Pandora Frigate ×2   [L]  3/4 HP   Orbit NE   not activated   order:—
  Medea Strike ×2      [L]  2/4 HP   Orbit N    not activated   order:—

HUMAN FLEET (UCM)
  Johannesburg BCr     [H]  14/14 HP  Orbit N    ACTIVATED
  Las Vegas CC         [M]  12/12 HP  Orbit NE   not activated
  Rio Cruiser          [M]  8/10 HP   Orbit C    not activated  Spk:2
  San Francisco TP     [M]  10/10 HP  Atmo SE    not activated
  Lima Detector ×2     [L]  4/4 HP    Orbit N    ACTIVATED

ASSETS  PHR Dropships (2) at DS-3, placed by Orpheus
```

### Design rules

- **Quadrant labels** (NW/N/NE/C/SW/S/SE) instead of pixel coordinates — the LLM
  understands directions, not numbers
- **Distance in inches** to each dropsite, rounded to nearest 2"
- Destroyed groups omitted; heavily damaged groups marked
- Enemy info limited to what is visible on the board (no hidden state)
- Target: under 600 tokens; never truncate the ship list

---

## Options Parser (`src/ai/options.js`)

> ⚠️ **Implementation note:** `legalActions(state, side)` in gating.js only iterates the
> small `INTENT_TYPES` set (`['pass', 'endRound', 'commitScenario']`) — it cannot enumerate
> move, order, or targeting intents because those require payload parameters. `options.js`
> must generate candidate intents itself and validate each with `isLegal(state, intent, side)`.
> The generation algorithm below already reflects this correctly.

The options parser generates **activation-level choices** — the unit the AI reasons about —
by enumerating candidate (group, order, destination, target) combinations and checking each
with `isLegal()`.

### Activation-level option structure

```js
{
  id: 'opt_3',
  label: 'Activate Orpheus Troopship [GQ] — advance to DS-2, launch 2 Bulk Landers',
  groupId: 'player2:p3',
  order: 'GQ',
  movePlan: { targetX, targetY, heading },
  targets: [],           // [{gid, si}] weapon targets
  launchPlan: null       // asset launch if applicable
}
```

### Generation algorithm for activation phase

For each un-activated group:
1. Enumerate legal orders (filter ORDERS by what isLegal allows)
2. For each order, compute 2–3 candidate move destinations:
   - Toward the nearest contested / uncontrolled dropsite
   - Toward the nearest enemy group
   - Hold / optimal firing position (maximise weapons in arc)
3. For each (group, order, destination), identify best weapon targets from that position
4. Label each combination in plain English

Cap at **8–10 options total** before calling the LLM. Always include Pass as the last option.

### Options for other phases

| Phase | Options generated |
|---|---|
| Planning | Take initiative / Give initiative to opponent |
| Deploy | 3–4 candidate positions in zone per undeployed group (near dropsites, centred, coherency) |
| Dropsite | Activate each eligible dropsite (labelled by name + battalions) / Skip |
| Asset | Move each asset toward best target / attack if in range / advance stage |
| Repair | Accept each repair roll (usually automatic; AI only needed for Brace/Contain declarations) |

---

## LLM Interface (`src/ai/llm.js`)

### Prompt structure

```
SYSTEM:
You are {personality.label}, a Dropfleet Commander admiral.
{personality.systemPrompt}
Reply with ONLY the option number you choose, followed by one sentence explaining why.
Format: "3 — advancing Orpheus to DS-2 contests the Key Site before the human reinforces."

USER:
{stateBriefing}

OPTIONS:
1. {option[0].label}
2. {option[1].label}
...
N. Pass activation (spend 1 Pass Token if available)

Choose one option (1–N):
```

### API call with timeout + fallback

```js
async function llmChoose(briefing, options, personality, timeoutMs = 8000) {
  const messages = buildPrompt(briefing, options, personality);
  try {
    const result = await Promise.race([
      callProvider(messages),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]);
    const idx = parseOptionIndex(result, options.length);
    if (idx === null) throw new Error('unparseable');
    return idx;
  } catch (err) {
    console.warn('[AI] LLM fallback:', err.message);
    return null; // caller uses heuristic scorer
  }
}
```

### Provider abstraction

Both Anthropic and OpenAI are supported via a thin wrapper. Selected by env var:

```
AI_PROVIDER=anthropic   AI_API_KEY=sk-ant-...   AI_MODEL=claude-haiku-4-5-20251001
AI_PROVIDER=openai      AI_API_KEY=sk-...        AI_MODEL=gpt-4o-mini
```

**Recommended model**: `claude-haiku-4-5-20251001` or `gpt-4o-mini`. Option selection from
a short list does not require a large model; speed and cost matter more than raw capability.
When Claude 4.x Haiku is released, prefer it over Haiku 4.5 for the same price tier.

**Cost estimate**: ~30–40 AI activations per 6-round game. At Haiku pricing ≈ $0.001/call:
negligible per game. Sonnet ≈ $0.05/game — acceptable for higher-quality play.

---

## Fallback Heuristic AI (`src/ai/fallback.js`)

Rule-based scoring used when: no API key, call timeout, unparseable response, or
`aiLlm: false`. Returns the index of the highest-scoring option.

### Scoring function

```js
function scoreOption(option, state, aiSide, weights) {
  return (
    weights.kill      * estimateKillPotential(option, state, aiSide) +
    weights.vp        * estimateVpGain(option, state, aiSide) +
    weights.survival  * estimateSurvival(option, state, aiSide) +
    weights.objective * estimateObjectiveProgress(option, state, aiSide) +
    weights.momentum  * (option.groupId ? 1 : 0)
  );
}
```

### Heuristic implementations

| Heuristic | Method |
|---|---|
| `estimateKillPotential` | Sum `att × hitProbability × dmg` for each weapon that reaches a target from the move destination |
| `estimateVpGain` | Check if the destination puts ships within battalion-drop range of contested / uncontrolled dropsites |
| `estimateSurvival` | Count enemy weapon dice that can reach the destination; negate and normalise |
| `estimateObjectiveProgress` | Bonus if this action directly advances a secondary or protect nomination |

These are intentionally approximate — correct enough to produce sensible play, not a
full simulation.

---

## Personalities (`src/ai/personalities.js`)

Each personality shapes both the LLM system prompt and the heuristic weight map.

```js
export const PERSONALITIES = {

  aggressive: {
    label: 'Aggressive',
    systemPrompt: `You favour closing range and maximising kills.
Prioritise hull damage over positioning. Accept risk. Prefer Weapons Free and General Quarters.
Closing to Close Action range is almost always worth it.`,
    weights: { kill: 2.5, vp: 1.0, survival: 0.3, objective: 0.8, momentum: 0.5 }
  },

  positional: {
    label: 'Positional',
    systemPrompt: `You prioritise dropsite control and objective completion.
Avoid unnecessary engagements. Contest key dropsites. Drop battalions early.
Prefer Course Change and Max Thrust for repositioning.`,
    weights: { kill: 0.8, vp: 2.5, survival: 1.0, objective: 2.0, momentum: 0.5 }
  },

  defensive: {
    label: 'Defensive',
    systemPrompt: `You value fleet preservation above all. Avoid being outgunned.
Use Silent Running to shed spikes. Prioritise Damage Control on crippled ships.
Accept losing VP to avoid losing ships.`,
    weights: { kill: 0.6, vp: 1.0, survival: 2.5, objective: 0.8, momentum: 0.3 }
  },

  balanced: {
    label: 'Balanced',
    systemPrompt: `You balance offensive pressure, positional play, and fleet survival.
Adapt: press advantages when ahead on VP, play conservatively when behind.`,
    weights: { kill: 1.2, vp: 1.5, survival: 1.2, objective: 1.5, momentum: 0.5 }
  },

  opportunist: {
    label: 'Opportunist',
    systemPrompt: `You identify and eliminate high-value targets of opportunity.
Ignore cheap ships. Focus fire on crippled enemies and expensive targets.
Sacrifice positioning to secure kills on heavy assets.`,
    weights: { kill: 3.0, vp: 0.8, survival: 0.5, objective: 0.6, momentum: 0.5 }
  }
};
```

---

## Intent Translator (`src/ai/translator.js`)

Expands an activation-level Option into the exact intent sequence for `apply()`.

### Activation sequence

```
applyOrder            { gid, order }
moveShip              { gid, si, x, y }          — for each ship in the group
aimShip               { gid, x, y }              — set lead ship heading
lockWeaponTarget      { gid, wi, targetGid, targetSi }   — per weapon+target pair
fireWeapons           { gid }
finishActivation      { gid }
```

### Move planner

`movePlan.targetX/Y` is a desired destination. The planner finds the closest legal point
within the move cone (respecting `moveMin`, `moveMax`, turn limits from `moveCone()`):

```js
function planMove(state, gid, si, targetX, targetY, order) {
  // 1. Compute legal move cone for this ship + order
  // 2. Find the point within the cone closest to targetX/Y
  // 3. If target is reachable, move there; else move as far as possible toward it
  // 4. Return { x, y, heading }
}
```

**Multi-ship groups**: each ship moves individually. The translator positions ships using
coherency-aware spacing — ships stay within `coherencyDist` of each other.

---

## Sub-Phase Handlers

### `handlers/activation.js`

```
1. generateActivationOptions(state, aiSide)   — options.js
2. buildStateBriefing(state, aiSide)           — state-parser.js
3. llmChoose or fallback scoreOption           — llm.js / fallback.js
4. log choice + reasoning to room event log
5. translator.buildActivationSequence(option) — intent sequence
```

### `handlers/planning.js`

Binary choice: take initiative (go first) or give it to the opponent. The fallback scores
based on VP delta and whether the AI has higher-priority targets to hit first this round.

### `handlers/deploy.js`

For each un-deployed vanguard/direct group, generate candidate positions:
- Near the closest contested dropsite
- Near the board centre
- Near a friendly group for coherency
- Vanguard groups use the full vanguard halo depth

### `handlers/dropsite.js`

Which dropsites to activate and in what order. Score by expected battalion advantage and
whether a feature weapon fires usefully.

### `handlers/asset.js`

Move assets toward the optimal targets. Score by expected damage or battalion delivery
value per asset type.

### `handlers/repair.js`

Usually fully deterministic (accept repair roll results). AI input needed only for
Brace/Contain AP declarations — decided by checking AP remaining vs crippling severity.

---

## Client-Side Changes

### Mode selector (`client/index.html`)

Add a "SOLO vs AI" option in the mode selector alongside Host / Join:

```
┌────────────────────────────────────┐
│  LOCAL HOTSEAT                      │
│  ONLINE — Host a room               │
│  ONLINE — Join a room               │
│  SOLO vs AI                         │  ← new
└────────────────────────────────────┘
```

"SOLO vs AI" flow:
1. Player sets up the game as normal (full setup overlay, their side only)
2. AI faction + personality selectable (or randomised)
3. `POST /api/rooms { aiOpponent: true, aiSide: 'player2', aiPersonality: '...', aiLlm: true }`
4. Client joins the returned room as `player1`

The AI's own fleet and secondaries are assigned server-side at room creation, driven by the
personality (aggressive personalities lean toward heavier fleets; defensive ones toward
faster ones).

### AI status indicator

A small indicator in the event log header or topbar shows AI state:

```
⏳ AI thinking…          ← during LLM call (replaces room dot)
🤖 "advancing to DS-2"   ← shown briefly after choice, if LLM reasoning is available
```

---

## Server Config

```
AI_PROVIDER=anthropic                  # 'anthropic' | 'openai'
AI_API_KEY=sk-ant-...                  # never sent to client
AI_MODEL=claude-haiku-4-5-20251001    # model override
AI_TIMEOUT_MS=8000                     # LLM call timeout before fallback
AI_FALLBACK_ONLY=false                 # true = always heuristic, skip LLM
```

Loaded in `server.js` via `dotenv`. The AI module reads these at startup and sets
`llmAvailable` accordingly.

---

## Implementation Phases

### Phase A — Foundation (heuristic AI, activation phase only)
1. `personalities.js` — five personality definitions
2. `state-parser.js` — state-to-text briefing
3. `options.js` — activation-level option generation
4. `fallback.js` — heuristic scoring
5. `translator.js` — activation intent sequence from chosen option + move planner
6. `handlers/activation.js` — full activation flow (heuristic only)
7. Room integration — `aiSide`, `shouldAiAct`, `maybeAiTurn`, API endpoint

**Milestone**: playable heuristic AI for the activation phase

### Phase B — Full sub-phase coverage
1. `handlers/planning.js` — initiative give/take
2. `handlers/deploy.js` — vanguard/direct deployment
3. `handlers/dropsite.js` — dropsite activation
4. `handlers/asset.js` — asset phase
5. `handlers/repair.js` — repair/end phase

**Milestone**: AI can complete a full game without stalling

### Phase C — LLM layer
1. `llm.js` — Anthropic + OpenAI wrapper with timeout + fallback
2. Prompt tuning — test each personality across scenarios
3. Client "SOLO vs AI" mode selector
4. AI status indicator in UI
5. AI fleet/secondary selection at room creation

**Milestone**: full LLM-driven AI selectable from the mode screen

### Phase D — Polish
1. Move planner improvements (coherency, layer changes, vanguard halo)
2. Multi-target weapon allocation (spread vs focus fire)
3. Asset phase sophistication (dogfights, torpedo paths)
4. Battalion combat AI
5. Difficulty tiers: Easy (fallback, narrow search) / Medium (LLM Haiku) / Hard (LLM Sonnet)

---

## Known Constraints and Risks

| Constraint | Mitigation |
|---|---|
| **Action space is huge** — `legalActions` returns hundreds of granular intents | Options parser groups to activation level; LLM sees 8–10 choices, not hundreds |
| **Multi-step activations** — partial sequences leave state in an illegal mid-activation condition | Translator always emits a complete sequence; any illegal intent breaks the loop, not the game |
| **LLM hallucination** — response may be out-of-range or unparseable | `parseOptionIndex` is defensive; falls back to heuristic scorer on any parse failure |
| **Async in Node.js** — concurrent AI triggers would corrupt state | `aiPending` flag guards the trigger; only one `triggerAi` runs at a time per room |
| **Latency** — Haiku typically responds in 1–3s | `AI_TIMEOUT_MS` caps the wait; heuristic fires immediately on timeout |
| **API key security** — key must not reach the browser | Key lives in server env; never serialised into room state or broadcast |

---

## AI Fleet Builder (`src/ai/fleet-builder.js`)

Generates a legal, balanced fleet for the AI opponent at a given points level. The output
is compatible with the `importedFleets` format already consumed by `buildSideFleet()`, so
the built fleet slots straight into a room without any additional plumbing.

The builder also emits a **tactics summary** — a short list of strategic recommendations
derived from the fleet's composition. This feeds directly into the AI's personality system
prompt, giving the LLM context about what the fleet is designed to do.

---

### Inputs

```js
buildAiFleet({
  faction:      'ucm',       // faction key from FLEET_DB
  targetPts:    1500,        // match the human's fleet total
  admiralLevel: 2,           // 0 = none, 1–5 = generic admiral level
  personality:  'aggressive',// optional: biases group selection
  rng:          roomRng,     // seeded RNG for reproducibility
})
```

Returns:

```js
{
  faction:      'ucm',
  groups:       [{ name, count, pts, options }],   // importedFleets-compatible
  admiralLevel: 2,
  admiralGroupIdx: 3,                               // which group carries the admiral
  totalPts:     1498,
  tactics:      [                                   // see Tactics Generation below
    "Heavy battlecruiser present — protect it; it is the prime focus-fire target",
    "Two troopships — prioritise landing battalions early",
    "No fighter cover — vulnerable to bomber attack; keep groups spread"
  ]
}
```

---

### Fleet Construction Rules

**Source: Dropfleet Commander Rulebook v2.3.1, Section 4.2 (verified from PDF)**

#### 1. Points budget
- Total group pts must be **≤ `targetPts`** — never over the player's total
- Must be **≥ 97% of `targetPts`** — no more than 3% underspend allowed
- Valid range: `0.97 × targetPts ≤ totalPts ≤ targetPts`
- Points cost per group = `def.pts` as listed in db.js (already the full group cost)

#### 2. Tonnage ratios — Heavy and Colossal (rulebook §4.2)

The tonnage rules are **points-ratio based**, not group-count based:

| Tonnage | Restriction |
|---|---|
| **Light** (L) | Up to the combined pts of all Medium + Heavy ships |
| **Medium** (M) | No explicit limit — the fleet backbone |
| **Heavy** (H) | No more pts of Heavy ships than Medium ships |
| **Colossal** (C) | Skirmish: 0 groups · Clash: 1 group · Battle: 2 groups · Reconquest: 3 groups |

> ⚠️ The rulebook calls the highest tier **Colossal**, not "Capital". In `db.js` this is
> `tonnage: 'C'` (e.g. London Dreadnought, Washington Supercarrier). Heavy is `tonnage: 'H'`.

Detection: `def.tonnage === 'H'` (Heavy) or `def.tonnage === 'C'` (Colossal)

Game size reference:
- Skirmish: 501–1000 pts
- Clash: 1001–2000 pts
- Battle: 2001–3000 pts
- Reconquest: 3001+ pts

#### 3. Rare groups (rulebook §14.1.14)

> *"You may only take one Group of this Ship in a Skirmish-sized game, two in a Clash,
> three in a Battle, and four in a Reconquest."*

Per-ship-name cap, scaling with game size:
- Skirmish: max 1 group per Rare ship name
- Clash: max 2 groups per Rare ship name
- Battle: max 3 groups per Rare ship name
- Reconquest: max 4 groups per Rare ship name

Detection: `/\bRare\b/i.test(def.special)`

#### 4. Unique groups (rulebook §14.1.18)

> *"You may only take one Group of this Ship."*

Max 1 group of each Unique ship globally, regardless of game size.

Detection: `/\bUnique\b/i.test(def.special)`

#### 5. Admiral rules (rulebook §4.2.1)

| Admiral Level | Points cost | Minimum game size |
|---|---|---|
| 2 | 20 pts | Any (Skirmish+) |
| 3 | 40 pts | Clash+ |
| 4 | 60 pts | Battle+ |
| 5 (Famous only) | Ship cost | Battle+ (counts as Lv4 for size restriction) |

AP generation per round: **1 + admiral level** (§6.1).

- Any number of generic admirals may be taken; only the highest level counts for rules
- Faction / Famous Admirals: max **1** of either type per fleet
- Famous Admiral ships match `/Famous Admiral/i` in `special`; they must be assigned to
  the specific Ship in their profile
- Level 5 Famous Admirals count as Level 4 for game-size restriction purposes

#### 6. Drop assets — no minimum requirement in rulebook

> ⚠️ The "20–40% drop requirement" **does not exist** in rulebook v2.3.1. There is no
> mandatory drop-asset percentage rule. The builder should instead include drop-capable
> groups as a **soft preference** driven by scenario objectives, not a hard constraint.

Drop-capable groups (for tactics analysis only): `def.launch` contains `type === 'dropship'`
or `type === 'bulk_lander'`. The builder tracks `dropPct` for informational purposes and
the tactics generator uses it to advise the AI, but it does not gate fleet validity.

#### 7. Group size
- Each "group" is the fixed unit defined by `def.groupSize` ships
- `def.pts` in db.js is already the full group cost (not per-ship)
- Multiple identical groups are allowed unless limited by Rare/Unique rules

---

### Builder Algorithm

The builder uses a **constraint-guided random selection** loop:

```
Determine game size from targetPts (Skirmish/Clash/Battle/Reconquest)
Derive: colossal_limit, rare_limit, heavy_pts_cap = mediumPts (computed iteratively)

1. SEED medium backbone
   — Bias by personality (aggressive → high att weapons; positional → carriers/troopships)
   — Add 2–4 M-tonnage groups to establish the Medium pts pool

2. OPTIONALLY add Heavy group
   — If personality is aggressive/opportunist and game is Clash+: consider 1 H group
   — Check Heavy constraint: heavy pts ≤ medium pts after addition
   — Check Colossal limit: 0 for Skirmish, else consider 1 C group for Battle+

3. ADD drop-capable groups (soft preference, not required)
   — If personality is positional: aim for ~30% drop-capable pts
   — Respect Rare limits per game size

4. FILL remaining budget with L and M groups
   — Candidate pool: all non-Unique ships for the faction
   — Check per-name Rare limit (1/2/3/4 by game size)
   — Check Heavy pts ratio after each H addition
   — Stop when budget within 3% or no group fits

5. ASSIGN admiral
   — If admiralLevel = 0: skip
   — If admiralLevel ≥ 2 and game allows: add admiral pts cost to total
   — If Famous Admiral available at correct level: optionally substitute one group
   — Set admiralGroupIdx to highest-tonnage, non-Rare group

6. VALIDATE all constraints
   — Heavy pts ≤ Medium pts
   — Colossal groups ≤ game-size limit
   — Each Rare name count ≤ game-size limit
   — Each Unique name count ≤ 1
   — Total pts within [0.97 × targetPts, targetPts] — never over, max 3% under
   — If any constraint fails: discard and restart (max 20 retries)

7. EMIT tactics summary (see below)
```

---

### Tactics Generation

After the fleet is built, the builder analyses its composition and emits 3–6 tactical
observations as plain-English strings. These are appended to the AI personality's system
prompt when the LLM is used, giving it fleet-specific strategic context.

#### Rule categories

| Category | Detection | Tactic string |
|---|---|---|
| **Vanguard presence** | Any group has `def.vanguard` set | `"Vanguard ships available — consider early board presence and applying pressure before the opponent settles"` |
| **Heavy/Colossal flagship** | H or C tonnage group present | `"Heavy/Colossal flagship — protect it; its points value makes it the prime focus-fire target"` |
| **High drop count** | dropPct > 0.35 | `"Drop-heavy roster — prioritise landing battalions early; fleet is built around ground control"` |
| **Low drop count** | dropPct < 0.20 | `"Limited drop capacity — choose dropsites carefully; cannot afford to contest all objectives"` |
| **Fighter/bomber wings** | `launch.type === 'fighter_bomber'` present | `"Fighter/bomber wings available — use them to screen against incoming bombers and to threaten crippled targets"` |
| **Silent Running synergy** | Multiple L-tonnage groups with low sig | `"Low-signature light elements — Silent Running can effectively neutralise targeting; use approach lanes"` |
| **Command ship present** | `special` contains `Command Ship` | `"Command Ship in fleet — maintain AP generation; prioritise its survival above most other groups"` |
| **Detector present** | `special` contains `Detector` | `"Detector available — use it early to spike high-value enemy targets and open them to long-range fire"` |
| **Bombardment weapons** | `special` of a weapon contains `Bombardment` | `"Bombardment capable — engage dropsites from distance; deny enemy battalion build-up without close approach"` |
| **Close Action focus** | Majority of weapons have `Close Action` | `"Close-Action-heavy weapons — close range is essential; plan approaches that survive the initial long-range exchange"` |
| **Torpedo complement** | `launch.type === 'torpedo'` present | `"Torpedo complement — use them to threaten or finish off crippled heavy targets"` |
| **Aegis coverage** | `special` contains `Aegis` | `"Aegis ships present — cluster near carriers and Capital Ships to provide anti-wing screening"` |

Tactics are de-duplicated and the most relevant 3–6 are selected. If the LLM is enabled,
the tactics list is included in the planning-phase prompt as `Fleet Tactics Guidance:`.

---

### Integration with AI Decision Making

The `tactics` array returned by the builder is stored on the room:

```js
room.aiTactics = fleet.tactics;
```

It is injected into every LLM prompt after the personality system prompt:

```
You are {personality.label}.
{personality.systemPrompt}

Fleet Tactics Guidance (specific to your current fleet):
- {tactics[0]}
- {tactics[1]}
- {tactics[2]}
```

This grounds the LLM's decisions in what the fleet is actually capable of, rather than
relying solely on the generic personality description.

The fallback heuristic also reads `tactics` to adjust its scoring weights at runtime:
- `"High drop count"` → boost `vp` weight by 0.5 (prioritise dropsite control)
- `"Close-Action-heavy"` → boost `kill` weight when within 12" of enemies
- `"Command Ship present"` → boost `survival` weight for that group's options

---

### Validation Report

The builder returns a `validation` object alongside the fleet for logging/debugging:

```js
{
  valid: true,
  totalPts: 1498,
  targetPts: 1500,
  pctUsed: 0.999,
  dropPts: 405,
  dropPct: 0.270,   // informational — no rulebook constraint (see §6 above)
  hGroups: 1,       // ✓ heavyPts (e.g. 350) ≤ mediumPts (e.g. 700) — points-ratio rule
  cGroups: 0,       // ✓ ≤ 1
  rareNames: ['Lima Detector Frigate'],   // ✓ each appears once
  uniqueNames: [],
  warnings: []
}
```

If `valid: false`, the caller falls back to the pre-built quickplay fleet for the faction.

---

### Fleet Builder Phase (Implementation)

Add to **Phase A** of the implementation plan:

1. `src/ai/fleet-builder.js` — full builder with constraint validation
2. Integration in room creation: when `aiOpponent: true`, call `buildAiFleet` and store
   result as `room.state.importedFleets[aiSlot]` and `room.aiTactics`
3. Unit tests for each constraint (tonnage cap, Rare limit, drop % range)
4. Fallback: if builder fails after 20 retries, use the faction's first 10 cheapest groups
   that satisfy the drop requirement (guaranteed to produce a valid list)
