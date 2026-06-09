// State factory and fleet/scenario helpers.
// All functions that read or mutate state take `state` as their first parameter,
// making them safe to use in Node.js server contexts with multiple concurrent games.

import {
  FACTIONS, ASSET_PROFILES, INCH, BOARD_PX,
  LAYOUTS, DEPLOYMENTS, APPROACHES, VARIANTS, OBJECTIVES,
  DROPSITE_BASE
} from './constants.js';
import { rollD6 } from './rng.js';
import { FLEET_DB, findShipDef, applyHardpointOptions } from '../fleet/db.js';
import { parseNewRecruit } from '../fleet/parser.js';
import { FASTPLAY_LISTS } from '../fleet/fastplay/index.js';
import { APP_VERSION, RULEBOOK_VERSION, ERRATA_VERSION } from './version.js';

/* Build a per-side clone of a faction's fleet, giving each def a unique,
   side-prefixed id (e.g. 'ucm:u1') and the correct side. This prevents id
   collisions in mirror matches (same faction on both sides) and avoids mutating
   the shared module fleet constants.
   When an imported fleet is stored for this side's slot, uses db.js instead. */
export function buildSideFleet(state, side) {
  // slotForSide is null during setup (assigned at commitScenario); default to f1/f2.
  const slot = (state.slotForSide && state.slotForSide[side]) || (side === 'player1' ? 'f1' : 'f2');
  const imported = state.importedFleets && state.importedFleets[slot];
  if (imported && imported.faction && imported.groups && imported.groups.length) {
    return imported.groups.map((grp, i) => {
      const dbDef = findShipDef(imported.faction, grp.name);
      if (!dbDef) return null;
      const clone = Object.assign({}, dbDef);
      clone.name    = grp.name;
      clone.baseId  = 'imp' + i;
      clone.id      = side + ':imp' + i;
      clone.side    = side;
      clone.faction = imported.faction;
      clone.groupSize = grp.count;
      if (dbDef.weapons) clone.weapons = dbDef.weapons.map(w => Object.assign({}, w));
      if (dbDef.launch)  clone.launch  = dbDef.launch.map(l => Object.assign({}, l));
      applyHardpointOptions(clone, grp.options);
      return clone;
    }).filter(Boolean);
  }
  // Prefer fleetChoices (live setup selection) over factions (only set after commitScenario).
  const fk = (slot && state.fleetChoices && state.fleetChoices[slot])
    || (state.factions && state.factions[side])
    || (side === 'player1' ? 'ucm' : 'shaltari');

  // Fastplay: parse the New Recruit text file for this faction if available.
  const listText = FASTPLAY_LISTS[fk];
  if (listText && listText.trim()) {
    const parsed = parseNewRecruit(listText);
    if (parsed && parsed.groups && parsed.groups.length) {
      const fpFaction = parsed.faction || fk;
      return parsed.groups.map((grp, i) => {
        const dbDef = findShipDef(fpFaction, grp.name);
        if (!dbDef) return null;
        const clone = Object.assign({}, dbDef);
        clone.name      = grp.name;
        clone.baseId    = fk.slice(0, 3) + i;
        clone.id        = side + ':' + clone.baseId;
        clone.side      = side;
        clone.faction   = fpFaction;
        clone.groupSize = grp.count;
        if (dbDef.weapons) clone.weapons = dbDef.weapons.map(w => Object.assign({}, w));
        if (dbDef.launch)  clone.launch  = dbDef.launch.map(l => Object.assign({}, l));
        applyHardpointOptions(clone, grp.options);
        return clone;
      }).filter(Boolean);
    }
  }

  return [];
}

/* Resolve the active (cloned) fleet for a side. Built once per rebuild and
   cached on state so def identities are stable between renders. */
export function fleetForSide(state, side) {
  if (!state.activeFleets) state.activeFleets = {};
  if (!state.activeFleets[side]) state.activeFleets[side] = buildSideFleet(state, side);
  return state.activeFleets[side];
}
export function redFleet(state)  { return fleetForSide(state, 'player1'); }
export function blueFleet(state) { return fleetForSide(state, 'player2'); }

/* Display name of the faction occupying a colour slot ('player1'=red, 'player2'=blue). */
export function factionName(state, side) {
  const fk = state.factions && state.factions[side];
  return (fk && FACTIONS[fk]) ? FACTIONS[fk].name : (side === 'player1' ? 'Red' : 'Blue');
}

/* ── PAYLOAD / PORTER (Bioficer) helpers ──
   A Payload ship is attached to a Porter ship-slot via ship.attachedTo = {gid, si}.
   Attached payloads cannot activate / be targeted / be selected and are hidden
   from the board (they ride inside the Porter). */
export function fleetHasPayloads(fk) {
  return fk === 'bioficer';
}
export function sideHasPayloads(state, side) {
  const fk = state.factions && state.factions[side];
  return fleetHasPayloads(fk);
}
/* Are all Payload ship-slots of a chosen fleet slot ('f1'|'f2') assigned to a
   Porter? True if the fleet has no payloads, or every payload ship-slot has a
   link in state.payloadLinks[slot]. Used to gate scenario setup. */
export function payloadsReady(state, slot) {
  const fk = state.fleetChoices && state.fleetChoices[slot];
  if (!fleetHasPayloads(fk)) return true;
  const side = slot === 'f1' ? 'player1' : 'player2';
  const defs = fleetForSide(state, side);
  const links = (state.payloadLinks && state.payloadLinks[slot]) || {};
  let allAssigned = true;
  defs.forEach(def => {
    if (!def.payload) return;
    const n = def.groupSize || 1;
    for (let si = 0; si < n; si++) {
      if (!links[`${def.baseId}:${si}`]) allAssigned = false;
    }
  });
  return allAssigned;
}
/* Are BOTH chosen fleets' payloads assigned (so scenario setup may proceed)? */
export function allPayloadsReady(state) {
  return payloadsReady(state, 'f1') && payloadsReady(state, 'f2');
}
/* Individual Porter ship-slots on a side: [{gid, si, def}]. */
export function porterShips(state, side) {
  const out = [];
  fleetForSide(state, side).forEach(def => {
    if (!def.porter) return;
    const grp = state.groups[def.id];
    if (!grp) return;
    grp.ships.forEach((s, si) => { if (!s.destroyed) out.push({ gid: def.id, si, def, ship: s }); });
  });
  return out;
}
/* Individual Payload ship-slots on a side: [{gid, si, def, ship}]. */
export function payloadShips(state, side) {
  const out = [];
  fleetForSide(state, side).forEach(def => {
    if (!def.payload) return;
    const grp = state.groups[def.id];
    if (!grp) return;
    grp.ships.forEach((s, si) => { if (!s.destroyed) out.push({ gid: def.id, si, def, ship: s }); });
  });
  return out;
}
/* How much capacity a Porter ship-slot has used (sum of attached payload sizes). */
export function porterUsed(state, side, porterGid, porterSi) {
  let used = 0;
  payloadShips(state, side).forEach(p => {
    const a = p.ship.attachedTo;
    if (a && a.gid === porterGid && a.si === porterSi) used += 1; // S-1 payloads each take 1
  });
  return used;
}
/* Is this payload ship currently attached (riding inside a Porter)? */
export function payloadAttached(ship) { return !!ship.attachedTo; }

/* Detached payload ships of a side that are within 3" of `porterShip` and match
   the Porter's size letter — eligible to be reattached. Returns [{def,si,ship}]. */
export function detachedReattachCandidates(state, side, porterShip, porterSize) {
  if (!porterShip) return [];
  return payloadShips(state, side).filter(p => {
    if (p.ship.attachedTo || p.ship.offTable || p.ship.destroyed) return false;
    if ((p.def.payload.size) !== porterSize) return false;
    return Math.hypot(p.ship.x - porterShip.x, p.ship.y - porterShip.y) <= 3 * INCH + 2;
  });
}

/* Sync attached payloads with their Porter: if the Porter ship is destroyed,
   any payload still attached to it is destroyed too (14.1.11). */
export function syncPayloads(state) {
  ['player1', 'player2'].forEach(side => {
    payloadShips(state, side).forEach(p => {
      const a = p.ship.attachedTo;
      if (a) {
        const porGrp = state.groups[a.gid];
        const porShip = porGrp && porGrp.ships[a.si];
        if (!porShip || porShip.destroyed) { p.ship.destroyed = true; p.ship.attachedTo = null; }
      } else if (!p.ship.destroyed && !p.ship.offTable) {
        // Detached payloads always follow General Quarters.
        p.ship.order = 'GQ';
      }
    });
  });
}

export function keyByD6(table, d6) { return Object.keys(table).find(k => table[k].d6 === d6); }

/* Generate a full scenario (rolls keys for each table). Pass overrides to lock rolls. */
export function generateScenario(rng, overrides = {}) {
  return {
    deployment: overrides.deployment || keyByD6(DEPLOYMENTS, rollD6(rng)),
    approach:   overrides.approach   || keyByD6(APPROACHES,  rollD6(rng)),
    layout:     overrides.layout     || keyByD6(LAYOUTS,     rollD6(rng)),
    variant:    overrides.variant    || keyByD6(VARIANTS,    rollD6(rng)),
    objective:  overrides.objective  || keyByD6(OBJECTIVES,  rollD6(rng) || 1) // objectives are 1–6; never 'standard' from roll
  };
}

/* Apply scenario to produce concrete dropsites + features for the board. */
export function buildScenarioState(scen) {
  const layout = LAYOUTS[scen.layout];
  const variant = VARIANTS[scen.variant];
  const result = variant.apply(layout.dropsites, scen.deployment);
  const dropsites = result.dropsites.map(d => {
    const base = DROPSITE_BASE[d.type];
    const features = [...(result.features[d.id] || []), ...(d.layoutFeatures || [])];
    return {
      id: d.id,
      type: d.type,
      base,
      x: d.x,         // inches from top-left
      y: d.y,
      features,
      damage: 0,
      maxHull: base.hull,
      ...(d.siteRules ? { siteRules: d.siteRules } : {})
    };
  });
  // Resolve scenery target counts (a count may be a range like '4-6' → take max).
  const parseCount = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.includes('-')) return parseInt(v.split('-')[1]);
    return parseInt(v) || 0;
  };
  const sc = layout.scenery || {};
  const bonus = result.scenery || {};
  const sceneryTargets = {
    micrometeor: parseCount(sc.micrometeor) + (bonus.micrometeorBonus || 0),
    dense:       parseCount(sc.dense)       + (bonus.denseBonus || 0)
  };
  return {
    dropsites,
    rings: layout.rings || [],
    largeObjects: layout.largeObjects || [],
    focalPoints: layout.focalPoints || [],
    scenery: layout.scenery,
    sceneryBonus: result.scenery || {},
    sceneryTargets,         // {micrometeor, dense} — how many to place
    placedScenery: [],      // [{type, x, y, angle}] — player-placed clouds/fields
    variantNote: result.note || null
  };
}

/* Factory — returns a fresh game state object. */
export function createState() {
  return {
    appVersion:      APP_VERSION,
    rulebookVersion: RULEBOOK_VERSION,
    errataVersion:   ERRATA_VERSION,
    phase: 'setup',      // 'setup' | 'scenery' | 'nominations' | 'deploy' | 'play'
    round: 1,
    selectedGroupId: null,
    selectedShipIdx: null,
    selectedDropsiteId: null,
    hoverPoint: null,    // {x,y} during move targeting
    sceneryPlace: null,  // {type:'micrometeor'|'dense', angle} — active scenery-placement tool
    aiming: null,        // {gid, si, mode:'deploy'|'vectored'|'course_change', originHeading, remainingMove}
    vectoredSecondMove: null, // {gid, si, remaining} — awaiting Vectored's second move click
    layerToggle: false,  // pending layer change for the selected ship's next move
    launching: null,     // {gid, si, type, name, auraIn} — active launch-targeting mode
    launchedAssets: [],  // [{kind:'fighter_bomber', side, x, y}] — placed asset markers
    battalionDeploy: null, // {side, count, dsId, asset} — pending battalion drop-location pick
    assetPhase: null,    // {log, resolved} — Asset Phase modal state at round end
    battalionCombat: null, // guided battalion-combat sequence state
    dropsiteActivation: null, // {side, done:[]} — end-of-Activation Dropsite Activation step
    initiativeHolder: null, // 'player1'|'player2' — who held 1st initiative this round
    initiative: null,    // {red, blue, winner, holder, round} — start-of-round initiative roll
    activeSide: null,    // 'player1' | 'player2' — whose turn it is to activate a Group
    assetMove: null,     // {id, count} — selected launched asset being moved (Asset Combat)
    assetActiveSide: null, // side currently activating an asset (alternates by initiative)
    _assetId: 0,         // counter for stable launched-asset ids
    factions: { player1: 'ucm', player2: 'shaltari' }, // chosen faction per slot (red=player1, blue=player2)
    playerNames: { f1: 'Player 1', f2: 'Player 2' }, // editable display names per fleet slot
    playerColors: { f1: null, f2: null },            // chosen colour key per fleet slot (null = unassigned)
    sideColors: null,                                 // { player1: colorKey, player2: colorKey } — set at commitScenario
    deployChoice: 'random',                           // 'random' | 'red_north' | 'red_south' — pins deploy sides at commit (player1=Red)
    deployZone: null,                                 // { player1: 'north'|'south', player2: 'south'|'north' } — set at commitScenario
    slotForSide: null,                                // { player1: 'f1'|'f2', player2: 'f1'|'f2' } — set at commitScenario
    fleetChoices: { f1: null, f2: null }, // picker selections (randomised to slots at commit)
    importedFleets: { f1: null, f2: null }, // {faction, admiralLevel, groups:[{name,count,pts}], secondaries:[]} from New Recruit import
    admiralChoice: { f1: 0, f2: 0 },      // admiral Level per fleet slot (0 = no admiral)
    secondaryChoice: { f1: [], f2: [] },  // chosen Secondary Objective keys per fleet slot
    admiralLevel: { player1: 0, player2: 0 },    // admiral Level per side (set at commit)
    planning: null,                       // {ap:{player1,player2}, passTokens:{player1,player2}} for the round
    score: { player1: { vp: 0, kp: 0 }, player2: { vp: 0, kp: 0 } }, // victory + kill points
    secondaries: { player1: [], player2: [] }, // chosen Secondary Objective keys per side
    secondaryNominations: { player1: {}, player2: {} }, // position-based secondary nominations
    shipReconOps: {},      // ship key → Recon Operatives carried (Extract objective)
    reconKills: { player1: 0, player2: 0 }, // enemy operative-carriers destroyed
    nominationPhase: false,   // true when secondary nominations are needed (gates setNomination)
    nominationsReady: { player1: false, player2: false }, // per-side confirmNominations barrier
    protectNomReady: { player1: false, player2: false },  // per-side confirmProtectNom barrier
    setupReady: { player1: false, player2: false },       // per-side readySetup barrier
    sceneryReady: { player1: false, player2: false },     // per-side commitScenery barrier
    captured: { player1: 0, player2: 0 },      // points of captured enemy ships
    admiralKilled: { player1: false, player2: false }, // was this side's admiral killed
    scoredRounds: [],                     // standard-scoring rounds already awarded
    scoreLog: [],                         // structured VP award history {round,side,vp,reason}
    lastScoring: null,                    // most recent R4/R6 standard-scoring breakdown
    gameOver: null,                       // end-of-game summary
    payloadAssign: null, // {slot:'f1'|'f2'} — open Payload→Porter modal for a chosen fleet
    payloadLinks: { f1: {}, f2: {} }, // per-fleet-slot: { '<payloadBaseId>:<si>': '<porterBaseId>:<si>' }
    payloadDetach: null, // {gid, si, porterGid, porterSi} — placing a detached payload
    payloadReattach: null, // {porterGid, porterSi} — picking a payload within 3" to reattach
    deployDone: { player1: false, player2: false }, // explicit "finished deploying" flag per side
    targeting: null,       // {gid, si, wi} — assigning weapon wi of ship (gid,si) to a target
    attackModal: null,     // multi-step attack resolution state
    repairPhase: null,     // End-Phase repair (Fire damage + crippling repair rolls)
    featureAttack: null,   // {dsId, fi, side} — dropsite feature weapon awaiting a target
    extracting: null,      // {gid, si} — ship in Extract-targeting mode (Extract objective)
    eventLog: [],          // {round, text, ts} game-event log entries (newest last)
    logExpanded: false,    // event-log panel expanded (scrollable) vs collapsed (last 3)
    detector: null,        // {gid, si, wi} — Detector weapon awaiting an enemy LoS target
    antiWing: null,        // {gid, si, wi} — Anti-Wing weapon awaiting an enemy Wing target
    activeFleets: null,  // {player1:[...clonedDefs], player2:[...clonedDefs]} — built by rebuildFleets
    sceneryTurn: null,   // 'player1'|'player2' — whose turn to place scenery (null = unrestricted)
    scenario: null,      // generated by scenario gen (see SCENARIO_TABLES)
    dropsites: [],       // [{id,x,y,size:'S'|'M'|'L',type:'station'|'city',hull,maxHull,name}]
    groundLaunchLines: [], // [{fromGid, fromSi, dsId, side}] — drawn each round, cleared by advanceRound
    groups: {}           // groupId → { order, spikes, activated, ships:[...], moveTrail:[] }
  };
}

/* Initial positions — UCM on south edge, Shaltari on north edge.
   Spread out across the deployment line. */
export function initFleet(state, fleet, side) {
  fleet.forEach((def, gi) => {
    // def is already a per-side clone with .side and a unique .id set.
    const groupSize = def.groupSize || 1;
    const ships = [];
    // distribute along the deployment edge:
    // player1 south: y = BOARD_PX - 30, heading = -90 (pointing up / north)
    // player2 north: y = 30, heading = 90 (pointing down / south)
    const baseY = side === 'player1' ? BOARD_PX - 30 : 30;
    const heading = side === 'player1' ? -90 : 90; // -90 = up, 90 = down (SVG +y is down)
    // x distribution per side — spread groups left-to-right
    const sideFleet = fleet;
    const idx = sideFleet.indexOf(def);
    const totalGroups = sideFleet.length;
    const slot = (idx + 0.5) / totalGroups;
    const baseX = slot * BOARD_PX;
    // distribute ships within a group along a small arc on x
    for (let i = 0; i < groupSize; i++) {
      const offset = (i - (groupSize - 1) / 2) * 14;
      ships.push({
        x: baseX + offset,
        y: baseY,
        heading: heading, // degrees, 0 = +x (right), 90 = +y (down)
        hull: def.hull,
        maxHull: def.hull,
        destroyed: false,
        movedThisRound: false,
        layer: 'orbit',   // 'orbit' | 'atmosphere' — all ships deploy in Orbit
        launchedThisRound: 0  // count of fighters/bombers launched this round
      });
    }
    state.groups[def.id] = {
      def: def,
      order: null,
      spikes: 0,
      activated: false,
      ships: ships,
      moveTrail: [],
      leadShipIdx: 0   // nominated lead ship (weapons range/arcs, launching assets)
    };
  });
}

/* (Re)build all groups from the currently-selected factions. */
export function rebuildFleets(state) {
  state.activeFleets = {}; // force fresh clones for the chosen factions
  state.groups = {};
  initFleet(state, redFleet(state), 'player1');
  initFleet(state, blueFleet(state), 'player2');
}

// All currently-active defs combined for lookup.
export function allDefs(state) { return [...redFleet(state), ...blueFleet(state)]; }
export function getDef(state, id) { return allDefs(state).find(d => d.id === id); }
export function getGroup(state, id) { return state.groups[id]; }

export function assetProfile(state, side, kind) {
  const fk = state.factions && state.factions[side];
  const tbl = ASSET_PROFILES[fk] || ASSET_PROFILES['ucm'];
  return tbl[kind] || tbl.bomber;
}
/* Thrust for an asset entry — resolves the faction from its side slot. */
export function assetThrust(state, asset) {
  return assetProfile(state, asset.side, asset.kind).thrust || 10;
}
/* Fighter re-rolls (Close Protection) for a side. */
export function fighterRerolls(state, side) {
  return (assetProfile(state, side, 'fighter').rerolls) || 0;
}

