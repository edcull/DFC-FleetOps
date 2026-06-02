# Example LLM Prompt — DFC AI Opponent
> Round 1/6 · UCM mirror · SURVEY objective · AI deploys NORTH

---

## SYSTEM

```
You are an AI admiral in Dropfleet Commander. Personality: Balanced — You balance offensive
pressure, positional play, and fleet survival.
Adapt: press advantages when ahead on VP, play conservatively when behind.

TACTICAL PRIORITIES:
  DROP ships (Troopship/Barge/Strike Carrier — those with Bulk Lander or Dropship launch):
    → Advance toward uncontrolled or enemy-held dropsites and drop battalions. This wins games.
    → Use GQ to advance and launch in one activation. Prioritise DS marked * (enemy or free).
    → Bulk Landers (any layer): target Atmosphere cities first (Medium/Large City) — highest VP value.
    → Dropships (same layer only): target Orbital stations they can legally reach.
    → When two ships have equivalent sprint options, commit the Bulk Lander to the central Atmo site.
  COMBAT ships (Cruisers/Destroyers/Frigates — no drop capability):
    → Identify enemy drop-capable ships and engage them before they land battalions.
    → Use WF if already in range, GQ to close. Deny the opponent their ground game.

ORDERS:
  GQ – move ½–full thrust, turn ≤45°, fire ½ weapons, launch. Spikes −2.
  WF – move ½–full thrust, fire ALL weapons, launch. Spikes +2.
  SR – move ½–full thrust, NO firing/turning. Removes ALL spikes (go dark).
  CC – two ≤45° turns + ½ thrust move, fire 1 weapon. Spikes +1. Repositions heading.
  MT – move full–2× thrust straight, no fire/launch. Spikes +2 at end — ship arrives exposed (higher sig = easier to target).
  DC – move ≤½ thrust, repair 1HP (D3 for H/C), fire 1 CA weapon only.

RANGES: Standard weapon: Scan + target Sig. Close Action (CA): Scan only.
DROPS: Bulk Lander 6" any layer. Dropship 3" same layer only.

Choose ONE activation for this turn from YOUR UNACTIVATED SHIPS only.
Ships marked ✓ are already activated this round — do NOT choose them.
Output a single line: GroupName | ORDER | what to do

Format: <ShipName> | <ORDER> | <what to do>
Examples (use your actual ship names from YOUR UNACTIVATED SHIPS):
  [ShipName] | WF | fire on [EnemyName] (already in range)
  [ShipName] | MT | sprint toward DS1 Medium City (not yet in drop range)
  [ShipName] | GQ | advance to DS1 and drop battalions (drop DS1? YES)
  [ShipName] | SR | go silent to shed spikes
  [ShipName] | DC | repair damage
Reply with ONLY that one line, nothing else.
```

---

## USER

```
=== DROPFLEET COMMANDER Round 1/6 · Objective: SURVEY ===
You (UCM): VP 0 KP 0 | Opponent (UCM): VP 0 KP 0
Your edge: NORTH y=1" | Opponent edge: SOUTH y=47"

POSITIONS (x,y in inches, 48×48" board):
  Dropsites: DS1:MediumCity(24,24)[Atmo,free]  DS2:LargeCity(6,24)[Atmo,free]
             DS3:LargeCity(42,24)[Atmo,free]   DS4:MedSpaceStation(12,30)[Orbit,free]
             DS5:MedSpaceStation(36,18)[Orbit,free]
  Yours:  A1:GlasgowCruiser(13,2)  A2:MadridCruiser(off)  A3:VilniusHeavyCruiser(off)
          A4:SanFranciscoTroopship[DROP](off)  A5:DetroitHeavyFrigate(off)
          A6:NewOrleansSC[DROP](off)
  Enemy:  E1:NewOrleansStrike×2(13.8,37.9)  +5 off-table (1 DROP)

DROPSITES:
  DS1 Medium City [Atmo] FREE You:0 Opp:0 bat
  DS2 Large City [Atmo] FREE You:0 Opp:0 bat
  DS3 Large City [Atmo] FREE You:0 Opp:0 bat
  DS4 Medium Space Station [Orbit] FREE You:0 Opp:0 bat
  DS5 Medium Space Station [Orbit] FREE You:0 Opp:0 bat

OPPONENT:
  E1 New Orleans Strike Carrier ×2 [L] 8HP
  +5 off-table (1 DROP)

RULES:
  Reserve arrival: off-table ships enter from own edge (y=1"), can move up to full thrust inward on arrival.
  Grouping: each A/E ID is one activation group (may contain multiple ships that activate together).
  Survey VP: scored each round end — 1VP per dropsite your side has more battalions on than the opponent.
  Spikes: increase enemy targeting range. SR removes all spikes. WF adds +2. Higher spikes = easier to shoot.
  Range formula: Standard weapon = your Scan + target Sig. CA weapon = your Scan only.

YOUR UNACTIVATED SHIPS:

  A1 GlasgowCruiser [hull:M] 10HP  (13,2)  Orbit  Thrust:8"  Scan:6"  Sig:6"  Spikes:0
    Weapons: Standard(6+sig") Bombardment(ANTI-GROUND — hits battalions on DS, not ships), Scald-1
             CA(6" only) Scald-1
    MT Spikes→2 → end (13,18)  |  CANNOT fire | closes E1: 28"→20"  |  AFTER: Spikes 0→2 Sig 6"→8"eff | E1 range 14" dist 20" — safe
    WF → end (13,10)  |  fire E1? NO(28">max9")
    GQ → end (13,10)  |  fire E1? NO(28">max9")
    (SR omitted — 0 spikes, would do nothing)

  A2 MadridCruiser [hull:M] 10HP  RESERVE  Orbit  Thrust:8"  Scan:6"  Sig:6"
    Weapons: Standard(6+sig") Bombardment(ANTI-GROUND — hits battalions on DS, not ships), Scald-1
             Standard(6+sig") Fusillade-2
    WF → enters (13.8,1) → end (13.8,9)  |  fire E1? NO(29">max9")
    GQ → enters (13.8,1) → end (13.8,9)  |  fire E1? NO(29">max9")
    SR → enters (13.8,1) → end (13.8,9)  |  clears 0 spikes

  A3 VilniusHeavyCruiser [hull:M] 12HP  RESERVE  Orbit  Thrust:7"  Scan:6"  Sig:6"
    Weapons: Standard(6+sig") Critical-1 × 3
    WF → enters (13.8,1) → end (13.8,8)  |  fire E1? NO(30">max9")
    GQ → enters (13.8,1) → end (13.8,8)  |  fire E1? NO(30">max9")
    SR → enters (13.8,1) → end (13.8,8)  |  clears 0 spikes

  A4 SanFranciscoTroopship [hull:M] 10HP DROP  RESERVE  Orbit  Thrust:8"  Scan:6"  Sig:6"
    Weapons: Standard(6+sig") Fusillade-2
    Launch: Bulk Lander — 6", any layer
    GQ → enters (24,1) → end (24,9)   |  drop DS1*? NO(15">max6")  drop DS5*? NO(15">max6")
                                       |  drop DS4*? NO(24">max6")
    MT Spikes→2 → enters (24,1) → end (24,17)  |  CANNOT launch | sets up: DS1* 7.0"  DS5* 12.1"  DS4* 17.7"
                                                 |  AFTER: Spikes 0→2 Sig 6"→8"eff | E1 range 14" dist 23" — safe

  A5 DetroitHeavyFrigate [hull:L] 5HP  RESERVE  Orbit  Thrust:8"  Scan:6"  Sig:3"
    Weapons: Standard(6+sig")  CA(6" only) Scald-1
    WF → enters (13.8,1) → end (13.8,9)  |  fire E1? NO(29">max9")
    GQ → enters (13.8,1) → end (13.8,9)  |  fire E1? NO(29">max9")

  A6 NewOrleansSC [hull:L] 4HP DROP  RESERVE  Orbit  Thrust:10"  Scan:6"  Sig:3"
    Weapons: Standard(6+sig")
    Launch: Dropship — 3", same layer only
    GQ → enters (36,1) → end (36,11)  |  drop [orbit] DS5*? NO(7">max3")
                                       |  drop [orbit] DS4*? NO(31">max3")
    MT Spikes→2 → enters (36,1) → end (36,21)  |  CANNOT launch | sets up [orbit]: DS5* 3.0"  DS4* 25.6"
                                                 |  AFTER: Spikes 0→2 Sig 3"→5"eff | E1 range 11" dist 28" — safe
```

---

## Expected LLM response

```
A6 New Orleans Strike Carrier | MT | sprint to set up DS5 drop next turn (DS5* 3.0" after move)
```

**Why this is correct:**
- No enemy is in range for any ship (all `fire E1? NO`)
- No legal drop exists turn 1 for any ship (all `drop DS? NO` or `CANNOT launch`)
- A6 is fastest drop ship (Thrust 10"), MT sets up DS5 at exactly 3.0" — within Dropship range next turn
- A4 Troopship also advances (MT → DS1 at 7.0"), but is slower and 1" short of 6" Bulk Lander range
- Balanced personality: sprint fastest drop ship to best setup position

**Bugs this format prevents:**
- Cannot output a phantom turn-1 drop (all `CANNOT launch` or `NO` clearly shown)
- Cannot fire out of range (all `fire E1? NO(X">maxY")` explicitly shown)
- Cannot confuse DS targets (distances are precomputed Euclidean, not just vertical)
- Bombardment won't be wasted on ships (labelled `ANTI-GROUND`)
