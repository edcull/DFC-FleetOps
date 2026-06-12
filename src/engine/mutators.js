// Pure game-logic mutators and read-only helpers.
// No DOM calls — rendering is the caller's responsibility.

import { FEATURES, ORDERS, INCH, BOARD_PX, BOARD_IN, ASSET_PROFILES, DROPSITE_BASE, DEPLOYMENTS, APPROACHES, SECONDARY_OBJECTIVES, OBJECTIVES, FOCAL_HIGH, FOCAL_LOW, LAYOUTS } from './constants.js';
import { rollD6, rollDie } from './rng.js';
import { fleetForSide, redFleet, blueFleet, factionName, payloadShips, porterShips, allDefs, getDef, getGroup, assetProfile, assetThrust, fighterRerolls, rebuildFleets, buildScenarioState } from './state.js';

const inchToPx = v => v * INCH;

function shipBaseRadiusPx(def) {
  const diameterIn = { 'L': 30/25.4, 'M': 40/25.4, 'H': 50/25.4, 'C': 60/25.4 }[def.tonnage] || 30/25.4;
  return (diameterIn * INCH) / 2;
}

// ── GEOMETRY AND TARGETING ──

export function headingVec(h) {
  const r = h * Math.PI / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
}

/* Heading (deg) from a ship at (sx,sy) toward a point (px,py). */
export function headingToward(sx, sy, px, py) {
  return Math.atan2(py - sy, px - sx) * 180 / Math.PI;
}

/* Smallest signed angle (deg) from a→b, in range (-180, 180]. */
export function angleDelta(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/* Clamp a desired heading to within ±limitDeg of an origin heading. */
export function clampHeading(origin, desired, limitDeg) {
  const d = angleDelta(origin, desired);
  const clamped = Math.max(-limitDeg, Math.min(limitDeg, d));
  return origin + clamped;
}

/* Half-widths (deg) of each arc letter relative to the ship's heading centre. */
export function arcWedges(arcStr) {
  // Returns [{centre, half}] offsets relative to heading.
  const out = [];
  arcStr.split('/').map(s => s.trim()).forEach(c => {
    if (c === 'F') out.push({ centre: 0, half: 45 });
    else if (c === 'R') out.push({ centre: 180, half: 45 });
    else if (c === 'S' || c === 'B') { out.push({ centre: 90, half: 45 }); out.push({ centre: -90, half: 45 }); }
    else if (c === 'FN') out.push({ centre: 0, half: 11.25 });
    else if (c === 'RN') out.push({ centre: 180, half: 11.25 });
  });
  return out;
}

/* Is point (px,py) within a weapon's firing arc from the ship? */
export function pointInWeaponArc(ship, w, px, py) {
  const wedges = arcWedges(w.arc);
  if (!wedges.length) return true; // arcless (e.g. LoS) — treat as all-round
  const bearing = headingToward(ship.x, ship.y, px, py);
  return wedges.some(wg => Math.abs(angleDelta(ship.heading + wg.centre, bearing)) <= wg.half + 0.5);
}

/* Effective scan (inches) of a ship — 1" if Scanners Offline crippling. */
export function effectiveScan(def, ship) {
  if (ship && ship.crippling && ship.crippling.includes('scanners')) return 1;
  return def.scan;
}

/* Maximum move distance (PIXELS) for a ship under an order, honouring the
   Navigation Offline crippling effect (total movement → 2", no thrust scaling). */
export function effectiveMaxMovePx(def, ship, order) {
  const o = ORDERS[order] || { moveMax: 0 };
  if (ship && ship.crippling && ship.crippling.includes('navigation')) return 2 * INCH;
  // Arrest-X: this ship's Thrust is reduced by X" during its next activation.
  const thrust = Math.max(0, def.thrust - (ship && ship.arrestNext ? ship.arrestNext : 0));
  return o.moveMax * thrust * INCH;
}

/* Targeting range in PIXELS = attacker Scan + (target Signature + target Spikes×3").
   Scenery on the LoS line can cause the target's Spikes (and, for Debris, Signature)
   to be ignored. */
export function targetingRangePx(state, attackerDef, targetDef, targetShip, targetGrp, attackerShip, w) {
  // Close Action weapons target only within the attacker's Scan range (Sig & Spikes
  // give the target no extra "visibility" range against Close Action).
  if (w && /Close Action/i.test(w.special || '')) {
    return effectiveScan(attackerDef, attackerShip) * INCH;
  }
  let spikes = (targetGrp ? (targetGrp.spikes || 0) : 0) + (targetShip.spikes || 0);
  let sig = targetShip.sigSilent ? 0 : (targetDef.sig || 0);
  if (attackerShip) {
    const eff = sceneryAttackEffects(state, attackerShip.x, attackerShip.y, targetShip.x, targetShip.y, attackerShip, targetShip);
    if (eff.ignoreSpikes) spikes = 0;
    if (eff.ignoreSig) sig = 0;
  }
  const sigIn = sig + spikes * 3;
  return (effectiveScan(attackerDef, attackerShip) + sigIn) * INCH;
}

/* Can a weapon legally target a given enemy ship right now?
   Checks: orbital layer rules, weapon arc, Scan+Sig(+spikes) range, and that a
   Large Object does not block Line of Sight. */
export function weaponCanTarget(state, attackerDef, attackerShip, w, targetDef, targetShip, targetGrp) {
  if (targetShip.destroyed || targetShip.offTable || targetShip.attachedTo) return false;
  const aLayer = attackerShip.layer || 'orbit', tLayer = targetShip.layer || 'orbit';
  if (aLayer !== tLayer) {
    // Orbit → Atmosphere: always allowed (−1 Lock vs non-Descent; 6+ vs Descent — applied at hit resolution).
    // Atmosphere → Orbit: only allowed with Escape Velocity (Close Action).
    const orbitToAtmo = aLayer === 'orbit' && tLayer === 'atmosphere';
    const atmoToOrbit = aLayer === 'atmosphere' && tLayer === 'orbit';
    const escapeVel = /Escape Velocity/i.test(w.special || '');
    if (!orbitToAtmo && !(atmoToOrbit && escapeVel)) return false;
  }
  if (!pointInWeaponArc(attackerShip, w, targetShip.x, targetShip.y)) return false;
  // Large Objects block Line of Sight (unless both ends in atmosphere).
  const eff = sceneryAttackEffects(state, attackerShip.x, attackerShip.y, targetShip.x, targetShip.y, attackerShip, targetShip);
  if (eff.blocked) return false;
  const range = targetingRangePx(state, attackerDef, targetDef, targetShip, targetGrp, attackerShip, w);
  if (Math.hypot(targetShip.x - attackerShip.x, targetShip.y - attackerShip.y) > range) return false;
  return true;
}

/* How many weapons a ship may fire this activation, given its effective Order. */
export function fireLimit(order, def) {
  if (!order || !ORDERS[order]) return 0;
  const fr = ORDERS[order].fireRule;
  const total = (def.weapons || []).length;
  // Stealth: this Ship may fire ONE Weapon while on Silent Running.
  if (order === 'SR' && /Stealth/i.test(def.special || '')) return 1;
  if (fr === 'none') return 0;
  if (fr === 'all') return total;
  if (fr === 'half') return Math.ceil(total / 2);
  if (fr === 'one') return 1;
  if (fr === 'one-CA') return 1; // one Close Action weapon
  return 0;
}

/* Fire-slot cost of firing weapon wi: High Power = 2 off Weapons Free, else 1. */
export function weaponSlotCost(def, wi, order) {
  const sp = parseWeaponSpecials(def.weapons[wi]);
  if (sp.highPower && order !== 'WF') return 2;
  return 1;
}

/* Grouping key: Linked-X / Alt-X weapons of the same value count as one Weapon. */
export function weaponGroupKey(def, wi) {
  const sp = parseWeaponSpecials(def.weapons[wi]);
  if (sp.linked) return 'L:' + sp.linked;
  if (sp.alt) return 'A:' + sp.alt;
  return 'W:' + wi;
}

/* All weapon indices that fire together with wi (Linked-X partners share a trigger). */
export function linkedPartners(def, wi) {
  const sp = parseWeaponSpecials(def.weapons[wi]);
  if (!sp.linked) return [wi];
  const out = [];
  def.weapons.forEach((w, i) => { const s = parseWeaponSpecials(w); if (s.linked === sp.linked) out.push(i); });
  return out;
}

/* Total fire-slot cost of a ship's locked weapons: Linked/Alt groups count once,
   High Power double (off WF), Low Power is free when a Close Action weapon also fires. */
export function lockedWeaponCost(def, ship, order) {
  const locked = Object.keys(ship.weaponTargets || {}).map(n => parseInt(n));
  const seen = new Set();
  let cost = 0;
  locked.forEach(wi => {
    const sp = parseWeaponSpecials(def.weapons[wi]);
    const gk = weaponGroupKey(def, wi);
    if (seen.has(gk)) return;
    seen.add(gk);
    if (sp.lowPower) return; // Low Power is a free extra (allowed alongside a CA weapon)
    cost += weaponSlotCost(def, wi, order);
  });
  return cost;
}

/* Is this ship a Capital Ship (Medium tonnage or larger) — subject to Crippling? */
export function isCapital(def) { return ['M', 'H', 'C'].includes(def.tonnage); }

/* Explosion range (inches) by tonnage. */
export function explosionRangeIn(def) { return def.tonnage === 'C' ? 9 : def.tonnage === 'H' ? 6 : 3; }

/* Parse a Lock value like "3+" → 3. */
export function lockVal(w) { return parseInt(String(w.lock).replace('+', '')) || 7; }

/* Parse a save like "4+" → 4, "—" → null (no save). */
export function saveVal(s) { if (!s || s === '—') return null; return parseInt(String(s).replace('+', '')) || null; }

/* Maximum Spikes a Group may hold. Default 4; Cloak-X lowers it to X. */
export function spikeCap(def) {
  const m = (def && def.special || '').match(/Cloak-(\d)/i);
  return m ? parseInt(m[1]) : 4;
}

/* Add n Spikes to a Group, respecting its (possibly Cloak-reduced) cap. */
export function addGroupSpikes(grp, def, n) {
  grp.spikes = Math.min(spikeCap(def), (grp.spikes || 0) + n);
}

export function addShipSpikes(ship, def, n) {
  ship.spikes = Math.min(spikeCap(def), (ship.spikes || 0) + n);
}

export function parseWeaponSpecials(w) {
  const sp = (w.special || '');
  const num = (re) => { const m = sp.match(re); return m ? parseInt(m[1]) : 0; };
  return {
    scald:       num(/Scald-(\d)/i),
    reave:       num(/Reave-(\d)/i),
    burnthrough: num(/Burnthrough-(\d)/i),
    critical:    num(/Critical-(\d)/i),
    flash:       num(/Flash-(\d)/i),
    bloom:       num(/Bloom-(\d)/i),
    fusillade:   num(/Fusillade-(\d)/i),
    penetrator:  /Penetrator/i.test(sp),
    focused:     /Focused/i.test(sp),
    closeAction: /Close Action/i.test(sp),
    mauler:      /Mauler/i.test(sp),
    antiWing:    /Anti.?Wing/i.test(sp),
    crippling:   /Crippling/i.test(sp),
    calibre:     (sp.match(/Calibre-([HMCL/]+)/i) || [])[1] || null,
    status:      /Status/i.test(sp),
    volley:      num(/Volley-(\d)/i),
    overcharge:  /Overcharge/i.test(sp),
    corruptor:   num(/Corruptor-(\d)/i),
    arrest:      num(/Arrest-(\d)/i),
    impel:       num(/Impel-(\d)/i),
    sustained:   /Sustained Fire/i.test(sp),
    highPower:   /High Power/i.test(sp),
    lowPower:    /Low Power/i.test(sp),
    linked:      (sp.match(/Linked-([A-Za-z0-9]+)/i) || [])[1] || null,
    limited:     num(/Limited-(\d)/i),
    alt:         (sp.match(/\bAlt-([A-Za-z0-9]+)/i) || [])[1] || null
  };
}

/* Save value (number) a hit uses against a given damage type for a target.
   When shieldUp, the Shield Save replaces ES/KS and applies to E/K/C alike,
   ignoring modifiers to ES/KS (returns {v, shielded}). Otherwise applies the
   Defence-Systems-Offline crippling (−1 / worse). Returns null v = no save. */
export function baseSaveForType(td, ts, type, shieldUp) {
  // Full Shield-X: a raised Shield replaces ES & KS and saves vs E, K, and Core,
  // ignoring any ES/KS modifiers.
  if (shieldUp && shieldSaveVal(td)) return shieldSaveVal(td);
  let v;
  if (type === 'E') v = saveVal(td.es);
  else if (type === 'K') v = saveVal(td.ks);
  else v = null; // Core has no save without a Shield
  if (v != null && ts.crippling && ts.crippling.includes('defence')) v = v + 1; // worse
  return v;
}

export function hasShields(def) { return /Shield-?\d?/i.test(def.special || ''); }
export function shieldSaveVal(def) { const m = (def.special||'').match(/Shield-?(\d)/i); return m ? parseInt(m[1]) : null; }

/* Is `side` controlled by the AI (so it never declares Shields manually)? */
export function aiControlsSide(state, side) {
  const ai = state.aiSide;
  return ai === 'both' || ai === side;
}

/* Should an AI defender raise its Shield against this weapon? A raised Shield replaces ES/KS,
   ignores their modifiers (Scald/Burnthrough/Reave), and is the only save vs Core — for the cost
   of +1 Spike. Raise it when it matches or beats the (modifier-worsened) armour save, or when the
   weapon deals/【via Penetrator】can deal Core damage. */
export function shieldsWorthRaising(td, ts, w) {
  const shield = shieldSaveVal(td);
  if (shield == null) return false;
  const sp = parseWeaponSpecials(w);
  if (w.type === 'C' || sp.penetrator) return true; // Core (or Penetrator crits) → Shield is the only save
  const armor = w.type === 'E' ? saveVal(td.es) : w.type === 'K' ? saveVal(td.ks) : null;
  if (armor == null) return true;
  const worsened = Math.min(6, armor + (sp.scald || 0) + (sp.burnthrough || 0)
    + ((ts.crippling && ts.crippling.includes('defence')) ? 1 : 0));
  return shield <= worsened;
}

/* Find an enemy ship (relative to attackerSide) whose marker contains the point. */
export function enemyShipAtPoint(state, attackerSide, pt) {
  let best = null, bestD = Infinity;
  Object.keys(state.groups).forEach(gid => {
    const def = getDef(state, gid);
    if (!def || def.side === attackerSide) return;
    const grp = state.groups[gid];
    grp.ships.forEach((s, si) => {
      if (s.destroyed || s.offTable || s.attachedTo) return;
      const d = Math.hypot(s.x - pt.x, s.y - pt.y);
      if (d < bestD && d < 16) { bestD = d; best = { gid, si, def, ship: s, grp }; }
    });
  });
  return best;
}

/* Enemy ships within 1" (base contact) of a point, for bomber attacks. */
export function enemyShipsInBaseContact(state, side, x, y) {
  const out = [];
  Object.keys(state.groups).forEach(gid => {
    const def = getDef(state, gid);
    if (!def || def.side === side) return;
    state.groups[gid].ships.forEach((s, si) => {
      if (s.destroyed || s.offTable || s.attachedTo) return;
      // Assets operate in Orbit and cannot attack ships in the Atmosphere layer
      // (e.g. Descent ships that have dropped into atmosphere).
      if ((s.layer || 'orbit') === 'atmosphere') return;
      if (Math.hypot(s.x - x, s.y - y) <= 1 * INCH + shipBaseRadiusPx(def)) out.push({ gid, si, def, ship: s });
    });
  });
  return out;
}

export function targetKey(gid, si) { return gid + '#' + si; }

// ── SCORING AND LOGGING ──

export function shipPoints(def) { return Math.round((def.pts || 0) / (def.groupSize || 1)); }

/* Award Victory Points: mutates the score, records a structured entry in state.scoreLog
   (for the breakdown view), returns a text line (for round/end logs). `vp` may be
   negative (e.g. Protect penalty). */
export function awardVP(state, side, vp, reason, round) {
  if (!vp || !state.score || !state.score[side]) return null;
  state.score[side].vp += vp;
  state.scoreLog = state.scoreLog || [];
  const entry = { round: round != null ? round : (state.round || 0), side, vp, reason };
  state.scoreLog.push(entry);
  logEvent(state, `${factionName(state, side)} ${vp >= 0 ? '+' : ''}${vp} VP — ${reason}`, 'vp');
  return `${factionName(state, side)} ${vp >= 0 ? '+' : ''}${vp} VP (${reason})`;
}

/* Append a game event to the log (orders, moves, shots, launches, extracts, etc.). */
export function logEvent(state, text, cat = 'misc', detail = null) {
  if (!text) return;
  state.eventLog = state.eventLog || [];
  const e = { round: state.round || 0, text, cat, ts: Date.now() };
  // `detail` carries structured data for the report (e.g. an attack's per-shot hit/save
  // dice) so a line can be expanded to trace the rolls. Kept off the text path.
  if (detail) e.detail = detail;
  state.eventLog.push(e);
  // Cap the stored history. Large enough to retain a whole 6-round game so the
  // end-game report has every round's events (a busy game runs a few thousand lines).
  if (state.eventLog.length > 4000) state.eventLog.shift();
}

/* Tally D6 faces rolled "for" a side (to-hit dice for the attacker, save dice for the
   defender, plus any re-rolls — every physical re-roll counts as another die). Powers the
   per-side dice-distribution panel in the end-game report. faces is an array of 1–6. */
export function recordDice(state, side, faces) {
  if (!side || !faces || !faces.length) return;
  state.diceStats = state.diceStats || { player1: [0, 0, 0, 0, 0, 0], player2: [0, 0, 0, 0, 0, 0] };
  const arr = state.diceStats[side];
  if (!arr) return;
  for (const f of faces) if (f >= 1 && f <= 6) arr[f - 1]++;
}

/* Award a destroyed ship's points to the killer's Kill Points (2× if captured). */
export function recordKill(state, def, killerSide, captured, killedShipKey) {
  if (!killerSide || !state.score || !state.score[killerSide]) return;
  if (def.side === killerSide) return; // friendly fire / self-destruct never scores Kill Points
  state.score[killerSide].kp += shipPoints(def) * (captured ? 2 : 1);
  logEvent(state, `${factionName(state, killerSide)} ${captured ? 'captured' : 'destroyed'} ${def.name} (+${shipPoints(def) * (captured ? 2 : 1)} KP)`, 'attack');
  if (captured && state.captured) state.captured[killerSide] += shipPoints(def);
  // Extract: +1 VP per enemy Ship destroyed while it was carrying Recon Operatives.
  if (killedShipKey && state.shipReconOps && state.shipReconOps[killedShipKey] > 0) {
    state.reconKills = state.reconKills || { player1: 0, player2: 0 };
    state.reconKills[killerSide] = (state.reconKills[killerSide] || 0) + 1;
    state.shipReconOps[killedShipKey] = 0; // operatives lost with the ship
  }
  // Decapitate: flag the victim side if this ship carried its admiral.
  if (def.flagship || (def.special && /Command Ship/i.test(def.special)) || (def.admiralLevel)) {
    if (state.admiralKilled) state.admiralKilled[def.side] = true;
    if (killerSide && state.admiralKillCount) state.admiralKillCount[killerSide] = (state.admiralKillCount[killerSide] || 0) + 1;
  }
}

/* Standard Scoring VP for a dropsite size + control/contest. */
const DROPSITE_VP = { S: { control: 2, contest: 0 }, M: { control: 3, contest: 1 }, L: { control: 4, contest: 2 } };

export function dropsiteSizeKey(ds) {
  const t = String((ds.base && ds.base.size) || ds.size || 'medium').toLowerCase();
  if (t === 's' || t === 'small') return 'S';
  if (t === 'l' || t === 'large') return 'L';
  return 'M';
}

/* Resolve the scoring Objective key for a given side. Supports asymmetric scenarios
   (e.g. attacker Raze / defender Protect): state.scenario.objectives = { player1, player2 }
   overrides the shared state.scenario.objective when present. */
export function objectiveForSide(state, side) {
  const sc = state.scenario || {};
  if (sc.objectives && sc.objectives[side]) return sc.objectives[side];
  return sc.objective || null;
}
/* True if either side's Objective equals `key`. */
export function objAny(state, key) {
  return objectiveForSide(state, 'player1') === key || objectiveForSide(state, 'player2') === key;
}

/* Compute Standard Scoring VP gained this scoring round, per side.
   Objective modifiers:
   • Protect: a side's nominated Dropsite scores DOUBLE while intact; if Levelled, that
     side instead takes a penalty equal to the Dropsite's control value.
   • Raze: a Dropsite Levelled or Ruined ≥24" from a side's Zone scores DOUBLE for the
     OPPOSING side that razed/contests it (handled in runScoring's raze block, not here).
   Returns { player1, player2 } VP for this round. */
export function computeStandardScoring(state) {
  const out = { player1: 0, player2: 0 };
  const rows = []; // per-dropsite breakdown for the scoring modal
  const noms = state.protectNom || {};
  ((state.scenarioData && state.scenarioData.dropsites) || []).forEach(ds => {
    const sz = dropsiteSizeKey(ds);
    const vp = DROPSITE_VP[sz] || DROPSITE_VP.M;
    const ctrl = dropsiteController(ds);
    const isLevelled = !!ds.destroyed;
    let ucmGain = 0, shalGain = 0, statusNote = '';
    ['player1','player2'].forEach(s => { if (objectiveForSide(state, s) === 'protect' && noms[s] === ds.id && isLevelled) { out[s] -= vp.control; if (s==='player1') ucmGain -= vp.control; else shalGain -= vp.control; statusNote = 'Protect penalty'; } });
    if (isLevelled) {
      rows.push({ name: ds.base.name, sz, status: 'Levelled' + (statusNote?' · '+statusNote:''), ctrl: null, player1: ucmGain, player2: shalGain });
      return;
    }
    // score_north / score_south: only the specified zone's player gets Normal Scoring from this dropsite.
    const sr = ds.siteRules || [];
    const dZone = state.deployZone || {};
    const northSide = dZone.player1 === 'north' ? 'player1' : 'player2';
    const southSide = northSide === 'player1' ? 'player2' : 'player1';
    const restrictTo = sr.includes('score_north') ? northSide : sr.includes('score_south') ? southSide : null;
    if (ctrl) {
      if (!restrictTo || ctrl === restrictTo) {
        let gain = vp.control;
        if (objectiveForSide(state, ctrl) === 'protect' && noms[ctrl] === ds.id) { gain *= 2; statusNote = 'Protected ×2'; }
        out[ctrl] += gain;
        if (ctrl === 'player1') ucmGain += gain; else shalGain += gain;
      } else {
        statusNote = 'Score-restricted';
      }
      rows.push({ name: ds.base.name, sz, status: 'Controlled' + (statusNote?' · '+statusNote:''), ctrl, player1: ucmGain, player2: shalGain });
    } else if (dropsiteContested(ds)) {
      if (!restrictTo || restrictTo === 'player1') { out.player1 += vp.contest; ucmGain += vp.contest; }
      if (!restrictTo || restrictTo === 'player2') { out.player2 += vp.contest; shalGain += vp.contest; }
      rows.push({ name: ds.base.name, sz, status: 'Contested', ctrl: null, player1: ucmGain, player2: shalGain });
    } else {
      rows.push({ name: ds.base.name, sz, status: 'Uncontrolled', ctrl: null, player1: ucmGain, player2: shalGain });
    }
  });
  out.rows = rows;
  return out;
}

/* Is a ship in range of a focal point? Supports circle {x,y,diameter} and rect {x,y,width,height}. */
function shipInFocalPoint(xIn, yIn, fp) {
  if (fp.diameter != null) return Math.hypot(xIn - fp.x, yIn - fp.y) <= fp.diameter / 2;
  if (fp.width != null)    return xIn >= fp.x && xIn <= fp.x + fp.width && yIn >= fp.y && yIn <= fp.y + fp.height;
  return false;
}

function focalPointCenter(fp) {
  if (fp.diameter != null) return { cx: fp.x, cy: fp.y };
  return { cx: fp.x + fp.width / 2, cy: fp.y + fp.height / 2 };
}

/* Score Focal Points on rounds 4 & 6.
   Assigns each ship to at most one focal point (nearest when in range of multiple).
   special tags: 'low_crippled', 'low_north', 'low_south'. */
export function computeFocalPointsScoring(state) {
  const fps = (state.scenarioData && state.scenarioData.focalPoints) || [];
  if (!fps.length) return [];
  const log = [];
  // Collect all alive on-table ships.
  const allShips = [];
  Object.keys(state.groups).forEach(gid => {
    const def = getDef(state, gid);
    if (!def) return;
    state.groups[gid].ships.forEach((ship, si) => {
      if (ship.destroyed || ship.offTable) return;
      allShips.push({ def, ship, xIn: ship.x / INCH, yIn: ship.y / INCH });
    });
  });
  // Assign each ship to its nearest in-range focal point.
  const fpBuckets = fps.map(() => []);
  allShips.forEach(entry => {
    const { xIn, yIn } = entry;
    const inRange = fps.reduce((acc, fp, i) => { if (shipInFocalPoint(xIn, yIn, fp)) acc.push(i); return acc; }, []);
    if (!inRange.length) return;
    let chosen = inRange[0];
    if (inRange.length > 1) {
      let best = Infinity;
      inRange.forEach(i => {
        const { cx, cy } = focalPointCenter(fps[i]);
        const d = Math.hypot(xIn - cx, yIn - cy);
        if (d < best) { best = d; chosen = i; }
      });
    }
    fpBuckets[chosen].push(entry);
  });
  // Score each focal point.
  fps.forEach((fp, fi) => {
    const special = fp.special || [];
    const totals = { player1: 0, player2: 0 };
    fpBuckets[fi].forEach(({ def, ship }) => {
      const zone = state.deployZone && state.deployZone[def.side];
      // 'north'/'south': only that zone's side scores this focal point
      if (zone && (special.includes('north') || special.includes('south')) && !special.includes(zone)) return;
      const isCrippled = ship.hull <= ship.maxHull / 2;
      const useLow = (special.includes('low_crippled') && isCrippled)
                  || (zone && special.includes(`low_${zone}`))
                  || (zone && special.includes(`low_${zone}_crippled`) && isCrippled);
      const t = def.tonnage || 'L';
      totals[def.side] += useLow ? (FOCAL_LOW[t] || 0) : (FOCAL_HIGH[t] || 1);
    });
    const maxVal = Math.max(totals.player1, totals.player2);
    if (maxVal <= 0) return;
    const fpLabel = fp.label || `Focal Point ${fi + 1}`;
    ['player1','player2'].forEach(s => {
      const opp = s === 'player1' ? 'player2' : 'player1';
      if (totals[s] === maxVal) {
        log.push(awardVP(state, s, 3, `${fpLabel}: highest value (${totals[s]})`, state.round));
      } else if (totals[s] > 0 && totals[s] >= maxVal / 2) {
        log.push(awardVP(state, s, 1, `${fpLabel}: ≥half value (${totals[s]} vs ${totals[opp]})`, state.round));
      }
    });
  });
  return log.filter(Boolean);
}

/* Run end-of-round Victory Point scoring (rounds 4 & 6 for standard scoring),
   plus the scenario's scoring-variant bonuses where computable. */
export function runScoring(state, rng, round) {
  const log = [];
  state.lastScoring = null; // set below for the R4/R6 standard-scoring modal
  if ((round === 4 || round === 6) && !state.scoredRounds.includes(round) && !objAny(state, 'demolish') && !objAny(state, 'focal_points') && !objAny(state, 'extract')) {
    state.scoredRounds.push(round);
    const std = computeStandardScoring(state);
    const l1 = awardVP(state, 'player1', std.player1, `Standard Scoring R${round}`, round);
    const l2 = awardVP(state, 'player2', std.player2, `Standard Scoring R${round}`, round);
    if (l1) log.push(l1); if (l2) log.push(l2);
    if (!l1 && !l2) log.push(`Standard Scoring (R${round}): no VP scored`);
    // Stash the per-dropsite breakdown for the scoring modal.
    state.lastScoring = { round, rows: std.rows, player1: std.player1, player2: std.player2 };
  }
  // Focal Points scoring (R4 & R6) — runs whenever focal points are defined in the layout,
  // regardless of objective (focal points coexist alongside kill_points, normal, demolish, etc.).
  if ((round === 4 || round === 6) && (state.scenarioData?.focalPoints?.length > 0)) {
    computeFocalPointsScoring(state).forEach(l => log.push(l));
  }
  // Scoring variant bonuses applied at game end (round 6). Each side scores against
  // its OWN Objective (which may differ in asymmetric scenarios).
  if (round === 6) {
    const push = (line) => { if (line) log.push(line); };
    const sides = ['player1','player2'];
    const objNameOf = (s) => { const o = objectiveForSide(state, s); return (o && OBJECTIVES[o]) ? OBJECTIVES[o].name : ''; };
    // Attrition: +2 VP per 500 pts destroyed.
    sides.forEach(s => { if (objectiveForSide(state, s) === 'attrition') push(awardVP(state, s, Math.floor(state.score[s].kp / 500) * 2, `${objNameOf(s)}: pts destroyed`, round)); });
    // Kill Points (Scenario Expansion 1): 2 VP per 500 pts of Ships/Admirals destroyed.
    sides.forEach(s => { if (objectiveForSide(state, s) === 'kill_points') push(awardVP(state, s, Math.floor(state.score[s].kp / 500) * 2, `${objNameOf(s)}: pts destroyed`, round)); });
    // One With (Almost) Nothing: +1 VP per enemy Admiral destroyed.
    if (state.scenario?.layout === 'se1_one_with_almost_nothing') {
      sides.forEach(s => {
        const kills = (state.admiralKillCount && state.admiralKillCount[s]) || 0;
        if (kills > 0) push(awardVP(state, s, kills, `Admirals destroyed: ${kills}`, round));
      });
    }
    // Raze: +2 VP per 500 pts destroyed, PLUS double Standard Scoring value for each
    // Dropsite Levelled or Ruined that lies ≥24" from the scoring side's own Zone.
    sides.forEach(s => {
      if (objectiveForSide(state, s) !== 'raze') return;
      push(awardVP(state, s, Math.floor(state.score[s].kp / 500) * 2, `${objNameOf(s)}: pts destroyed`, round));
      let razeVP = 0;
      ((state.scenarioData && state.scenarioData.dropsites) || []).forEach(ds => {
        const remHull = (ds.maxHull || 0) - (ds.damage || 0);
        const levelled = ds.destroyed || remHull <= 0;
        const ruined = !levelled && ds.maxHull && (remHull / ds.maxHull) < 0.5;
        if (!levelled && !ruined) return;
        const vp = (DROPSITE_VP[dropsiteSizeKey(ds)] || DROPSITE_VP.M).control;
        if (distFromZoneIn(state, s, inchToPx(ds.y)) >= 24) razeVP += vp;
      });
      push(awardVP(state, s, razeVP, 'Raze: distant Levelled/Ruined', round));
    });
    // Breakthrough: attacker scores 1 VP per 200 pts flown off; defender scores kill points.
    if (objAny(state, 'breakthrough')) {
      const btAttacker = ['player1','player2'].find(s => objectiveForSide(state, s) === 'breakthrough');
      const btDefender = btAttacker === 'player1' ? 'player2' : 'player1';
      const flown = state.breakthroughFlyoff || { player1: 0, player2: 0 };
      push(awardVP(state, btAttacker, Math.floor((flown[btAttacker] || 0) / 200), `Breakthrough: ${flown[btAttacker] || 0} pts flown off`, round));
      push(awardVP(state, btDefender, Math.floor(state.score[btDefender].kp / 500) * 2, 'Breakthrough: pts destroyed', round));
    }
    // Survey: +1 VP per Dropsite Surveyed.
    if (objAny(state, 'survey')) {
      const surv = { player1: 0, player2: 0 };
      ((state.scenarioData && state.scenarioData.dropsites) || []).forEach(ds => (ds.surveyedBy || []).forEach(s => surv[s]++));
      sides.forEach(s => { if (objectiveForSide(state, s) === 'survey') push(awardVP(state, s, surv[s], 'Survey', round)); });
    }
    // Extract: 2 VP per Recon Operative still aboard a surviving Ship.
    if (objAny(state, 'extract') && state.shipReconOps) {
      const ex = { player1: 0, player2: 0 };
      Object.keys(state.shipReconOps).forEach(k => {
        const n = state.shipReconOps[k]; if (!n) return;
        const [gid, si] = k.split('#');
        const ship = state.groups[gid] && state.groups[gid].ships[parseInt(si)];
        if (ship && !ship.destroyed) ex[getDef(state, gid).side] += n * 2;
      });
      sides.forEach(s => { if (objectiveForSide(state, s) !== 'extract') return; push(awardVP(state, s, ex[s], 'Recon Operatives aboard', round)); if (state.reconKills) push(awardVP(state, s, state.reconKills[s] || 0, 'destroyed operative-carriers', round)); });
    }
    // Secondary Objectives (each side scores its one chosen scoring secondary).
    log.push(...scoreSecondaries(state, rng));
    // Scenario-specific end-game bonuses.
    const layKey = state.scenario && state.scenario.layout;
    // VIM: 1VP per Group on the table containing a Crippled Ship outside the Focal Point range.
    if (layKey === 'se1_very_important_moon') {
      const vimFPs = (state.scenarioData && state.scenarioData.focalPoints) || [];
      sides.forEach(s => {
        let vimVP = 0;
        Object.keys(state.groups).forEach(gid => {
          const def = getDef(state, gid);
          if (!def || def.side !== s) return;
          const g = state.groups[gid];
          const hasCrippled = g.ships.some(sh => !sh.destroyed && !sh.offTable && sh.hull <= sh.maxHull / 2);
          if (!hasCrippled) return;
          const anyOutside = g.ships.some(sh => {
            if (sh.destroyed || sh.offTable) return false;
            const xIn = sh.x / INCH, yIn = sh.y / INCH;
            return vimFPs.every(fp => !shipInFocalPoint(xIn, yIn, fp));
          });
          if (anyOutside) vimVP++;
        });
        push(awardVP(state, s, vimVP, 'VIM: Groups with Crippled outside Focal Point', round));
      });
    }
    // Moonbreaker: Normal Scoring at game end if controlling majority of moon dropsites.
    if (layKey === 'se1_moonbreaker') {
      const mbLay = LAYOUTS['se1_moonbreaker'];
      const moonDsSet = new Set(mbLay.moonDropsites || []);
      const moonDsList = ((state.scenarioData && state.scenarioData.dropsites) || []).filter(d => moonDsSet.has(d.id));
      if (moonDsList.length > 0) {
        const ctrl = { player1: 0, player2: 0 };
        moonDsList.forEach(d => { const c = dropsiteController(d); if (c) ctrl[c]++; });
        const majority = Math.floor(moonDsList.length / 2) + 1;
        sides.forEach(s => {
          if (ctrl[s] < majority) return;
          let moonVP = 0;
          moonDsList.forEach(d => { if (dropsiteController(d) === s) moonVP += (DROPSITE_VP[dropsiteSizeKey(d)] || DROPSITE_VP.M).control; });
          push(awardVP(state, s, moonVP, 'Moonbreaker: moon majority control', round));
        });
      }
    }
    // One With (Almost) Nothing: +1VP per enemy Admiral destroyed.
    if (layKey === 'se1_one_with_almost_nothing') {
      sides.forEach(s => {
        const kills = (state.admiralKillCount && state.admiralKillCount[s]) || 0;
        push(awardVP(state, s, kills, 'Admiral kills', round));
      });
    }
    // Moonguard: score each player's chosen bonus secondary at game end (independently of main secondary).
    if (layKey === 'se1_moonguard' && state.moonguardSecondaries) {
      const scoreOneMgSec = (s, key) => {
        if (!key) return;
        let vp = 0;
        if (key === 'annihilate') vp = Math.min(3, Math.floor((state.score[s].kp || 0) / 500));
        else if (key === 'take_prizes') vp = Math.min(3, Math.floor(((state.captured && state.captured[s]) || 0) / 100));
        else if (key === 'decapitate') {
          const enemy = s === 'player1' ? 'player2' : 'player1';
          vp = (state.admiralKilled && state.admiralKilled[enemy]) ? 2 : 0;
        }
        if (vp > 0) push(awardVP(state, s, vp, `Moonguard bonus: ${SECONDARY_OBJECTIVES[key] ? SECONDARY_OBJECTIVES[key].name : key}`, round));
      };
      scoreOneMgSec('player1', state.moonguardSecondaries.player1);
      scoreOneMgSec('player2', state.moonguardSecondaries.player2);
    }
  }
  return log;
}

/* Distance (inches) of a board point from `side`'s deployment edge (its Zone).
   Uses state.deployZone when set; falls back to player1=south, player2=north. */
export function distFromZoneIn(state, side, yPx) {
  const zone = state.deployZone && state.deployZone[side];
  const edgeY = (zone === 'north') ? 0 : (zone === 'south') ? BOARD_PX :
                (side === 'player1' ? BOARD_PX : 0);
  return Math.abs(yPx - edgeY) / INCH;
}

/* All valid nomination candidates for a position-based Secondary (for manual choice).
   Returns [{nom, label}]. The default (auto) nomination is the first entry. */
export function secondaryCandidates(state, side, key) {
  const enemy = side === 'player1' ? 'player2' : 'player1';
  const dss = (state.scenarioData && state.scenarioData.dropsites) || [];
  const out = [];
  if (key === 'key_site' || key === 'priority_target') {
    let cands = dss.filter(ds => distFromZoneIn(state, side, inchToPx(ds.y)) >= 24);
    if (key === 'priority_target') cands = cands.filter(ds => ['M','L'].includes(dropsiteSizeKey(ds)));
    cands.sort((a,b) => distFromZoneIn(state, enemy, inchToPx(a.y)) - distFromZoneIn(state, enemy, inchToPx(b.y)));
    cands.forEach(ds => out.push({ nom: { dsId: ds.id }, label: `${ds.base.name} (${dropsiteSizeKey(ds)})` }));
  } else if (key === 'long_shot') {
    dss.forEach(ds => {
      if (distFromZoneIn(state, enemy, inchToPx(ds.y)) <= 12) {
        (ds.features || []).forEach((fk, fi) => out.push({ nom: { dsId: ds.id, fi }, label: `${(FEATURES[fk]||{}).name||fk} @ ${ds.base.name}` }));
      }
    });
  } else if (key === 'objectives_beyond') {
    fleetForSide(state, side).forEach(d => { if (['M','H','C'].includes(d.tonnage)) out.push({ nom: { shipId: d.id }, label: `${d.name} (${d.tonnage})` }); });
  }
  return out;
}

/* Auto-nominate a valid target for a position-based Secondary Objective. */
export function nominateForSecondary(state, side, key) {
  const cands = secondaryCandidates(state, side, key);
  return cands.length ? cands[0].nom : null;
}

/* Is this ship the Objectives Beyond nominee, in position to fly off (within 6" of the
   opponent's Zone edge, having moved)? */
export function objectivesBeyondEligible(state, gid, si) {
  const def = getDef(state, gid);
  const side = def.side;
  const noms = state.secondaryNominations && state.secondaryNominations[side];
  const nom = noms && noms.objectives_beyond;
  if (!nom) return false;
  if (def.id.split(':').pop() !== nom.shipId.split(':').pop()) return false;
  const ship = state.groups[gid] && state.groups[gid].ships[si];
  if (!ship || ship.destroyed || ship.offTable || !ship.movedThisRound) return false;
  const enemy = side === 'player1' ? 'player2' : 'player1';
  return distFromZoneIn(state, enemy, ship.y) <= 6;
}

/* Breakthrough objective: the attacking side's Ships that have moved and reached within 6"
   of the opponent's Zone edge may fly off for 1 VP per 200 pts. The attacker is whichever
   side holds the 'breakthrough' objective (supports asymmetric scenarios). */
export function breakthroughFlyoffEligible(state, gid, si) {
  const attacker = ['player1','player2'].find(s => objectiveForSide(state, s) === 'breakthrough');
  if (!state.scenario || !attacker) return false;
  const def = getDef(state, gid);
  if (!def || def.side !== attacker) return false;
  const ship = state.groups[gid] && state.groups[gid].ships[si];
  if (!ship || ship.destroyed || ship.offTable || !ship.movedThisRound) return false;
  const defender = attacker === 'player1' ? 'player2' : 'player1';
  return distFromZoneIn(state, defender, ship.y) <= 6;
}

/* Score each side's selected Secondary Objective at game end. Returns log lines. */
export function scoreSecondaries(state, rng) {
  const log = [];
  if (!state.secondaries) return log;
  ['player1','player2'].forEach(side => {
    const chosen = state.secondaries[side] || [];
    let best = 0, bestName = '';
    chosen.forEach(key => {
      let vp = 0;
      if (key === 'annihilate') vp = Math.min(3, Math.floor(state.score[side].kp / 500));
      else if (key === 'take_prizes') vp = Math.min(3, Math.floor((state.captured && state.captured[side] || 0) / 100));
      else if (key === 'gather_intel') {
        let n = 0; ((state.scenarioData && state.scenarioData.dropsites) || []).forEach(ds => { if (ds.surveyedBy && ds.surveyedBy.includes(side)) n++; });
        vp = Math.min(2, n);
      } else if (key === 'decapitate') {
        const enemy = side === 'player1' ? 'player2' : 'player1';
        vp = (state.admiralKilled && state.admiralKilled[enemy]) ? 2 : 0;
      } else if (key === 'key_site' || key === 'priority_target' || key === 'long_shot' || key === 'objectives_beyond') {
        vp = scorePositionSecondary(state, side, key);
      }
      if (vp > best) { best = vp; bestName = SECONDARY_OBJECTIVES[key] ? SECONDARY_OBJECTIVES[key].name : key; }
    });
    if (best > 0) { const l = awardVP(state, side, best, `Secondary: ${bestName}`, 6); if (l) log.push(l); }
  });
  return log;
}

/* Score a position-based Secondary from its nomination. */
export function scorePositionSecondary(state, side, key) {
  const enemy = side === 'player1' ? 'player2' : 'player1';
  const nom = state.secondaryNominations && state.secondaryNominations[side] && state.secondaryNominations[side][key];
  if (!nom) return 0;
  const dss = (state.scenarioData && state.scenarioData.dropsites) || [];
  const ds = nom.dsId ? dss.find(d => d.id === nom.dsId) : null;
  if (key === 'key_site' && ds) {
    if (dropsiteController(ds) !== side) return 0;
    return distFromZoneIn(state, enemy, inchToPx(ds.y)) <= 6 ? 3 : 2; // 3 VP if near opponent Zone
  }
  if (key === 'priority_target' && ds) {
    if (!ds.destroyed) return 0; // "Levelled"
    return distFromZoneIn(state, enemy, inchToPx(ds.y)) <= 6 ? 3 : 2;
  }
  if (key === 'long_shot' && ds) {
    const destroyed = (ds.destroyedFeatures || []).includes(nom.fi) || ds.destroyed;
    return destroyed ? 2 : 0;
  }
  if (key === 'objectives_beyond' && nom.shipId) {
    // Find the nominated ship; score if it flew off (offTable) and isn't crippled.
    let res = 0;
    Object.keys(state.groups).forEach(gid => {
      const def = getDef(state, gid);
      if (def.side !== side || def.id.split(':').pop() !== nom.shipId.split(':').pop()) return;
      state.groups[gid].ships.forEach(s => {
        if (s.flewOff && !s.crippledRolled) res = Math.max(res, ['H','C'].includes(def.tonnage) ? 2 : 1);
      });
    });
    return res;
  }
  return 0;
}

// ── TURN MANAGEMENT ──

export function activeGroupIdForSide(state, side) {
  const fleet = fleetForSide(state, side);
  for (const def of fleet) {
    const grp = state.groups[def.id];
    if (!grp || grp.activated) continue;
    if (grp.order || grp.ships.some(s => s.movedThisRound || s.firedThisActivation || (s.launchedThisRound > 0) || s.detectorUsed)) {
      return def.id;
    }
  }
  return null;
}

export function sideHasPendingActivation(state, side) {
  const fleet = fleetForSide(state, side);
  return fleet.some(def => {
    const grp = state.groups[def.id];
    if (!grp || grp.activated) return false;
    // Fully destroyed groups have nothing left to activate.
    if (!grp.ships.some(s => !s.destroyed)) return false;
    const onTable = grp.ships.some(s => !s.destroyed && !s.offTable);
    if (onTable) return true;
    return canActivateOffTable(state, def).eligible;
  });
}

/* Advance the active side after an activation finishes (alternate factions).
   If the other side has nothing left to activate, the same side continues. */
export function advanceActiveSide(state) {
  const other = state.activeSide === 'player1' ? 'player2' : 'player1';
  if (sideHasPendingActivation(state, other)) state.activeSide = other;
  else if (sideHasPendingActivation(state, state.activeSide)) { /* same side continues */ }
  else state.activeSide = null;
}

/* Roll initiative for the start of a round: a D6 per faction, reroll ties.
   Stores the result in state.initiative for the modal. */
/* True if `side` has at least one ship alive and deployed — admiral is presumed
   lost if the entire fleet is destroyed or off-table. */
export function admiralAlive(state, side) {
  return fleetForSide(state, side).some(def => {
    const g = state.groups[def.id];
    return g && g.ships.some(s => !s.destroyed && !s.offTable);
  });
}

export function rollInitiative(state, rng) {
  const baseLvl = state.admiralLevel || { player1: 0, player2: 0 };
  // Per-admiral contribution: level + Command Ship-X of their flagship.
  // When admiralAssignments is present (imported fleet), uses per-admiral calc.
  // max(contributions) + (n-1 extras) replaces the single-admiral formula.
  const calcAdmiralContrib = (side) => {
    const asns = state.admiralAssignments && state.admiralAssignments[side];
    if (!asns) {
      // No per-admiral assignments exist: fall back to global admiral level if any ship is alive.
      if (!admiralAlive(state, side)) return { eff: 0, extras: 0 };
      return { eff: baseLvl[side] || 0, extras: 0 };
    }
    if (!asns.length) {
      // Assignments record exists but is empty — admiral data was committed without setup;
      // grant no bonus rather than falling back to the any-ship-alive check.
      return { eff: 0, extras: 0 };
    }
    const fleet = fleetForSide(state, side);
    // Only count admirals whose specific assigned ship is still alive on table.
    const aliveContribs = asns.map(a => {
      const def = fleet.find(d => d.baseId === a.baseId);
      if (!def) return null;
      const grp = state.groups[def.id];
      if (!grp) return null;
      const ship = grp.ships[a.shipIdx || 0];
      if (!ship || ship.destroyed || ship.offTable) return null;
      const m = def.special && def.special.match(/Command Ship-(\d+)/i);
      const cmd = m ? +m[1] : 0;
      return (a.level || 0) + cmd;
    }).filter(c => c !== null);
    if (!aliveContribs.length) return { eff: 0, extras: 0 };
    return { eff: Math.max(0, ...aliveContribs), extras: Math.max(0, aliveContribs.length - 1) };
  };
  const ac = { player1: calcAdmiralContrib('player1'), player2: calcAdmiralContrib('player2') };
  const effectiveAdmiral = { player1: ac.player1.eff, player2: ac.player2.eff };
  // Command ship bonus: 0 when per-admiral calc is used (cmd already included), global otherwise.
  const cmdBonus = {
    player1: (state.admiralAssignments && state.admiralAssignments.player1) ? 0 : commandShipBonus(state, 'player1'),
    player2: (state.admiralAssignments && state.admiralAssignments.player2) ? 0 : commandShipBonus(state, 'player2'),
  };
  const aLvl = {
    player1: effectiveAdmiral.player1 + cmdBonus.player1 + ac.player1.extras,
    player2: effectiveAdmiral.player2 + cmdBonus.player2 + ac.player2.extras,
  };
  const redBonus = (aLvl.player1 >= aLvl.player2 && aLvl.player1 > 0) ? 1 : 0;
  const blueBonus = (aLvl.player2 >= aLvl.player1 && aLvl.player2 > 0) ? 1 : 0;
  let red, blue, rRaw, bRaw;
  do {
    rRaw = 1 + Math.floor(rng() * 6);
    bRaw = 1 + Math.floor(rng() * 6);
    red = rRaw + redBonus; blue = bRaw + blueBonus;
  } while (red === blue);
  // AP generation: 1 (base) + effective admiral level + command ship bonus + comms.
  const comms = {
    player1: sideHasCommsUplink(state, 'player1') ? 1 : 0,
    player2: sideHasCommsUplink(state, 'player2') ? 1 : 0,
  };
  const ap = {
    player1: 1 + effectiveAdmiral.player1 + cmdBonus.player1 + comms.player1,
    player2: 1 + effectiveAdmiral.player2 + cmdBonus.player2 + comms.player2,
  };
  // Pass Tokens: a side 2+ Groups fewer than the leader gets 1, +1 per further fewer.
  // Count groups with at least one alive ship on the table, OR groups eligible to
  // arrive/deploy this turn (canActivateOffTable handles play-phase reserve rules).
  const groupCount = (side) => fleetForSide(state, side).filter(def => {
    if (def.payload) return false;
    const g = state.groups[def.id];
    if (!g) return false;
    const hasOnTable = g.ships.some(s => !s.destroyed && !s.offTable);
    if (hasOnTable) return true;
    return canActivateOffTable(state, def).eligible;
  }).length;
  const gc = { player1: groupCount('player1'), player2: groupCount('player2') };
  const most = Math.max(gc.player1, gc.player2);
  const passTokens = { player1: Math.max(0, (gc.player2 - 1) - gc.player1), player2: Math.max(0, (gc.player1 - 1) - gc.player2) };
  // Whether the admiral's assigned flagship is off-table (undeployed) rather than destroyed.
  const admiralOffTable = (side) => {
    const asns = state.admiralAssignments && state.admiralAssignments[side];
    if (!asns || !asns.length) return false;
    const fleet = fleetForSide(state, side);
    return asns.some(a => {
      const def = fleet.find(d => d.baseId === a.baseId);
      if (!def) return false;
      const grp = state.groups[def.id];
      if (!grp) return false;
      const ship = grp.ships[a.shipIdx || 0];
      return ship && !ship.destroyed && ship.offTable;
    });
  };
  // Store breakdown for display in the planning overlay.
  const apBreakdown = {
    player1: { base: 1, admiral: effectiveAdmiral.player1, admiralChosen: Math.max(baseLvl.player1 || 0, effectiveAdmiral.player1), cmd: cmdBonus.player1, comms: comms.player1, extras: ac.player1.extras, admiralOffTable: admiralOffTable('player1') },
    player2: { base: 1, admiral: effectiveAdmiral.player2, admiralChosen: Math.max(baseLvl.player2 || 0, effectiveAdmiral.player2), cmd: cmdBonus.player2, comms: comms.player2, extras: ac.player2.extras, admiralOffTable: admiralOffTable('player2') },
  };
  state.planning = { ap, passTokens, gc, aLvl, apBreakdown };
  state.initiative = {
    red, blue, rRaw, bRaw, redBonus, blueBonus,
    winner: red > blue ? 'player1' : 'player2',
    holder: red > blue ? 'player1' : 'player2',
    round: state.round
  };
  // Pre-activate groups that have no ships eligible to act this round so they
  // are never presented to players and never need a finishActivation intent.
  // Done here (server-authoritative) rather than on each client to avoid races.
  ['player1', 'player2'].forEach(side => {
    fleetForSide(state, side).forEach(def => {
      const grp = state.groups[def.id];
      if (!grp || grp.activated) return;
      const hasOffTable = grp.ships.some(s => !s.destroyed && s.offTable && !s.attachedTo);
      const hasActive   = grp.ships.some(s => !s.destroyed && (!s.offTable || s.justArrived))
                        || (hasOffTable && canActivateOffTable(state, def).eligible);
      if (!hasActive) grp.activated = true;
    });
  });
}

// ── SECTION C: ASSET AND DROPSITE LOGIC ──

/* Apply scenery damage to a launched asset (mover) that crossed scenery between
   (origX,origY) and (mover.x,mover.y). Returns the count of removed token(s). */
export function applyAssetScenery(state, rng, mover, origX, origY) {
  const sd = state.scenarioData;
  if (!sd) return 0;
  const thresholds = [];
  (sd.largeObjects||[]).forEach(o => { if (largeObjectAt(state, mover.x, mover.y) || segCrossesCircle(origX, origY, mover.x, mover.y, inchToPx(o.x), inchToPx(o.y), inchToPx(o.diameter/2))) thresholds.push(1); });
  (sd.rings||[]).forEach(r => { if (segCrossesRing(origX, origY, mover.x, mover.y, r)) thresholds.push(2); });
  (sd.placedScenery||[]).forEach(s => { if (segCrossesRect(origX, origY, mover.x, mover.y, inchToPx(s.x), inchToPx(s.y), inchToPx(6), inchToPx(3), s.angle||0)) thresholds.push(s.type==='dense'?5:3); });
  if (!thresholds.length) return 0;
  const need = Math.min(...thresholds);
  let survivors = 0;
  for (let i = 0; i < mover.count; i++) { if (need === 1 || rollDie(rng) < need) { /* removed */ } else survivors++; }
  const removed = mover.count - survivors;
  mover.count = survivors;
  return removed;
}

/* Close Protection: friendly Fighter Wings within Fighter Thrust range of a ship at
   (x,y). Returns [{id, count}] for Wings of `side` with count>0. */
export function friendlyFightersInRange(state, side, x, y) {
  const thrPx = (assetProfile(state, side, 'fighter').thrust || 12) * INCH;
  return (state.launchedAssets || [])
    .filter(a => a.kind === 'fighter' && a.side === side && a.count > 0 &&
                 Math.hypot(a.x - x, a.y - y) <= thrPx)
    .map(a => ({ id: a.id, count: a.count }));
}

/* Battalion storage on a dropsite. Lazily initialised. */
export function dsBattalions(ds) {
  if (!ds.battalions) {
    ds.battalions = { ground: { player1: 0, player2: 0 } };
    (ds.features || []).forEach((fk, fi) => { ds.battalions['feat' + fi] = { player1: 0, player2: 0 }; });
  }
  return ds.battalions;
}

/* Total enemy battalions on a dropsite (relative to a given side) across all locations. */
export function dsEnemyBattalions(ds, side) {
  const enemy = side === 'player1' ? 'player2' : 'player1';
  const b = dsBattalions(ds);
  return Object.values(b).reduce((sum, loc) => sum + (loc[enemy] || 0), 0);
}

/* All battalions of a side on a dropsite. */
export function dsSideBattalions(ds, side) {
  const b = dsBattalions(ds);
  return Object.values(b).reduce((sum, loc) => sum + (loc[side] || 0), 0);
}

/* Friendly readable location name for a dropsite location key. */
export function locDisplayName(ds, key) {
  if (key === 'ground') return `${ds.base.name} (ground)`;
  const fi = parseInt(key.replace('feat', ''));
  const fk = ds.features[fi];
  const f = FEATURES[fk];
  return `${f.glyph ? f.glyph + ' ' : ''}${f.name}`;
}

/* Resolve Battalion Combat for all dropsites (Asset Phase step 1). */
export function resolveBattalionCombat(state) {
  const log = [];
  if (!state.scenarioData || !state.scenarioData.dropsites) return log;
  state.scenarioData.dropsites.forEach(ds => {
    const b = dsBattalions(ds);
    Object.keys(b).forEach(key => {
      const loc = b[key];
      const u = loc.player1 || 0, s = loc.player2 || 0;
      if (u > 0 && s > 0) {
        const removed = Math.min(u, s);
        loc.player1 = u - removed;
        loc.player2 = s - removed;
        log.push({ where: locDisplayName(ds, key), removed, u, s, nu: loc.player1, ns: loc.player2 });
      }
    });
  });
  return log;
}

/* Aegis-X: the best Aegis value protecting a target group. */
export function aegisValueForGroup(state, targetGid) {
  const tg = state.groups[targetGid];
  if (!tg) return 0;
  const tdef = getDef(state, targetGid);
  const tside = tdef.side;
  const tShip = tg.ships.find(s => !s.destroyed && !s.offTable);
  if (!tShip) return 0;
  const tLayer = tShip.layer || 'orbit';
  let best = 0;
  Object.keys(state.groups).forEach(gid => {
    const def = getDef(state, gid);
    if (def.side !== tside) return;
    const m = (def.special || '').match(/Aegis-(\d)/i);
    if (!m) return;
    const y = parseInt(m[1]);
    const src = state.groups[gid].ships.find(s => !s.destroyed && !s.offTable && (s.layer||'orbit') === tLayer);
    if (src && Math.hypot(src.x - tShip.x, src.y - tShip.y) <= 6 * INCH) best = Math.max(best, y);
  });
  ((state.scenarioData && state.scenarioData.dropsites) || []).forEach(ds => {
    if (ds.destroyed) return;
    const hasAegis = (ds.features || []).some((fk, fi) => fk === 'aegis_platform' && !(ds.destroyedFeatures||[]).includes(fi));
    if (!hasAegis) return;
    if (dropsiteController(ds) !== tside) return;
    if (tLayer !== 'orbit') return;
    if (Math.hypot(inchToPx(ds.x) - tShip.x, inchToPx(ds.y) - tShip.y) <= 6 * INCH) best = Math.max(best, 4);
  });
  return best;
}

/* A Dropsite within 6" of `ship` that hasn't been surveyed by `side`. Returns it or null. */
export function surveyableDropsite(state, ship, side) {
  const dss = (state.scenarioData && state.scenarioData.dropsites) || [];
  for (const ds of dss) {
    if (ds.destroyed) continue;
    if (ds.surveyedBy && ds.surveyedBy.includes(side)) continue;
    if (Math.hypot(ship.x - inchToPx(ds.x), ship.y - inchToPx(ds.y)) <= 6 * INCH) return ds;
  }
  return null;
}

/* A Dropsite within 6" that this side can Assess (once per dropsite per game).
   Eligible if ds.siteRules contains 'assess' (both sides) or 'assess_<zone>' for this side. */
export function assessableDropsite(state, ship, side) {
  const dss = (state.scenarioData && state.scenarioData.dropsites) || [];
  const zone = state.deployZone && state.deployZone[side];
  const assessed = (state.assessedDropsites && state.assessedDropsites[side]) || [];
  for (const ds of dss) {
    if (ds.destroyed) continue;
    if (assessed.includes(ds.id)) continue;
    const sr = ds.siteRules || [];
    if (!(sr.includes('assess') || (zone && sr.includes(`assess_${zone}`)))) continue;
    if (Math.hypot(ship.x - inchToPx(ds.x), ship.y - inchToPx(ds.y)) <= 6 * INCH) return ds;
  }
  return null;
}

/* Transport VALUE of a ship — largest launch `n` among ground-transport assets. */
export function transportValue(def) {
  if (!def.launch) return 0;
  let v = 0;
  def.launch.forEach(l => { if (/lander|dropship|drop_pod|boarding_pod|gate_dropship/i.test(l.type)) v = Math.max(v, l.n || 0); });
  return v;
}

/* A Dropsite within 6" of `ship` that still holds Recon Operatives. Returns it or null. */
export function extractableDropsite(state, ship, side) {
  const dss = (state.scenarioData && state.scenarioData.dropsites) || [];
  for (const ds of dss) {
    if (ds.destroyed || !(ds.reconOps > 0)) continue;
    if (Math.hypot(ship.x - inchToPx(ds.x), ship.y - inchToPx(ds.y)) <= 6 * INCH) return ds;
  }
  return null;
}

/* A dropsite is "contested" if both sides have any battalions on it. */
export function dropsiteContested(ds) {
  return dsSideBattalions(ds, 'player1') > 0 && dsSideBattalions(ds, 'player2') > 0;
}

/* Which side Controls a dropsite. Returns 'player1' | 'player2' | null. */
export function dropsiteController(ds) {
  const u = dsSideBattalions(ds, 'player1'), s = dsSideBattalions(ds, 'player2');
  if (u > 0 && s === 0) return 'player1';
  if (s > 0 && u === 0) return 'player2';
  return null;
}

/* Launchable features on a dropsite (those with a `launch` profile). */
export function dropsiteLaunchFeatures(ds) {
  const out = [];
  (ds.features || []).forEach((fk, fi) => {
    const f = FEATURES[fk];
    if (f && f.launch && f.launch.length && !(ds.destroyedFeatures||[]).includes(fi)) {
      out.push({ fi, fk, f });
    }
  });
  return out;
}

/* Features on a dropsite with a weapon. */
export function dropsiteWeaponFeatures(ds) {
  const out = [];
  (ds.features || []).forEach((fk, fi) => {
    const f = FEATURES[fk];
    if (f && f.weapon && !(ds.destroyedFeatures||[]).includes(fi)) out.push({ fi, fk, f });
  });
  return out;
}

/* An eligible Escort Group for a hit on (gid,si). Returns {gid,name} or null. */
export function eligibleEscort(state, targetGid, targetSi) {
  const tdef = getDef(state, targetGid);
  if (!tdef || !['H','C'].includes(tdef.tonnage)) return null;
  const tShip = state.groups[targetGid] && state.groups[targetGid].ships[targetSi];
  if (!tShip || tShip.destroyed) return null;
  const side = tdef.side, tLayer = tShip.layer || 'orbit';
  let found = null;
  fleetForSide(state, side).forEach(def => {
    if (found || !/Escort/i.test(def.special || '') || def.id === targetGid) return;
    const grp = state.groups[def.id];
    if (!grp) return;
    const src = grp.ships.find(s => !s.destroyed && !s.offTable && (s.layer||'orbit') === tLayer);
    if (src && Math.hypot(src.x - tShip.x, src.y - tShip.y) <= 6 * INCH) found = { gid: def.id, name: def.name };
  });
  return found;
}

/* Highest Command Ship-X among `side`'s on-table, non-destroyed ships (0 if none). */
export function commandShipBonus(state, side) {
  let best = 0;
  fleetForSide(state, side).forEach(def => {
    const m = (def.special || '').match(/Command Ship-(\d)/i);
    if (!m) return;
    const grp = state.groups[def.id];
    if (grp && grp.ships.some(s => !s.destroyed && !s.offTable)) best = Math.max(best, parseInt(m[1]));
  });
  return best;
}

/* Does `side` Control a dropsite with a working Comms Station? */
export function sideHasCommsUplink(state, side) {
  return ((state.scenarioData && state.scenarioData.dropsites) || []).some(ds => {
    if (ds.destroyed || dropsiteController(ds) !== side) return false;
    return (ds.features || []).some((fk, fi) => fk === 'comms_station' && !(ds.destroyedFeatures||[]).includes(fi));
  });
}

/* Remove a feature from a dropsite. Power Plant is Volatile. */
export function destroyFeature(state, rng, ds, fi) {
  ds.destroyedFeatures = ds.destroyedFeatures || [];
  if (ds.destroyedFeatures.includes(fi)) return;
  const fkey = ds.features[fi];
  ds.destroyedFeatures.push(fi);
  if (fkey === 'power_plant') {
    const dsx = inchToPx(ds.x), dsy = inchToPx(ds.y);
    Object.keys(state.groups).forEach(gid => {
      const g = state.groups[gid];
      if (g.ships.some(s => !s.destroyed && !s.offTable && Math.hypot(s.x - dsx, s.y - dsy) <= 3 * INCH)) g.spikes = (g.spikes || 0) + 1;
    });
    const extra = (Math.ceil(rollDie(rng)/2) + Math.ceil(rollDie(rng)/2)); // 2D3
    ds.damage = (ds.damage || 0) + extra;
    if (ds.maxHull && ds.damage >= ds.maxHull) ds.destroyed = true;
    // RSE: check if the linked station loses its BS save when this city's last power plant falls.
    const layKey = state.scenario && state.scenario.layout;
    const layout = layKey && LAYOUTS[layKey];
    if (layout && layout.stationCityLinks) {
      const stId = Object.keys(layout.stationCityLinks).find(k => layout.stationCityLinks[k] === ds.id);
      if (stId) {
        const remainingPlants = (ds.features || []).filter((fk2, fi2) => fk2 === 'power_plant' && !(ds.destroyedFeatures||[]).includes(fi2)).length;
        const stDs = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === stId);
        const stName = (stDs && stDs.base && stDs.base.name) || stId;
        if (remainingPlants === 0) logEvent(state, `${ds.base ? ds.base.name : ds.id}: last Power Plant destroyed — ${stName} loses BS 5+ save`);
      }
    }
  }
}

/* All contested dropsites not yet resolved this combat. */
export function contestedDropsites(state) {
  if (!state.scenarioData || !state.scenarioData.dropsites) return [];
  const done = (state.battalionCombat && state.battalionCombat.done) || [];
  return state.scenarioData.dropsites.filter(ds => dropsiteContested(ds) && !done.includes(ds.id));
}

/* Features on a dropsite that hold ENEMY battalions (relative to `side`). */
export function enemyFeatures(ds, side) {
  const enemy = side === 'player1' ? 'player2' : 'player1';
  const b = dsBattalions(ds);
  return Object.keys(b).filter(k => k !== 'ground' && (b[k][enemy] || 0) > 0);
}

/* Stage 1/2: a side's GROUND battalions attack one Feature; 1-for-1 removal. */
export function assignGroundToFeature(ds, side, featKey) {
  const enemy = side === 'player1' ? 'player2' : 'player1';
  const b = dsBattalions(ds);
  const removed = Math.min(b.ground[side] || 0, b[featKey][enemy] || 0);
  b.ground[side] -= removed;
  b[featKey][enemy] -= removed;
  return { removed, where: locDisplayName(ds, featKey) };
}

/* Stages 3+4: remaining 1-for-1 on the ground, then each feature locally. */
export function resolveDropsiteRemainder(ds) {
  const b = dsBattalions(ds);
  const log = [];
  Object.keys(b).forEach(key => {
    const loc = b[key];
    const u = loc.player1 || 0, s = loc.player2 || 0;
    if (u > 0 && s > 0) {
      const removed = Math.min(u, s);
      loc.player1 = u - removed; loc.player2 = s - removed;
      log.push({ where: locDisplayName(ds, key), removed });
    }
  });
  return log;
}

/* Finish a dropsite: resolve remaining combat, mark it done, return to pick stage. */
export function bcResolveDropsite(state, bc, ds) {
  const rem = resolveDropsiteRemainder(ds);
  rem.forEach(r => {
    bc.log.push(`${ds.base.name}: ${r.where} remainder — ${r.removed} each`);
    logEvent(state, `${ds.base.name}: ${r.where} remainder — ${r.removed} battalions each side destroyed`, 'battalion');
  });
  bc.done = bc.done || [];
  if (!bc.done.includes(ds.id)) bc.done.push(ds.id);
  bc.dsId = null;
  bc.stage = 'pick';
}

/* Features eligible to be destroyed: 4+ friendly battalions, no enemy present. */
export function featureDestroyOptions(state) {
  const opts = [];
  if (!state.scenarioData) return opts;
  state.scenarioData.dropsites.forEach(ds => {
    const b = dsBattalions(ds);
    Object.keys(b).forEach(key => {
      if (key === 'ground') return;
      const loc = b[key];
      ['player1', 'player2'].forEach(side => {
        const enemy = side === 'player1' ? 'player2' : 'player1';
        if ((loc[side] || 0) >= 4 && (loc[enemy] || 0) === 0) {
          opts.push({ dsId: ds.id, key, side, name: locDisplayName(ds, key) });
        }
      });
    });
  });
  return opts;
}

/* Effective signature (inches) for a ship. */
export function effectiveSig(def, ship, grp) {
  const base = ship && ship.sigSilent ? 0 : def.sig;
  const spikes = grp ? (grp.spikes || 0) : 0;
  return base + 3 * spikes;
}

export function launchTargetLabel(target) {
  return {
    dropsite_same_layer: 'target dropsite (same layer)',
    dropsite_via_gate:   'target dropsite via Voidgate chain',
    dropsite_any_layer:  'target dropsite (any layer)',
    city:                'target city',
    ship_or_station:     'target enemy ship / station',
    point:               'place on map'
  }[target] || 'target';
}

export function launchHint(target) {
  return {
    dropsite_same_layer: 'Click a dropsite in range on the SAME orbital layer',
    dropsite_via_gate:   'Click a dropsite within 3" of a chained Voidgate',
    dropsite_any_layer:  'Click any dropsite in range',
    city:                'Click a city in range',
    ship_or_station:     'Click an enemy ship or space station in range',
    point:               'Click a point in range to place the asset'
  }[target] || 'Click a target in range';
}

/* All friendly Voidgates (Gateships) connected to a Mothership via the 18" chain (BFS). */
export function connectedGateships(state, motherSide, motherX, motherY) {
  const CHAIN_IN = 18, CHAIN_PX = CHAIN_IN * INCH;
  const gates = [];
  fleetForSide(state, motherSide).forEach(def => {
    if (!def.openNetwork) return;
    const grp = state.groups[def.id];
    if (!grp) return;
    grp.ships.forEach((s, si) => {
      if (s.destroyed || s.offTable) return;
      // MT / WF / DC orders disable the gateship — exclude from network.
      if (grp.order && ['MT', 'WF', 'DC'].includes(grp.order)) return;
      gates.push({ ship: s, def, si, x: s.x, y: s.y, layer: s.layer || 'orbit',
                   gateship: def.gateship || 0, connected: false });
    });
  });
  const queue = [];
  gates.forEach(g => {
    if (Math.hypot(g.x - motherX, g.y - motherY) <= CHAIN_PX) { g.connected = true; queue.push(g); }
  });
  while (queue.length) {
    const cur = queue.shift();
    gates.forEach(g => {
      if (!g.connected && Math.hypot(g.x - cur.x, g.y - cur.y) <= CHAIN_PX) {
        g.connected = true; queue.push(g);
      }
    });
  }
  return gates.filter(g => g.connected);
}

/* Remaining Gateship value for a Voidgate ship this round (lazily init). */
export function gateRemaining(gateShip, def) {
  if (gateShip.gateRemaining === undefined) gateShip.gateRemaining = def.gateship || 0;
  return gateShip.gateRemaining;
}

/* Compute effective move range and resulting layer for a ship's move. */
export function layerMove(normalMaxPx, ship, toggle) {
  const layer = ship.layer || 'orbit';
  if (layer === 'orbit') {
    if (toggle) return { maxPx: normalMaxPx, endLayer: 'atmosphere', label: 'Descend to Atmosphere (end of move)' };
    return { maxPx: normalMaxPx, endLayer: 'orbit', label: null };
  } else { // atmosphere
    const decayed = ship.crippling && ship.crippling.includes('decay');
    if (toggle && !decayed) {
      const reduced = Math.max(0, normalMaxPx - 4 * INCH);
      return { maxPx: reduced, endLayer: 'orbit', label: 'Ascend to Orbit (−4" this move)' };
    }
    return { maxPx: 2 * INCH, endLayer: 'atmosphere', label: decayed ? 'In Atmosphere — Orbital Decay (cannot ascend)' : 'In Atmosphere (move capped 2")' };
  }
}

/* Are all alive on-table ships in a group in the same layer? Returns split info. */
export function groupLayerSplit(state, def) {
  const grp = getGroup(state, def.id);
  let orbit = 0, atmo = 0;
  grp.ships.forEach(s => {
    if (s.destroyed || s.offTable) return;
    if ((s.layer || 'orbit') === 'atmosphere') atmo++; else orbit++;
  });
  return { split: orbit > 0 && atmo > 0, orbit, atmo };
}

/* All other on-table ships' base circles, excluding (skipGid, skipSi). */
export function otherShipBases(state, skipGid, skipSi) {
  const out = [];
  allDefs(state).forEach(d => {
    const g = state.groups[d.id];
    if (!g) return;
    const r = inchToPx(d.base === 'L' ? 16/25.4 : d.base === 'M' ? 20/25.4 : d.base === 'H' ? 25/25.4 : 16/25.4);
    g.ships.forEach((s, si) => {
      if (s.destroyed || s.offTable) return;
      if (d.id === skipGid && si === skipSi) return;
      out.push({ x: s.x, y: s.y, r });
    });
  });
  if (state.scenarioData && state.scenarioData.dropsites) {
    const stationDiaIn = { small: 30/25.4, medium: 40/25.4, large: 50/25.4 };
    state.scenarioData.dropsites.forEach(ds => {
      if (ds.base.category !== 'station') return;
      const r = (stationDiaIn[ds.base.size] * INCH) / 2;
      out.push({ x: inchToPx(ds.x), y: inchToPx(ds.y), r });
    });
  }
  return out;
}

/* Does a base of radius r at (x,y) overlap any of the given bases? */
export function baseOverlaps(x, y, r, bases) {
  return bases.some(b => Math.hypot(x - b.x, y - b.y) < (r + b.r - 0.01));
}

/* Back a moving ship (radius r) toward origin until its base no longer overlaps any other. */
export function resolveBaseOverlap(ox, oy, tx, ty, r, bases) {
  if (!baseOverlaps(tx, ty, r, bases)) return { x: tx, y: ty };
  const dx = tx - ox, dy = ty - oy;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return { x: tx, y: ty };
  const step = 1; // px
  for (let d = len; d >= 0; d -= step) {
    const t = d / len;
    const x = ox + dx * t, y = oy + dy * t;
    if (!baseOverlaps(x, y, r, bases)) return { x, y };
  }
  return { x: ox, y: oy };
}

// ── SECTION D: GEOMETRY UTILITIES ──

/* Is a point (xIn, yIn) inside the given zone (inch coords)? */
export function isInZone(xIn, yIn, zone) {
  if (zone.polygon) return pointInPolygon(xIn, yIn, zone.polygon);
  if (zone.circle) {
    const c = zone.circle;
    return Math.hypot(xIn - c.cx, yIn - c.cy) <= c.r;
  }
  if (zone.circleQuad) {
    const c = zone.circleQuad;
    const dx = xIn - c.cx, dy = yIn - c.cy;
    if (Math.hypot(dx, dy) > c.r) return false;
    if (c.quad === 'br') return dx >= 0 && dy >= 0;
    if (c.quad === 'tl') return dx <= 0 && dy <= 0;
    if (c.quad === 'tr') return dx >= 0 && dy <= 0;
    if (c.quad === 'bl') return dx <= 0 && dy >= 0;
  }
  if (zone.edgeSemicircle) {
    const c = zone.edgeSemicircle;
    if (Math.hypot(xIn - c.cx, yIn - c.cy) > c.r) return false;
    if (c.edge === 'top')    return yIn >= c.cy;
    if (c.edge === 'bottom') return yIn <= c.cy;
    if (c.edge === 'left')   return xIn >= c.cx;
    if (c.edge === 'right')  return xIn <= c.cx;
  }
  if (zone.corners) return zone.corners.some(cz => isInZone(xIn, yIn, { circleQuad: cz }));
  if (zone.edgeLines) {
    return zone.edgeLines.some(seg => distancePointToSegmentIn(xIn, yIn, seg) <= 0.6);
  }
  return false;
}

/* Distance from point (px,py) in inches to a segment {x1,y1,x2,y2} in inches. */
export function distancePointToSegmentIn(px, py, seg) {
  const vx = seg.x2 - seg.x1, vy = seg.y2 - seg.y1;
  const wx = px - seg.x1,   wy = py - seg.y1;
  const len2 = vx*vx + vy*vy;
  if (len2 === 0) return Math.hypot(wx, wy);
  let t = (wx*vx + wy*vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = seg.x1 + t*vx, cy = seg.y1 + t*vy;
  return Math.hypot(px - cx, py - cy);
}

/* True if a point is inside the Vanguard halo for a given def + base zone. */
export function isInVanguardZone(state, xIn, yIn, def, baseZone) {
  if (!def.vanguard || !state.scenario) return false;
  const X = def.vanguard;
  const depKey = state.scenario.deployment;
  let z = {};
  if (depKey === 'line' && baseZone.edgeLines) {
    z.polygon = stripFromEdgeLine(baseZone.edgeLines[0], X);
  } else if (depKey === 'attacker_defender' || depKey === 'defender_edge') {
    if (baseZone.edgeLines) {
      z.polygon = stripFromEdgeLine(baseZone.edgeLines[0], X);
    } else if (baseZone.polygon) {
      z.polygon = expandStripPolygon(baseZone.polygon, X);
    }
  } else if ((depKey === 'table_corners' || depKey === 'diagonal_corners') && baseZone.edgeLines) {
    const polys = baseZone.edgeLines.map(seg => stripFromEdgeLine(seg, X));
    return polys.some(p => pointInPolygon(xIn, yIn, p));
  } else if (depKey === 'midboard' && baseZone.edgeSemicircle) {
    z.edgeSemicircle = { ...baseZone.edgeSemicircle, r: baseZone.edgeSemicircle.r + X };
  } else if (depKey === 'from_corners' && baseZone.circleQuad) {
    z.circleQuad = { ...baseZone.circleQuad, r: baseZone.circleQuad.r + X };
  } else if (depKey === 'encirclement') {
    if (baseZone.circle)  z.circle  = { ...baseZone.circle,  r: baseZone.circle.r  + X };
    if (baseZone.corners) z.corners = baseZone.corners.map(c => ({ ...c, r: c.r + X }));
  }
  return isInZone(xIn, yIn, z);
}

/* Build a strip polygon X" deep extending into the board from an edge segment. */
export function stripFromEdgeLine(seg, X) {
  const onTop    = seg.y1 <= 0.5 && seg.y2 <= 0.5;
  const onBottom = seg.y1 >= BOARD_IN - 0.5 && seg.y2 >= BOARD_IN - 0.5;
  const onLeft   = seg.x1 <= 0.5 && seg.x2 <= 0.5;
  const onRight  = seg.x1 >= BOARD_IN - 0.5 && seg.x2 >= BOARD_IN - 0.5;
  if (onTop) {
    const x1 = Math.min(seg.x1, seg.x2), x2 = Math.max(seg.x1, seg.x2);
    return [{x:x1,y:0},{x:x2,y:0},{x:x2,y:X},{x:x1,y:X}];
  } else if (onBottom) {
    const x1 = Math.min(seg.x1, seg.x2), x2 = Math.max(seg.x1, seg.x2);
    return [{x:x1,y:BOARD_IN},{x:x2,y:BOARD_IN},{x:x2,y:BOARD_IN-X},{x:x1,y:BOARD_IN-X}];
  } else if (onLeft) {
    const y1 = Math.min(seg.y1, seg.y2), y2 = Math.max(seg.y1, seg.y2);
    return [{x:0,y:y1},{x:0,y:y2},{x:X,y:y2},{x:X,y:y1}];
  } else if (onRight) {
    const y1 = Math.min(seg.y1, seg.y2), y2 = Math.max(seg.y1, seg.y2);
    return [{x:BOARD_IN,y:y1},{x:BOARD_IN,y:y2},{x:BOARD_IN-X,y:y2},{x:BOARD_IN-X,y:y1}];
  }
  return [];
}

/* Expand an axis-aligned strip polygon's inner edge X" further into the board. */
export function expandStripPolygon(polygon, X) {
  const cxAvg = polygon.reduce((s,p)=>s+p.x,0)/polygon.length;
  const cyAvg = polygon.reduce((s,p)=>s+p.y,0)/polygon.length;
  return polygon.map(p => {
    const onLeft   = p.x <= 1.6;
    const onRight  = p.x >= BOARD_IN - 1.6;
    const onTop    = p.y <= 1.6;
    const onBottom = p.y >= BOARD_IN - 1.6;
    let nx = p.x, ny = p.y;
    if (!onLeft && !onRight)  nx = (cxAvg < BOARD_IN/2) ? p.x + X : p.x - X;
    if (!onTop  && !onBottom) ny = (cyAvg < BOARD_IN/2) ? p.y + X : p.y - X;
    return { x: nx, y: ny };
  });
}

/* Ray-casting point-in-polygon test. Polygon uses inch coordinates. */
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/* Do two segments (px) intersect? */
export function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx-ax)*(dy-cy) - (by-ay)*(dx-cx);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((cx-ax)*(dy-cy) - (cy-ay)*(dx-cx)) / d;
  const u = ((cx-ax)*(by-ay) - (cy-ay)*(bx-ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/* Does a segment cross a rotated rectangle (cloud/field), in px? */
export function segCrossesRect(ax, ay, bx, by, cx, cy, wpx, hpx, angleDeg) {
  const rad = -angleDeg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const tx = (x, y) => ({ x: (x-cx)*cos - (y-cy)*sin, y: (x-cx)*sin + (y-cy)*cos });
  const p = tx(ax, ay), q = tx(bx, by);
  const hw = wpx/2, hh = hpx/2;
  const inside = (pt) => pt.x >= -hw && pt.x <= hw && pt.y >= -hh && pt.y <= hh;
  if (inside(p) || inside(q)) return true;
  const edges = [[-hw,-hh,hw,-hh],[hw,-hh,hw,hh],[hw,hh,-hw,hh],[-hw,hh,-hw,-hh]];
  return edges.some(e => segsIntersect(p.x,p.y,q.x,q.y, e[0],e[1],e[2],e[3]));
}

/* Does a segment cross a planetary ring (a full-board line)? */
export function segCrossesRing(ax, ay, bx, by, ring) {
  if (ring.axis === 'horizontal') { const ry = inchToPx(ring.y); return (ay - ry) * (by - ry) <= 0; }
  const rx = inchToPx(ring.x); return (ax - rx) * (bx - rx) <= 0;
}

/* Does a segment cross/enter a circle (large object), in px? */
export function segCrossesCircle(ax, ay, bx, by, cx, cy, r) {
  const dx = bx-ax, dy = by-ay; const len2 = dx*dx+dy*dy || 1;
  let t = ((cx-ax)*dx + (cy-ay)*dy) / len2; t = Math.max(0, Math.min(1, t));
  const px = ax + t*dx, py = ay + t*dy;
  return Math.hypot(px-cx, py-cy) <= r;
}

/* Is a point inside any large object? (px) Returns the object, or null. */
export function largeObjectAt(state, xpx, ypx) {
  const objs = (state.scenarioData && state.scenarioData.largeObjects) || [];
  for (const o of objs) { if (Math.hypot(xpx - inchToPx(o.x), ypx - inchToPx(o.y)) <= inchToPx(o.diameter/2)) return o; }
  return null;
}

/* Analyse a LoS line (attacker→target, px). Returns scenery effects: {blocked, ignoreSpikes, ignoreSig}. */
export function sceneryAttackEffects(state, ax, ay, bx, by, attackerShip, targetShip) {
  const res = { blocked: false, ignoreSpikes: false, ignoreSig: false };
  const sd = state.scenarioData; if (!sd) return res;
  const bothAtmo = (attackerShip && attackerShip.layer === 'atmosphere') && (targetShip && targetShip.layer === 'atmosphere');
  if (bothAtmo) return res;
  (sd.largeObjects || []).forEach(o => {
    if (segCrossesCircle(ax, ay, bx, by, inchToPx(o.x), inchToPx(o.y), inchToPx(o.diameter/2))) res.blocked = true;
  });
  (sd.rings || []).forEach(r => { if (segCrossesRing(ax, ay, bx, by, r)) res.ignoreSpikes = true; });
  (sd.placedScenery || []).forEach(s => {
    if (segCrossesRect(ax, ay, bx, by, inchToPx(s.x), inchToPx(s.y), inchToPx(6), inchToPx(3), s.angle||0)) {
      res.ignoreSpikes = true;
      if (s.type === 'dense') res.ignoreSig = true;
    }
  });
  return res;
}

/* Ship move-through hits: returns [{type:'K'|'C', n:2, label}] for each cloud/field crossed (orbit only). */
export function sceneryMoveHits(state, ax, ay, bx, by, ship) {
  const out = []; const sd = state.scenarioData;
  if (!sd || (ship && ship.layer === 'atmosphere')) return out;
  (sd.placedScenery || []).forEach(s => {
    if (segCrossesRect(ax, ay, bx, by, inchToPx(s.x), inchToPx(s.y), inchToPx(6), inchToPx(3), s.angle||0)) {
      if (s.type === 'micrometeor') out.push({ type: 'K', n: 2, label: 'Micrometeor Cloud' });
      else out.push({ type: 'C', n: 2, label: 'Dense Field' });
    }
  });
  return out;
}

/* Distance (inches) from a point to a deployment zone's geometry. 0 if inside. */
export function distToZone(zone, x, y) {
  if (!zone) return Infinity;
  const distToSeg = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx*dx + dy*dy || 1;
    let t = ((px - x1)*dx + (py - y1)*dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t*dx), py - (y1 + t*dy));
  };
  let best = Infinity;
  if (zone.edgeLines) zone.edgeLines.forEach(l => { best = Math.min(best, distToSeg(x, y, l.x1, l.y1, l.x2, l.y2)); });
  if (zone.circle) { const c = zone.circle; best = Math.min(best, Math.max(0, Math.hypot(x-c.cx, y-c.cy) - c.r)); }
  if (zone.circleQuad) { const c = zone.circleQuad; best = Math.min(best, Math.max(0, Math.hypot(x-c.cx, y-c.cy) - c.r)); }
  if (zone.edgeSemicircle) { const c = zone.edgeSemicircle; best = Math.min(best, Math.max(0, Math.hypot(x-c.cx, y-c.cy) - c.r)); }
  if (zone.corners) zone.corners.forEach(c => { best = Math.min(best, Math.max(0, Math.hypot(x-c.cx, y-c.cy) - c.r)); });
  if (zone.polygon) {
    const pts = zone.polygon; let inside = false;
    for (let i = 0, j = pts.length-1; i < pts.length; j = i++) {
      if (((pts[i].y > y) !== (pts[j].y > y)) &&
          (x < (pts[j].x - pts[i].x) * (y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x)) inside = !inside;
    }
    if (inside) best = 0;
    else for (let i = 0, j = pts.length-1; i < pts.length; j = i++)
      best = Math.min(best, distToSeg(x, y, pts[j].x, pts[j].y, pts[i].x, pts[i].y));
  }
  return best;
}

/* Validate a candidate scenery position (in inches). Returns {ok, reason}. */
export function sceneryValid(state, type, xIn, yIn) {
  const MIN = 4;
  if (xIn < MIN || yIn < MIN || xIn > BOARD_IN - MIN || yIn > BOARD_IN - MIN)
    return { ok: false, reason: 'too close to board edge (4")' };
  const dep = state.scenario && DEPLOYMENTS[state.scenario.deployment];
  if (dep) {
    for (const z of [dep.zones.south, dep.zones.north]) {
      if (z && distToZone(z, xIn, yIn) < MIN) return { ok: false, reason: 'too close to a deployment zone (4")' };
    }
  }
  for (const s of (state.scenarioData.placedScenery || [])) {
    if (s.type === type) continue;
    if (Math.hypot(s.x - xIn, s.y - yIn) < MIN) return { ok: false, reason: 'too close to other scenery (4")' };
  }
  for (const obj of (state.scenarioData.largeObjects || [])) {
    if (Math.hypot(obj.x - xIn, obj.y - yIn) < obj.diameter / 2 + MIN) return { ok: false, reason: 'too close to a large object (4")' };
  }
  return { ok: true };
}

// ── SECTION E: DEPLOYMENT LOGIC ──

/* Can a group deploy during the deploy phase right now? */
export function canDeployNow(state, def) {
  if (def.vanguard) return true;
  return approachFor(state, def.side) === 'directly_deploy';
}

/* Can an undeployed Group activate (and arrive) THIS round? */
export function canActivateOffTable(state, def) {
  if (!state.scenario) return { eligible: false, reason: 'No scenario' };
  const app = approachFor(state, def.side);
  const r = state.round;
  if (app === 'directly_deploy') {
    if (r >= 2) return { eligible: true };
    return { eligible: false, reason: 'Direct: available from Round 2' };
  }
  if (app === 'close') {
    return { eligible: true };
  }
  if (app === 'distant') {
    if (def.vanguard) return { eligible: true };
    const t = def.tonnage;
    if (r >= 3) return { eligible: true };
    if (r === 2 && (t === 'L' || t === 'M')) return { eligible: true };
    if (r === 1 && t === 'L') return { eligible: true };
    const tName = t === 'L' ? 'Light' : t === 'M' ? 'Medium' : t === 'H' ? 'Heavy' : 'Colossal';
    const arriveR = t === 'M' ? 2 : 3;
    return { eligible: false, reason: `Distant ${tName}: available from Round ${arriveR}` };
  }
  // ── Scenario Expansion 1 approaches ──
  // Imminent: R1 L & M only · R2 also H · R3+ any.
  if (app === 'imminent') {
    if (def.vanguard) return { eligible: true };
    const t = def.tonnage;
    if (r >= 3) return { eligible: true };
    if (r === 2 && (t === 'L' || t === 'M' || t === 'H')) return { eligible: true };
    if (r === 1 && (t === 'L' || t === 'M')) return { eligible: true };
    const tName = t === 'H' ? 'Heavy' : 'Colossal';
    const arriveR = t === 'H' ? 2 : 3;
    return { eligible: false, reason: `Imminent ${tName}: available from Round ${arriveR}` };
  }
  // Backline: R1 H & C only · R2+ any. Vanguard-X used as normal.
  if (app === 'backline') {
    if (def.vanguard) return { eligible: true };
    const t = def.tonnage;
    if (r >= 2) return { eligible: true };
    if (r === 1 && (t === 'H' || t === 'C')) return { eligible: true };
    const tName = t === 'L' ? 'Light' : 'Medium';
    return { eligible: false, reason: `Backline ${tName}: available from Round 2` };
  }
  // Staggered: X Groups per round (R1: X, R2: X more, R3+: rest). Vanguard-X as normal.
  if (app === 'staggered') {
    if (def.vanguard) return { eligible: true };
    if (r >= 3) return { eligible: true };
    const sideDefs = fleetForSide(state, def.side);
    const totalPts = sideDefs.reduce((sum, d) => sum + (d.pts || 0), 0);
    const X = totalPts <= 1000 ? 1
            : totalPts <= 2000 ? 2
            : totalPts <= 3000 ? 3
            : 4 + Math.floor((totalPts - 3001) / 1000);
    const arrivedCount = sideDefs.filter(d => {
      if (d.vanguard) return false;
      const grp = state.groups[d.id];
      return grp && grp.ships.some(s => !s.offTable);
    }).length;
    const limit = r * X;
    if (arrivedCount >= limit) return { eligible: false, reason: `Staggered: ${arrivedCount}/${limit} groups deployed (X=${X})` };
    return { eligible: true };
  }
  return { eligible: false, reason: 'Unknown approach' };
}

/* Is this Group currently undeployed (no alive ships on-table)? */
export function isGroupUndeployed(state, gid) {
  const grp = state.groups[gid];
  if (!grp) return false;
  return !grp.ships.some(s => !s.destroyed && !s.offTable);
}

/* Direct deployment 50% status for a side. Returns { eligible, placed, required } or null. */
export function directDeploymentStatus(state, side) {
  if (approachFor(state, side) !== 'directly_deploy') return null;
  const fleet = fleetForSide(state, side);
  const nonVg = fleet.filter(d => !d.vanguard);
  const placed = nonVg.filter(def => {
    const grp = state.groups[def.id];
    if (!grp) return false;
    return grp.ships.some(s => !s.destroyed && !s.offTable);
  }).length;
  const required = Math.ceil(nonVg.length / 2);
  return { eligible: nonVg.length, placed, required };
}

/* Return the approach type for a side given the current scenario. */
export function approachFor(state, side) {
  if (!state.scenario) return 'close';
  const app = APPROACHES[state.scenario.approach];
  const zone = state.deployZone && state.deployZone[side];
  return zone ? app[zone] : app.south;
}

/* Count of still-undeployed deploy-eligible Groups for a side. */
export function undeployedDeployableCount(state, side) {
  return fleetForSide(state, side).filter(def => {
    if (!canDeployNow(state, def)) return false;
    const grp = state.groups[def.id];
    if (!grp) return false;
    return grp.ships.some(s => !s.destroyed && s.offTable);
  }).length;
}

/* Is a side allowed to deploy right now? Red goes first unless Red has nothing to deploy. */
export function deploySideAllowed(state, side) {
  if (state.phase !== 'deploy') return true;
  if (state.deployDone[side]) return false;
  if (side === 'player1') return true;
  if (!sideNeedsDeployPhase(state, 'player1')) return true;
  return state.deployDone.player1 === true;
}

/* Does the current scenario require a manual deploy phase? */
export function anyoneNeedsDeployPhase(state) {
  if (!state.scenario) return true;
  const redApp  = approachFor(state, 'player1');
  const blueApp = approachFor(state, 'player2');
  if (redApp === 'directly_deploy' || blueApp === 'directly_deploy') return true;
  const _allDefs = allDefs(state);
  if (_allDefs.some(d => d.vanguard)) return true;
  return false;
}

/* Does this side have vanguard or direct-deploy ships that require the deploy phase? */
export function sideNeedsDeployPhase(state, side) {
  if (!state.scenario) return true;
  if (approachFor(state, side) === 'directly_deploy') return true;
  return fleetForSide(state, side).some(d => d.vanguard);
}

/* Mark every ship as off-table with a heading pointing toward the board centre. */
export function initShipsOffTable(state) {
  allDefs(state).forEach(def => {
    const grp = state.groups[def.id];
    if (!grp) return;
    const zone = state.deployZone && state.deployZone[def.side];
    // south zone → face north (heading -90); north zone → face south (heading 90)
    const heading = (zone === 'north') ? 90 : -90;
    grp.ships.forEach(ship => {
      ship.offTable = true;
      ship.heading = heading;
      ship.movedThisRound = false;
    });
  });
}

/* Index of the next undeployed (off-table, alive) ship in a group, or -1 if all placed. */
export function nextUndeployedShipIdx(state, gid) {
  const grp = state.groups[gid];
  if (!grp) return -1;
  for (let i = 0; i < grp.ships.length; i++) {
    const s = grp.ships[i];
    if (!s.destroyed && s.offTable && !s.attachedTo) return i;
  }
  return -1;
}

/* All ships in a group are placed (or destroyed). */
export function allShipsDeployed(state, gid) {
  return nextUndeployedShipIdx(state, gid) === -1;
}

// ── SECTION F: ASSET PHASE MANAGEMENT ──

/* Asset kinds belonging to a given stage type. */
export function kindsForAssetType(type) {
  if (type === 'fighter') return ['fighter'];
  if (type === 'bomber') return ['bomber', 'fireship'];
  if (type === 'torpedo') return ['torpedo'];
  return [];
}

/* Does `side` have an unmoved asset of the given stage type still on the table? */
export function sideHasUnmovedOfType(state, side, type) {
  const kinds = kindsForAssetType(type);
  return (state.launchedAssets || []).some(a => a.side === side && !a.moved && kinds.includes(a.kind));
}

/* Ordered list of {type, side} stages for the current round, initiative side first. */
export function assetStageOrder(state) {
  const init = state.initiativeHolder || 'player1';
  const other = init === 'player1' ? 'player2' : 'player1';
  const stages = [];
  ['fighter', 'bomber', 'torpedo'].forEach(type => {
    stages.push({ type, side: init });
    stages.push({ type, side: other });
  });
  return stages;
}

/* Advance to the FIRST stage (from justFinished) that still has a movable asset. */
export function advanceAssetStage(state, justFinished) {
  if (justFinished && (justFinished.type === 'bomber' || justFinished.type === 'torpedo')) {
    if (sideHasPendingAttacks(state, justFinished.side, justFinished.type)) {
      return { resolveAttacksFor: justFinished.side, resolveType: justFinished.type };
    }
  }
  const order = assetStageOrder(state);
  let startIdx = 0;
  if (justFinished) {
    const i = order.findIndex(s => s.type === justFinished.type && s.side === justFinished.side);
    startIdx = i + 1;
  }
  for (let i = startIdx; i < order.length; i++) {
    if (sideHasUnmovedOfType(state, order[i].side, order[i].type)) {
      state.assetPhase.assetType = order[i].type;
      state.assetActiveSide = order[i].side;
      return { stage: order[i] };
    }
  }
  state.assetPhase.assetType = null;
  state.assetActiveSide = null;
  return { done: true };
}

/* Pending locked attacks owned by `side` for a given stage type. */
export function sideHasPendingAttacks(state, side, type) {
  const kinds = kindsForAssetType(type);
  return (state.launchedAssets || []).some(a => a.bomberTarget && a.side === side && kinds.includes(a.kind));
}

/* Called after a single asset finishes moving. Advances to the next stage if needed. */
export function afterAssetMove(state) {
  const ap = state.assetPhase;
  if (!ap) return;
  const cur = { type: ap.assetType, side: state.assetActiveSide };
  if (cur.side && cur.type && sideHasUnmovedOfType(state, cur.side, cur.type)) return;
  advanceAssetStage(state, cur);
}

/* Any on-table ship carrying enemy Battalions (Boarding candidates)? */
export function anyShipBattalions(state) {
  return Object.keys(state.groups).some(gid => {
    const side = getDef(state, gid).side, enemy = side === 'player1' ? 'player2' : 'player1';
    return state.groups[gid].ships.some(s => !s.destroyed && !s.offTable && s.battalions && s.battalions[enemy] > 0);
  });
}

/* Resolve Boarding Actions (§9.2). Returns a log array. */
export function resolveBoardingActions(state, rng) {
  const log = [];
  Object.keys(state.groups).forEach(gid => {
    const def = getDef(state, gid);
    const owner = def.side, boarder = owner === 'player1' ? 'player2' : 'player1';
    state.groups[gid].ships.forEach((ship, si) => {
      if (ship.destroyed || ship.offTable || !ship.battalions) return;
      let n = ship.battalions[boarder] || 0;
      if (!n) return;
      const marines = (def.special && /Marines-(\d)/i.test(def.special)) ? parseInt(def.special.match(/Marines-(\d)/i)[1]) : 0;
      if (marines) { const rem = Math.min(marines, n); n -= rem; ship.battalions[boarder] -= rem; if (rem) log.push(`${def.name}: Marines repel ${rem} Battalion(s)`); }
      if (n <= 0) return;
      const bv = saveVal(def.bs);
      let unsaved = 0, removed = 0;
      for (let i = 0; i < n; i++) {
        if (bv != null && rollDie(rng) >= bv) { removed++; }
        else unsaved++;
      }
      ship.battalions[boarder] = Math.max(0, (ship.battalions[boarder] || 0) - removed);
      if (unsaved > 0) {
        ship.hull = Math.max(0, ship.hull - unsaved);
        if (ship.hull <= 0) {
          ship.destroyed = true; ship.captured = true;
          recordKill(state, def, boarder, true);
          log.push(`${def.name} CAPTURED by boarding (${unsaved} Core hits)`);
        } else {
          log.push(`${def.name}: ${unsaved} Core hits from boarding${removed?`, ${removed} Battalion(s) repelled`:''} (${ship.hull}/${ship.maxHull})`);
        }
      } else if (removed) {
        log.push(`${def.name}: repelled ${removed} boarding Battalion(s)`);
      }
    });
  });
  return log;
}

/* ── CRIPPLING & EXPLOSION RESOLVERS ──────────────────────────────────────
   Shared rng-driven combat sub-resolvers used by the attack modal, the Repair
   phase, and movement scenery/mine effects. The interactive queue wrappers
   (applyCrippling / applyExplosion / proceedQueues) stay in the client; these
   pure(-ish) resolvers run identically on the server. Rolls are DEFERRED so the
   caller can declare Admiral abilities (Brace / Contain) before rolling. */

const CRIPPLE_TABLE = {
  energy:    { name:'Energy Surge', key:'energy', desc:'Gain a Spike.' },
  structural:{ name:'Structural Damage', key:'structural', desc:'Suffer another point of damage.' },
  fire:      { name:'Fire', key:'fire', desc:'Gain a Fire Token. 1 damage per token each End Phase. Repairable.' },
  defence:   { name:'Defence Systems Offline', key:'defence', desc:'ES/KS/BS/Shield −1; may be targeted as if Focused. Repairable.' },
  scanners:  { name:'Scanners Offline', key:'scanners', desc:'Scan reduced to 1". Repairable.' },
  weapons:   { name:'Weapons Offline', key:'weapons', desc:'Cannot use Weapons or launch Assets. Repairable.' },
  navigation:{ name:'Navigation Offline', key:'navigation', desc:'Movement → 2"; cannot turn or change layer. Repairable.' },
  decay:     { name:'Orbital Decay', key:'decay', desc:'Falls into Atmosphere; cannot move to Orbit. Repairable on 6+.' }
};
export function crippleFor(total) {
  if (total <= 3) return CRIPPLE_TABLE.energy;
  if (total <= 5) return CRIPPLE_TABLE.structural;
  if (total === 6) return CRIPPLE_TABLE.fire;
  if (total === 7) return CRIPPLE_TABLE.defence;
  if (total === 8) return CRIPPLE_TABLE.scanners;
  if (total === 9) return CRIPPLE_TABLE.weapons;
  if (total === 10) return CRIPPLE_TABLE.navigation;
  return CRIPPLE_TABLE.decay;
}
export function makeCrippleRoll(gid, si, def) {
  return { gid, si, name: def.name, rolled: false, braced: false };
}
/* Perform the crippling 2D6 roll (or apply Brace's fixed 4) for queue entry c. */
export function rollCrippleEffect(rng, c, forced) {
  if (forced != null) { c.total = forced; c.d1 = null; c.d2 = null; }
  else { c.d1 = rollDie(rng); c.d2 = rollDie(rng); c.total = c.d1 + c.d2; }
  const eff = crippleFor(c.total);
  c.effectName = eff.name; c.effectKey = eff.key; c.effectDesc = eff.desc;
  c.rolled = true;
}
export function makeExplosionRoll(gid, si, def, ship) {
  const mod = def.tonnage === 'C' ? 2 : def.tonnage === 'H' ? 1 : 0;
  return { gid, si, name: def.name, mod, rolled: false, contained: false,
    rangeIn: explosionRangeIn(def), x: ship.x, y: ship.y, layer: ship.layer || 'orbit', side: def.side };
}
/* Perform the explosion 1D6(+tonnage) roll (or apply Contain's fixed 2) for entry ex. */
export function rollExplosionEffect(rng, ex, forced) {
  const EX = {
    1:{n:'Burn Up', d:'Removed, no further effects.', kind:'none'},
    2:{n:'Reactor Rupture', d:'Groups/Stations within DOUBLE range gain a Spike.', kind:'spike2x'},
    3:{n:'Shredded', d:'All in range suffer 2 Kinetic hits. Assets removed 5+.', kind:'hits', type:'K', assets:5},
    4:{n:'Fuel Detonation', d:'All in range suffer 2 Energy hits. Assets removed 4+.', kind:'hits', type:'E', assets:4},
    5:{n:'Reactor Overload', d:'All in range suffer 2 Core hits. Assets removed 3+.', kind:'hits', type:'C', assets:3}
  };
  if (forced != null) { ex.d1 = forced; ex.mod = 0; ex.total = forced; }
  else { ex.d1 = rollDie(rng); ex.total = ex.d1 + ex.mod; }
  const eff = ex.total >= 6 ? {n:'Foldspace Catastrophe', d:'All in range suffer 2 damage + a Spike. Assets removed 2+.', kind:'dmg2spike', assets:2} : EX[Math.max(1, ex.total)];
  ex.effectName = eff.n; ex.effectDesc = eff.d; ex.effKind = eff.kind; ex.effType = eff.type; ex.effAssets = eff.assets;
  ex.rolled = true;
}
/* Apply an explosion's area effect to all ships/assets on the SAME orbital layer
   within range (double range for the spike effect). Hit-effects roll saves;
   chains may queue further explosions into M.explodeQueue. */
export function applyExplosionEffect(state, rng, ex, M) {
  if (!ex.rolled) rollExplosionEffect(rng, ex); // non-modal callers: roll immediately
  if (ex.effKind === 'none') return;
  const rangePx = ex.rangeIn * INCH * (ex.effKind === 'spike2x' ? 2 : 1);
  // Spikes are awarded once per GROUP (not per ship). Track which groups are already spiked.
  const spikedGroups = new Set();
  // Affected ships (any side), same layer, within range, on-table, alive.
  Object.keys(state.groups).forEach(gid => {
    const def = getDef(state, gid);
    const grp = state.groups[gid];
    grp.ships.forEach((s, si) => {
      if (s.destroyed || s.offTable || s.attachedTo) return;
      if ((s.layer || 'orbit') !== ex.layer) return;
      if (Math.hypot(s.x - ex.x, s.y - ex.y) > rangePx) return;
      if (ex.effKind === 'spike2x') {
        if (!spikedGroups.has(gid)) { spikedGroups.add(gid); grp.spikes = (grp.spikes || 0) + 1; }
      } else if (ex.effKind === 'dmg2spike') {
        s.hull = Math.max(0, s.hull - 2);
        if (s.hull <= 0 && !s.destroyed) { s.destroyed = true; if (M && isCapital(def)) M.explodeQueue.push(makeExplosionRoll(gid, si, def, s)); }
        if (!spikedGroups.has(gid)) { spikedGroups.add(gid); grp.spikes = (grp.spikes || 0) + 1; }
      } else if (ex.effKind === 'hits') {
        const sv = baseSaveForType(def, s, ex.effType, false);
        let unsaved = 0;
        for (let i = 0; i < 2; i++) {
          if (sv == null) { unsaved++; continue; }
          if (rollDie(rng) < sv) {
            const bv = saveVal(def.bs);
            if (bv == null || rollDie(rng) < bv) unsaved++;
          }
        }
        if (unsaved > 0) {
          s.hull = Math.max(0, s.hull - unsaved);
          if (s.hull <= 0 && !s.destroyed) { s.destroyed = true; if (M && isCapital(def)) M.explodeQueue.push(makeExplosionRoll(gid, si, def, s)); }
        }
      }
    });
  });
  // Launch assets on the same conceptual layer (assets count as Orbit) within range.
  if (ex.effAssets && state.launchedAssets) {
    state.launchedAssets = state.launchedAssets.filter(a => {
      if (Math.hypot(a.x - ex.x, a.y - ex.y) > rangePx) return true;
      let remaining = a.count;
      for (let i = 0; i < a.count; i++) { if (rollDie(rng) >= ex.effAssets) remaining--; }
      a.count = remaining;
      return remaining > 0;
    });
  }
}

/* ── COHERENCY ── */
export function coherencyInches(def) { return def.tonnage === 'L' ? 3 : 6; }
/* Set of ship indices OUT of formation (need 1 neighbour, or 2 for groups of 4+). */
export function outOfFormationSet(state, def) {
  if (def.openNetwork || def.payload) return new Set(); // ignore coherency
  const grp = getGroup(state, def.id);
  const alive = grp.ships.map((s, i) => ({ s, i })).filter(o => !o.s.destroyed && !o.s.offTable);
  if (alive.length <= 1) return new Set();
  const cohPx = coherencyInches(def) * INCH;
  const need = alive.length >= 4 ? 2 : 1;
  const out = new Set();
  alive.forEach(({ s, i }) => {
    let neighbours = 0;
    alive.forEach(({ s: o, i: j }) => {
      if (i === j) return;
      if ((s.layer || 'orbit') !== (o.layer || 'orbit')) return;
      if (Math.hypot(s.x - o.x, s.y - o.y) <= cohPx) neighbours++;
    });
    if (neighbours < need) out.add(i);
  });
  return out;
}
export function groupInFormation(state, def) { return outOfFormationSet(state, def).size === 0; }

/* ── ATTACK RESOLUTION (to-hit / saves) ──
   Roll the hit dice / primary save dice for the current shot, setting M.hitResult
   / M.saveResult and applying immediate side-effects (Overcharge self-damage,
   Bloom/Shield spikes, Sustained-Fire bookkeeping). Lifted out of the render so
   the rolls are explicit and can run server-side with the room's seeded rng. */
export function rollHits(state, rng, M) {
  const s = M.shots[M.shotIdx];
  // To-hit dice are tallied for the attacking side's dice distribution.
  const atkSide = M.bomber ? M.bomberSide : (M.attackerGid ? (getDef(state, M.attackerGid) || {}).side : null);
  // Bombardment vs dropsite: no ship target, simplified roll path.
  if (s.dsId) {
    const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === s.dsId);
    let lock = Math.max(2, lockVal(s.w) - 2); // Bombardment improves Lock by 2 vs all dropsites
    const dice = [];
    let hits = 0, crits = 0;
    for (let i = 0; i < s.w.att; i++) {
      const r = rollDie(rng);
      const isHit = r >= lock;
      const isCrit = r >= lock + 2;
      if (isHit) hits++;
      if (isCrit) crits++;
      dice.push({ r, isHit, isCrit });
    }
    M.hitResult = { dice, hits, crits, lock, forceSix: false };
    recordDice(state, atkSide, dice.map(d => d.r));
    return;
  }
  const td = getDef(state, s.targetGid);
  const ts = state.groups[s.targetGid].ships[s.targetSi];
  const sp = parseWeaponSpecials(s.w);
  // Lock: Mauler uses the target's relevant save as Lock; Calibre improves Lock vs listed tonnages.
  let lock = lockVal(s.w);
  if (sp.mauler) {
    const sv = s.w.type === 'K' ? saveVal(td.ks) : s.w.type === 'E' ? saveVal(td.es) : (shieldSaveVal(td) || 6);
    if (sv != null) lock = sv;
  }
  if (sp.calibre && sp.calibre.toUpperCase().includes(td.tonnage)) lock = Math.max(2, lock - 1);
  // UCM Mass Driver Volley admiral ability: every "Mass Driver" weapon in the firing Group
  // improves Lock by 1 for this attack sequence (set once on the modal when the ability is used).
  if (M.massDriverVolley && /Mass Driver/i.test(s.w.name || '')) lock = Math.max(2, lock - 1);
  // Atmosphere attack rules (§4.1.2).
  let forceSix = false;
  if (!M.bomber && M.attackerGid) {
    const ash = state.groups[M.attackerGid].ships[M.attackerSi];
    const aL = ash && (ash.layer || 'orbit'), tL = ts.layer || 'orbit';
    const isCity = td.category === 'city';
    const targetDescent = /Descent/i.test(td.special || '');
    const isBombardment = /Bombardment/i.test(s.w.special || '');
    const isAirToAir   = /Air.?to.?Air/i.test(s.w.special || '');
    const ignoreAtmoPenalty = isBombardment || isAirToAir;
    if (isCity && isBombardment) lock = Math.max(2, lock - 2);
    else if (!ignoreAtmoPenalty && tL === 'atmosphere' && (isCity || targetDescent)) forceSix = true;
    else if (aL === 'atmosphere' && tL === 'orbit') forceSix = true;
    else if (!ignoreAtmoPenalty && aL === 'orbit' && tL === 'atmosphere') lock = Math.min(6, lock + 1);
  }
  // Fusillade-X (per-ship; baked for pooled fire). Sustained Fire: ×2 Att vs a Group hit last round.
  let att = s.w.att;
  if (sp.fusillade && !s.fusilladeBaked && !M.bomber && M.attackerGid) {
    const ag = state.groups[M.attackerGid];
    const eo = ag ? effectiveOrder(state, getDef(state, M.attackerGid), ag, M.attackerSi) : null;
    if (eo === 'WF') att += sp.fusillade;
  }
  if (sp.sustained && !M.bomber) {
    const tg = state.groups[s.targetGid];
    if (tg && tg.hitByLastRound && tg.hitByLastRound.includes(M.attackerGid)) att *= 2;
  }
  const dice = [];
  let hits = 0, crits = 0, sixes = 0;
  const critMargin = (td.special && /Reinforced Armour/i.test(td.special)) ? 3 : 2;
  for (let i = 0; i < att; i++) {
    const r = rollDie(rng);
    const isHit = forceSix ? (r === 6) : (r >= lock);
    const isCrit = forceSix ? false : (r >= lock + critMargin);
    if (isHit) hits++;
    if (isCrit) crits++;
    if (r === 6) sixes++;
    dice.push({ r, isHit, isCrit });
  }
  M.hitResult = { dice, hits, crits, lock, forceSix, critMargin };
  recordDice(state, atkSide, dice.map(d => d.r));
  if (hits > 0 && !M.bomber && M.attackerGid) {
    const tg = state.groups[s.targetGid];
    if (tg) { tg.hitByThisRound = tg.hitByThisRound || []; if (!tg.hitByThisRound.includes(M.attackerGid)) tg.hitByThisRound.push(M.attackerGid); }
  }
  // Overcharge: each 6 costs the firing ship this weapon's unmodified Damage in Hull.
  const oc = M.overcharge && M.overcharge[s.wi];
  if (oc && sixes > 0 && !M.bomber && M.attackerGid) {
    const ash = state.groups[M.attackerGid].ships[M.attackerSi];
    if (ash) {
      const self = sixes * (s.w.dmg || 0);
      ash.hull = Math.max(0, ash.hull - self);
      M.log.push(`Overcharge: ${s.w.name} dealt ${self} self-damage (${sixes}×6)`);
      if (ash.hull <= 0 && !ash.destroyed) { ash.destroyed = true; }
    }
  }
  // Bloom-X: attacker gains X spikes when this weapon fires.
  if (sp.bloom && !M.bomber && M.attackerGid) {
    const ag = state.groups[M.attackerGid];
    if (ag) ag.spikes = (ag.spikes || 0) + sp.bloom;
  }
}

/* Returns 5 (for 5+) if a dropsite station has an active BS save via paired city power plants,
   null otherwise. Used by Ready Salted Earth's conditional BS rule. */
function stationBSVal(state, ds) {
  if (!ds || !ds.base || ds.base.category !== 'station') return null;
  const layKey = state.scenario && state.scenario.layout;
  const layout = layKey && LAYOUTS[layKey];
  if (!layout || !layout.stationCityLinks) return null;
  const cityId = layout.stationCityLinks[ds.id];
  if (!cityId) return null;
  const city = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === cityId);
  if (!city || city.destroyed) return null;
  const hasPlant = (city.features || []).some((fk, fi) => fk === 'power_plant' && !(city.destroyedFeatures || []).includes(fi));
  return hasPlant ? 5 : null;
}

export function rollSaves(state, rng, M) {
  const s = M.shots[M.shotIdx];
  // Bombardment vs dropsite: roll ES/KS saves based on weapon type.
  if (s.dsId) {
    const _ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === s.dsId);
    const _base = _ds && _ds.base;
    const _hr = M.hitResult;
    const _sp = parseWeaponSpecials(s.w);
    // Best save = base save improved by any features present (lower = better).
    const _better = (a, b) => {
      const va = saveVal(a), vb = saveVal(b);
      if (va == null) return b; if (vb == null) return a;
      return va < vb ? a : b;
    };
    let _bestES = _base && _base.es, _bestKS = _base && _base.ks;
    (_ds && _ds.features || []).forEach(fk => {
      const f = FEATURES[fk];
      if (f) { _bestES = _better(_bestES, f.es); _bestKS = _better(_bestKS, f.ks); }
    });
    const _svStr = s.w.type === 'K' ? _bestKS : s.w.type === 'E' ? _bestES : null;
    const _svBase = saveVal(_svStr);
    // Burnthrough-X: each crit reduces the save for all hits (dropsites have no shields).
    const _burnReduce = _sp.burnthrough * _hr.crits;
    const _sv = _svBase != null ? Math.min(6, _svBase + _burnReduce) : _svBase;
    const _hitsList = [];
    let _critsRem = _hr.crits;
    for (let i = 0; i < _hr.hits; i++) {
      const isCrit = _critsRem > 0; if (isCrit) _critsRem--;
      // Critical-X: crit hits deal extra damage if unsaved.
      const dmg = (s.w.dmg || 1) + (isCrit ? _sp.critical : 0);
      _hitsList.push({ isCrit, type: s.w.type, sv: _sv, dmg, saved: false });
    }
    const _primDice = [];
    _hitsList.forEach(h => {
      if (h.sv == null) return;
      const r = rollDie(rng);
      const ok = r >= h.sv;
      _primDice.push({ r, ok, sv: h.sv, crit: h.isCrit });
      if (ok) h.saved = true;
    });
    // Station BS save: conditional on paired city having surviving power plants (Ready Salted Earth).
    const _bsVal = stationBSVal(state, _ds);
    const _bsDice = [];
    if (_bsVal != null) {
      _hitsList.forEach(h => {
        if (h.saved) return;
        const r = rollDie(rng);
        const ok = r >= _bsVal;
        _bsDice.push({ r, ok });
        if (ok) { h.saved = true; h.savedBy = 'bs'; }
      });
    }
    const _dmg = _hitsList.filter(h => !h.saved).reduce((a, h) => a + h.dmg, 0);
    const _unsaved = _hitsList.filter(h => !h.saved).length;
    M.saveResult = {
      hitsList: _hitsList, primDice: _primDice, bsDice: _bsDice, bsVal: _bsVal, backDice: [], aegisDice: [],
      backupVal: null, aegisY: 0, backupRolled: true,
      unsaved: _unsaved, dmg: _dmg, dsId: s.dsId,
      flash: 0, crippling: false, penetrator: false, status: false, corruptor: 0,
      critDamaged: _hitsList.some(h => h.isCrit && !h.saved),
    };
    return;
  }
  const td = getDef(state, s.targetGid);
  const ts = state.groups[s.targetGid].ships[s.targetSi];
  const sp = parseWeaponSpecials(s.w);
  const hr = M.hitResult;
  const k = targetKey(s.targetGid, s.targetSi);
  // AI defenders never declare Shields through the UI, so raise them here when worthwhile (the +1
  // Spike is applied below exactly as for a manual raise). Humans still choose manually.
  if (!M.shieldsUp[k] && hasShields(td) && aiControlsSide(state, td.side) && shieldsWorthRaising(td, ts, s.w)) {
    M.shieldsUp[k] = true;
  }
  const shieldUp = !!M.shieldsUp[k];
  const boostedGid = shieldUp && M.shieldBooster && M.shieldBooster[k];
  const sat = M.saturation || 0;
  // Build a per-hit list. Penetrator: criticals become Core hits. Burnthrough: each
  // crit worsens this weapon's ES/KS for all its hits.
  const burnReduce = sp.burnthrough * hr.crits;
  const hitsList = [];
  let critsRemaining = hr.crits;
  for (let i = 0; i < hr.hits; i++) {
    const isCrit = critsRemaining > 0; if (isCrit) critsRemaining--;
    let type = s.w.type;
    if (isCrit && sp.penetrator) type = 'C';
    let sv = baseSaveForType(td, ts, type, shieldUp);
    if (sv != null && type !== 'C' && !shieldUp) {
      const red = sp.scald + burnReduce + (isCrit ? sp.reave : 0);
      if (red) sv = Math.min(6, sv + red);
    }
    if (shieldUp && boostedGid && sv != null) sv = Math.max(3, sv - 1);
    const ocOn = M.overcharge && M.overcharge[s.wi];
    const baseDmg = ocOn ? (s.w.dmg * 2) : s.w.dmg;
    const dmg = baseDmg + (isCrit ? sp.critical : 0);
    hitsList.push({ isCrit, type, sv, dmg, saved: false, savedBy: null });
  }
  // Primary saves, honouring Saturation (skips `sat` save dice).
  const primDice = [];
  let skipSaves = sat;
  hitsList.forEach(h => {
    if (h.sv == null) return;
    if (skipSaves > 0) { skipSaves--; h.noSaveDie = true; return; }
    const r = rollDie(rng); const ok = r >= h.sv;
    primDice.push({ r, ok, sv: h.sv, crit: h.isCrit });
    if (ok) { h.saved = true; h.savedBy = 'primary'; }
  });
  recordDice(state, td.side, primDice.map(d => d.r)); // defender's save dice
  // Shield-X: the Group gains 1 Spike when it uses Shield Saves (once per attack).
  if (shieldUp && !M.shieldSpiked) {
    M.shieldSpiked = M.shieldSpiked || {};
    if (!M.shieldSpiked[k]) { M.shieldSpiked[k] = true; ts.spikes = (ts.spikes || 0) + 1; }
  }
  // Shield Booster: the booster Group gains 1 Spike (once per target per attack).
  if (boostedGid) {
    M.shieldBoosted = M.shieldBoosted || {};
    if (!M.shieldBoosted[k]) {
      M.shieldBoosted[k] = true;
      const bGrp = state.groups[boostedGid];
      const bDef = getDef(state, boostedGid);
      if (bGrp && bDef) addGroupSpikes(bGrp, bDef, 1);
    }
  }
  // Backup save value (Formation gives a 6+ backup to grouped ships); rolled later.
  // Open Network (Voidgates) and Payload ships skip coherency and don't benefit from
  // the formation backup save — groupInFormation() short-circuits to true for them,
  // so we must exclude them explicitly here.
  let backupVal = saveVal(td.bs);
  const tgrp = state.groups[s.targetGid];
  if (tgrp && tgrp.ships.length > 1 && !td.openNetwork && !td.payload && groupInFormation(state, td)) {
    backupVal = (backupVal == null) ? 6 : Math.min(backupVal, 6);
  }
  const isBomberAtk = M.bomber && (M.bomberKind === 'bomber' || M.bomberKind === 'fireship');
  const isCloseAction = /Close Action/i.test(s.w.special || '');
  const dmg = hitsList.filter(h => !h.saved).reduce((a, h) => a + h.dmg, 0);
  const unsaved = hitsList.filter(h => !h.saved).length;
  M.saveResult = { hitsList, primDice, backDice: [], backupVal, aegisDice: [], aegisY: 0, unsaved, dmg,
    backupRolled: false, targetGid: s.targetGid, isBomberAtk, isCloseAction,
    flash: sp.flash, crippling: sp.crippling, penetrator: sp.penetrator,
    status: sp.status && hitsList.length > 0, corruptor: (sp.corruptor && dmg > 0) ? sp.corruptor : 0,
    critDamaged: hitsList.some(h => h.isCrit && !h.saved) };
}

/* ── ATTACK RESOLUTION (post-save) ──
   Pure resolution helpers operating on the attack-modal object `M` plus `state`;
   dice use the injected `rng`. Rendering stays with the caller. As combat migrates
   to intents these run on the server with the room's seeded rng. */

/* Apply M.pendingDamage to targets (Focused/spillover rules), record kills, build
   the crippling / explosion / impel queues, then set the next sub-step. */
export function resolveAttackDamage(state, M) {
  M.crippleQueue = [];
  M.explodeQueue = [];
  Object.keys(M.pendingDamage).forEach(k => {
    const [gid, si] = k.split('#');
    const grp = state.groups[gid];
    const ship = grp && grp.ships[parseInt(si)];
    if (!ship || ship.destroyed) return;
    const def = getDef(state, gid);
    const dmg = M.pendingDamage[k];
    const wasAboveHalf = ship.hull > ship.maxHull / 2;
    const before = ship.hull;
    ship.hull = Math.max(0, ship.hull - dmg);
    // Damage spillover: excess beyond destroying the targeted ship spills to the
    // group (lowest-hull first), unless ALL damage was Focused.
    let excess = dmg - before;
    if (ship.hull <= 0 && excess > 0 && M.spillEligible && M.spillEligible[k]) {
      const mates = grp.ships
        .map((sh, idx) => ({ sh, idx }))
        .filter(o => !o.sh.destroyed && !o.sh.offTable && o.idx !== parseInt(si))
        .sort((a, b) => a.sh.hull - b.sh.hull);
      for (const o of mates) {
        if (excess <= 0) break;
        const take = Math.min(excess, o.sh.hull);
        const wasHalf = o.sh.hull > o.sh.maxHull / 2;
        o.sh.hull = Math.max(0, o.sh.hull - take);
        excess -= take;
        M.log.push(`Spillover: ${take} → ${def.name} #${o.idx + 1}`);
        if (o.sh.hull <= 0) {
          o.sh.destroyed = true;
          recordKill(state, def, M.bomber ? M.bomberSide : (M.attackerGid ? getDef(state, M.attackerGid).side : null), false, targetKey(gid, o.idx));
          if (isCapital(def)) M.explodeQueue.push(makeExplosionRoll(gid, o.idx, def, o.sh));
        } else if (isCapital(def) && !o.sh.crippledRolled && o.sh.hull <= o.sh.maxHull / 2 && wasHalf) {
          o.sh.crippledRolled = true;
          M.crippleQueue.push(makeCrippleRoll(gid, o.idx, def));
        }
      }
    }
    if (M.pendingFlash && M.pendingFlash[k]) ship.spikes = (ship.spikes || 0) + M.pendingFlash[k];
    if (M.pendingArrest && M.pendingArrest[k] && !ship.arrestedThisRound) {
      ship.arrestNext = M.pendingArrest[k];
      ship.arrestedThisRound = true;
    }
    if (M.forcedCripple && M.forcedCripple[k] && ship.hull > 0) {
      M.crippleQueue.push(makeCrippleRoll(gid, parseInt(si), def));
    }
    if (isCapital(def) && !ship.crippledRolled && ship.hull > 0 && ship.hull <= ship.maxHull / 2 && wasAboveHalf) {
      ship.crippledRolled = true;
      M.crippleQueue.push(makeCrippleRoll(gid, parseInt(si), def));
    }
    if (ship.hull <= 0) {
      ship.destroyed = true;
      recordKill(state, def, M.bomber ? M.bomberSide : (M.attackerGid ? getDef(state, M.attackerGid).side : null), false, targetKey(gid, parseInt(si)));
      if (isCapital(def)) M.explodeQueue.push(makeExplosionRoll(gid, parseInt(si), def, ship));
    } else {
      if (M.pendingStatus && M.pendingStatus[k]) {
        ship.crippling = ship.crippling || [];
        if (!ship.crippling.includes('scanners')) ship.crippling.push('scanners');
        ship.statusToken = true;
      }
      if (M.pendingCorruptor && M.pendingCorruptor[k]) {
        const atkSide = M.bomber ? M.bomberSide : (M.attackerGid ? getDef(state, M.attackerGid).side : null);
        if (atkSide) { ship.battalions = ship.battalions || { player1: 0, player2: 0 }; ship.battalions[atkSide] += M.pendingCorruptor[k]; }
      }
    }
  });
  // Impel-X: queue affected groups for a player choice (turn vs move forward).
  if (M.pendingImpel) {
    M.impelQueue = M.impelQueue || [];
    Object.keys(M.pendingImpel).forEach(gid => {
      const grp = state.groups[gid];
      if (!grp) return;
      if (!M.impelQueue.find(q => q.gid === gid)) M.impelQueue.push({ gid, x: M.pendingImpel[gid].x, big: M.pendingImpel[gid].big });
    });
  }
  // Bombardment: apply hull damage; queue collateral battalion-removal choices.
  if (M.pendingBombardDamage) {
    M.bombardCollateralQueue = M.bombardCollateralQueue || [];
    const bombarderSide = M.attackerGid ? getDef(state, M.attackerGid).side : (M.bomberSide || null);
    Object.keys(M.pendingBombardDamage).forEach(dsId => {
      const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === dsId);
      if (!ds) return;
      const dmg = M.pendingBombardDamage[dsId];
      if (dmg <= 0) return;
      ds.damage = (ds.damage || 0) + dmg;
      const dsName = (ds.base && ds.base.name) || dsId;
      const sz = dropsiteSizeKey(ds);
      const vp = DROPSITE_VP[sz] || DROPSITE_VP.M;
      const bombarderZone = bombarderSide && state.deployZone && state.deployZone[bombarderSide];
      const sr = ds.siteRules || [];
      const hasDemolishObj = bombarderSide && objectiveForSide(state, bombarderSide) === 'demolish';
      const hasDemolishSite = sr.some(r => r.startsWith('demolish_'));
      // Fire Demolish VP when: (a) objective is demolish AND zone matches any site restriction,
      // OR (b) dropsite has an explicit demolish_<zone> siteRule (e.g. Moonwreck with normal obj).
      const isDemolish = bombarderSide && (
        (hasDemolishObj && (!hasDemolishSite || !bombarderZone || sr.includes(`demolish_${bombarderZone}`))) ||
        (!hasDemolishObj && hasDemolishSite && bombarderZone && sr.includes(`demolish_${bombarderZone}`))
      );
      // Ruin / Level resolution with overflow. A single salvo can Ruin then Level.
      let statusNote = '';
      while (ds.maxHull && ds.damage >= ds.maxHull && !ds.destroyed) {
        if (ds.ruined) {
          ds.destroyed = true;
          statusNote = ' · LEVELLED';
          if (isDemolish) awardVP(state, bombarderSide, vp.control, `Demolish: ${dsName} Levelled`, state.round);
        } else {
          const overflow = ds.damage - ds.maxHull;
          ds.ruined = true;
          ds.damage = overflow;
          statusNote = ' · RUINED';
          if (isDemolish && vp.contest > 0) awardVP(state, bombarderSide, vp.contest, `Demolish: ${dsName} Ruined`, state.round);
        }
      }
      M.log.push(`${dsName}: ${dmg} hull damage${statusNote}`);
      // RSE: city levelled → linked station permanently loses BS save.
      if (ds.destroyed && ds.base && ds.base.category !== 'station') {
        const _lk2 = state.scenario && state.scenario.layout;
        const _lay2 = _lk2 && LAYOUTS[_lk2];
        if (_lay2 && _lay2.stationCityLinks) {
          const stId2 = Object.keys(_lay2.stationCityLinks).find(k => _lay2.stationCityLinks[k] === ds.id);
          if (stId2) {
            const stDs2 = state.scenarioData.dropsites.find(d => d.id === stId2);
            const stName2 = (stDs2 && stDs2.base && stDs2.base.name) || stId2;
            logEvent(state, `${dsName} levelled — ${stName2} loses BS 5+ save`);
          }
        }
      }
      // RSE Event 1: station levelled → place 4" debris field, spike ships/assets inside it.
      if (ds.destroyed && !ds._debrisPlaced && ds.base && ds.base.category === 'station') {
        const layKey = state.scenario && state.scenario.layout;
        const layout = layKey && LAYOUTS[layKey];
        if (layout && layout.stationCityLinks && ds.id in layout.stationCityLinks) {
          ds._debrisPlaced = true;
          const dsx = inchToPx(ds.x), dsy = inchToPx(ds.y);
          const debrisR = 2 * INCH;
          const spiked = [];
          Object.keys(state.groups).forEach(gid => {
            const g = state.groups[gid];
            if (g.ships.some(sh => !sh.destroyed && !sh.offTable && Math.hypot(sh.x - dsx, sh.y - dsy) <= debrisR)) {
              g.spikes = (g.spikes || 0) + 1;
              spiked.push((getDef(state, gid) || {}).name || gid);
            }
          });
          (state.launchedAssets || []).forEach(a => {
            if (a.count > 0 && Math.hypot(a.x - dsx, a.y - dsy) <= debrisR) {
              a.spikes = (a.spikes || 0) + 1;
            }
          });
          state.scenarioData.dynamicDebris = state.scenarioData.dynamicDebris || [];
          state.scenarioData.dynamicDebris.push({ x: ds.x, y: ds.y, diameter: 4, fromStation: ds.id });
          state.scenarioData.focalPoints = state.scenarioData.focalPoints || [];
          state.scenarioData.focalPoints.push({ x: ds.x, y: ds.y, diameter: 4, label: `Debris (${dsName})`, special: ['low_crippled'], dynamic: true });
          const spNote = spiked.length ? ` — ${[...new Set(spiked)].join(', ')} gain 1 Spike` : '';
          M.log.push(`${dsName} LEVELLED → 4" Debris Field placed (now a Focal Point)${spNote}`);
          logEvent(state, `${dsName} levelled: debris field placed at (${ds.x}", ${ds.y}")`);
        }
      }
      // Queue 1 collateral choice per hull point per player that has battalions.
      const b = dsBattalions(ds);
      const p1Total = Object.values(b).reduce((s, loc) => s + (loc.player1 || 0), 0);
      const p2Total = Object.values(b).reduce((s, loc) => s + (loc.player2 || 0), 0);
      for (let i = 0; i < dmg; i++) {
        if (p1Total > 0) M.bombardCollateralQueue.push({ dsId, dsName, side: 'player1', hullPoint: i + 1, hullTotal: dmg });
        if (p2Total > 0) M.bombardCollateralQueue.push({ dsId, dsName, side: 'player2', hullPoint: i + 1, hullTotal: dmg });
      }
    });
  }
  proceedQueues(M, state);
  return state;
}

/* Apply one collateral battalion-removal choice (player selects location). */
function applyResolveBombardCollateral(state, intent) {
  const M = state.attackModal;
  if (!M || !M.bombardCollateralQueue || !M.bombardCollateralQueue.length) return state;
  const q = M.bombardCollateralQueue[0];
  const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === q.dsId);
  if (ds) {
    const b = dsBattalions(ds);
    const loc = intent.loc;
    if (b[loc] && (b[loc][q.side] || 0) > 0) {
      b[loc][q.side]--;
      M.log.push(`${q.dsName}: ${q.side === 'player1' ? 'P1' : 'P2'} battalion removed from ${locDisplayName(ds, loc)} (collateral)`);
    }
  }
  M.bombardCollateralQueue.shift();
  proceedQueues(M, state);
  return state;
}

/* Advance the modal to the next pending sub-step.
   Skips bombardCollateralQueue entries where the target side has 0 battalions left. */
export function proceedQueues(M, state) {
  if (M.bombardCollateralQueue && M.bombardCollateralQueue.length) {
    if (state) {
      while (M.bombardCollateralQueue.length) {
        const q = M.bombardCollateralQueue[0];
        const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === q.dsId);
        const b = ds ? dsBattalions(ds) : {};
        const total = Object.values(b).reduce((s, loc) => s + (loc[q.side] || 0), 0);
        if (total > 0) break;
        M.bombardCollateralQueue.shift();
      }
    }
    if (M.bombardCollateralQueue.length) { M.step = 'bombardCollateral'; return; }
  }
  if (M.crippleQueue.length) { M.step = 'crippling'; return; }
  if (M.explodeQueue.length) { M.step = 'explosion'; return; }
  if (M.impelQueue && M.impelQueue.length) { M.step = 'impel'; return; }
  M.step = 'done';
}

/* Roll Backup + Aegis save dice on hits still unsaved after primary saves/re-rolls.
   Mutates M.saveResult in place and recomputes damage. */
export function rollDeferredBackupSaves(state, rng, M) {
  const sr = M.saveResult;
  if (!sr || sr.backupRolled) return;
  if (sr.backupVal != null) {
    sr.hitsList.forEach(h => {
      if (h.saved || h.sv == null) return;
      const r = rollDie(rng); const ok = r >= sr.backupVal;
      sr.backDice.push({ r, ok });
      if (ok) { h.saved = true; h.savedBy = 'backup'; }
    });
  }
  // Aegis-X (§15.1): vs Bomber/Close Action, Y extra save dice (on Backup, or 4+).
  if ((sr.isBomberAtk || sr.isCloseAction) && !M.aegisUsed) {
    const aegisY = aegisValueForGroup(state, sr.targetGid);
    sr.aegisY = aegisY;
    if (aegisY > 0) {
      const av = sr.backupVal != null ? sr.backupVal : 4;
      for (let i = 0; i < aegisY; i++) {
        const unsavedHit = sr.hitsList.find(h => !h.saved);
        if (!unsavedHit) break;
        const r = rollDie(rng); const ok = r >= av;
        sr.aegisDice.push({ r, ok });
        if (ok) { unsavedHit.saved = true; unsavedHit.savedBy = 'aegis'; }
      }
      M.aegisUsed = true;
    }
  }
  sr.dmg = sr.hitsList.filter(h => !h.saved).reduce((a, h) => a + h.dmg, 0);
  sr.unsaved = sr.hitsList.filter(h => !h.saved).length;
  sr.critDamaged = sr.hitsList.some(h => h.isCrit && !h.saved);
  sr.backupRolled = true;
  const defSide = sr.targetGid ? (getDef(state, sr.targetGid) || {}).side : null;
  recordDice(state, defSide, [...sr.backDice, ...sr.aegisDice].map(d => d.r));
}

/* ── ATTACK STEP MACHINE ──
   Drives the attack modal through its sub-steps. `to` names the transition the
   player requested (the modal buttons). Mutates M (and state); dice use `rng`.
   Rendering is the caller's job. Server-driven combat dispatches these as intents. */
export function advanceAttack(state, rng, M, to) {
  if (!M) return state;
  if (to === 'hit') {
    M.step = 'hit'; if (M.shotIdx == null) M.shotIdx = 0; M.hitResult = null; M.rerollN = null;
    if (M.sceneryDamage) {
      const sh = M.shots[M.shotIdx];
      M.hitResult = { hits: sh.w.hits, crits: 0, lock: 0, dice: [], autoHit: true };
      M.step = 'save'; M.saveResult = null; M.fighterSpend = {}; rollSaves(state, rng, M);
    } else { rollHits(state, rng, M); }
  }
  else if (to === 'save') {
    M.rerollN = null; M.fighterSpend = {};
    if (M.hitResult.hits > 0) { M.step = 'save'; M.saveResult = null; rollSaves(state, rng, M); }
    else { nextShotOrResolve(state, rng, M); }
  }
  else if (to === 'rollbackup') {
    rollDeferredBackupSaves(state, rng, M);
  }
  else if (to === 'apply') {
    if (M.saveResult && !M.saveResult.backupRolled) rollDeferredBackupSaves(state, rng, M);
    const s = M.shots[M.shotIdx];
    const sr = M.saveResult;
    // Bombardment vs dropsite: accumulate in a separate map; resolved after all shots.
    if (s.dsId) {
      M.pendingBombardDamage = M.pendingBombardDamage || {};
      M.pendingBombardDamage[s.dsId] = (M.pendingBombardDamage[s.dsId] || 0) + sr.dmg;
      const _bds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === s.dsId);
      const _bdsName = _bds ? (_bds.base && _bds.base.name) || s.dsId : s.dsId;
      M.log.push(`${s.w.name} ▶ ${_bdsName}: ${sr.unsaved} unsaved → ${sr.dmg} hull damage`);
      nextShotOrResolve(state, rng, M);
      return state;
    }
    const k = targetKey(s.targetGid, s.targetSi);
    M.pendingDamage[k] = (M.pendingDamage[k] || 0) + sr.dmg;
    if (sr.dmg > 0 && !parseWeaponSpecials(s.w).focused) {
      M.spillEligible = M.spillEligible || {};
      M.spillEligible[k] = true;
    }
    if (sr.flash && sr.dmg > 0) {
      M.pendingFlash = M.pendingFlash || {};
      M.pendingFlash[k] = (M.pendingFlash[k] || 0) + sr.flash;
    }
    if (sr.crippling && sr.critDamaged && sr.dmg > 0) {
      M.forcedCripple = M.forcedCripple || {};
      M.forcedCripple[k] = true;
    }
    if (sr.status) { M.pendingStatus = M.pendingStatus || {}; M.pendingStatus[k] = true; }
    if (sr.corruptor) { M.pendingCorruptor = M.pendingCorruptor || {}; M.pendingCorruptor[k] = (M.pendingCorruptor[k] || 0) + sr.corruptor; }
    const spA = parseWeaponSpecials(s.w);
    if (spA.arrest && sr.dmg > 0) {
      M.pendingArrest = M.pendingArrest || {};
      M.pendingArrest[k] = Math.max(M.pendingArrest[k] || 0, spA.arrest);
    }
    if (spA.impel && M.hitResult && M.hitResult.crits >= spA.impel) {
      M.pendingImpel = M.pendingImpel || {};
      const big = M.hitResult.crits >= spA.impel * 2;
      M.pendingImpel[s.targetGid] = { x: spA.impel, big };
    }
    const td = getDef(state, s.targetGid);
    M.log.push(`${s.w.name} ▶ ${td.name}: ${sr.dmg} dmg${sr.flash && sr.dmg > 0 ? ` (+${sr.flash} spike)` : ''}`);
    // Structured per-shot record for the report's expandable attack trace.
    const _multi = state.groups[s.targetGid] && state.groups[s.targetGid].ships.length > 1;
    M.shotDetails = M.shotDetails || [];
    M.shotDetails.push({
      weapon: s.w.name, type: s.w.type, target: td.name + (_multi ? ` #${s.targetSi + 1}` : ''),
      lock: M.hitResult.lock, forceSix: !!M.hitResult.forceSix,
      hits: M.hitResult.hits, crits: M.hitResult.crits,
      hitDice: (M.hitResult.dice || []).map(d => ({ r: d.r, hit: d.isHit, crit: d.isCrit })),
      saveDice: (sr.primDice || []).map(d => ({ r: d.r, ok: d.ok, sv: d.sv })),
      backupVal: sr.backupVal ?? null,
      backupDice: (sr.backDice || []).map(d => ({ r: d.r, ok: d.ok })),
      aegisDice: (sr.aegisDice || []).map(d => ({ r: d.r, ok: d.ok })),
      unsaved: sr.unsaved, dmg: sr.dmg,
    });
    nextShotOrResolve(state, rng, M);
  }
  else if (to === 'crippling-roll') {
    const c = M.crippleQueue[0];
    rollCrippleEffect(rng, c, c.braced ? 4 : null);
  }
  else if (to === 'explosion-roll') {
    const ex = M.explodeQueue[0];
    rollExplosionEffect(rng, ex, ex.contained ? 2 : null);
  }
  else if (to === 'crippling-next') { applyCripplingNext(state, M); }
  else if (to === 'explosion-next') { applyExplosionNext(state, rng, M); }
  return state;
}

/* Move to the next shot (rolling its hits), or once all shots are done apply
   damage & queue effects. With multi-shot attacks the player picks the order
   via the 'select' step, so after each shot resolves we return there. */
export function nextShotOrResolve(state, rng, M) {
  // Mark current shot as resolved.
  if (M.shotIdx != null) {
    M.resolvedShots = M.resolvedShots || [];
    if (!M.resolvedShots.includes(M.shotIdx)) M.resolvedShots.push(M.shotIdx);
  }
  // Find remaining unresolved shots.
  const unresolved = M.shots.map((_, i) => i).filter(i => !(M.resolvedShots || []).includes(i));
  if (unresolved.length > 0) {
    // Return to selection screen so attacker can choose order.
    M.shotIdx = null; M.hitResult = null; M.saveResult = null; M.step = 'select';
    return;
  }
  resolveAttackDamage(state, M);
}

/* Apply the next queued crippling effect to its ship, then advance the queues. */
export function applyCripplingNext(state, M) {
  const c = M.crippleQueue.shift();
  const ship = state.groups[c.gid].ships[c.si];
  const def = getDef(state, c.gid);
  ship.crippling = ship.crippling || [];
  if (c.effectKey === 'fire') { ship.fireTokens = (ship.fireTokens || 0) + 1; ship.crippling.push('fire'); }
  else if (c.effectKey === 'energy') { ship.spikes = (ship.spikes || 0) + 1; }
  else if (c.effectKey === 'structural') {
    ship.hull = Math.max(0, ship.hull - 1);
    if (ship.hull <= 0 && !ship.destroyed) { ship.destroyed = true; if (isCapital(def)) M.explodeQueue.push(makeExplosionRoll(c.gid, c.si, def, ship)); }
  }
  else if (!ship.crippling.includes(c.effectKey)) {
    ship.crippling.push(c.effectKey);
    if (c.effectKey === 'decay' && (ship.layer || 'orbit') !== 'atmosphere') {
      const grp = state.groups[c.gid];
      grp.moveTrail = grp.moveTrail || [];
      grp.moveTrail.push({ si: c.si, x: ship.x, y: ship.y, heading: ship.heading, layer: ship.layer || 'orbit' });
      ship.layer = 'atmosphere';
      logEvent(state, `${def.name} — Orbital Decay: falls to Atmosphere`);
    }
  }
  M.log.push(`${c.name} crippled: ${c.effectName}`);
  proceedQueues(M, state);
}

/* Apply the next queued explosion's area effect, then advance the queues. */
export function applyExplosionNext(state, rng, M) {
  const ex = M.explodeQueue.shift();
  M.log.push(`${ex.name} exploded: ${ex.effectName}`);
  applyExplosionEffect(state, rng, ex, M);
  proceedQueues(M, state);
}

/* AP Re-roll: the attacker re-rolls missed to-hit dice ('hit') or the defender
   re-rolls failed save dice ('save'), spending that side's AP. Count = M.rerollN. */
export function attackReroll(state, rng, M, which) {
  if (which === 'hit') {
    const hr = M.hitResult;
    const atkSide = M.bomber ? M.bomberSide : (M.attackerGid ? (getDef(state, M.attackerGid) || {}).side : null);
    const missIdx = hr.dice.map((d, i) => (!d.isHit ? i : -1)).filter(i => i >= 0);
    const maxRR = Math.min(missIdx.length, (state.planning && state.planning.ap[atkSide]) || 0);
    const n = Math.min(M.rerollN || maxRR, maxRR);
    if (atkSide && n > 0) {
      state.planning.ap[atkSide] -= n;
      // Re-rolled dice must honour the same hit/crit rules as the original roll —
      // notably forceSix (atmosphere: hits 6+ only, no crits) and the target's crit
      // margin (Reinforced Armour = lock+3). Ignoring forceSix here let a re-rolled 4
      // count as a hit against a Descent ship in atmosphere.
      const _cm = hr.critMargin || 2;
      const _rr = [];
      missIdx.slice(0, n).forEach(i => {
        const d = hr.dice[i]; d.r = rollDie(rng); _rr.push(d.r);
        d.isHit  = hr.forceSix ? (d.r === 6) : (d.r >= hr.lock);
        d.isCrit = hr.forceSix ? false : (d.r >= hr.lock + _cm);
      });
      recordDice(state, atkSide, _rr);
      hr.hits = hr.dice.filter(d => d.isHit).length;
      hr.crits = hr.dice.filter(d => d.isCrit).length;
      hr.rerolled = true; M.rerollN = null;
      M.log.push(`${factionName(state, atkSide)} AP Re-roll ${n} (${n} AP)`);
    }
  } else if (which === 'save') {
    const sr = M.saveResult; const s = M.shots[M.shotIdx];
    if (s.dsId) return state; // dropsites have no AP to spend on save re-rolls
    if (sr.fighterRerolled) return state; // already re-rolled via Close Protection
    const td = getDef(state, s.targetGid); const defSide = td.side;
    const failedIdx = sr.primDice.map((d, i) => (!d.ok ? i : -1)).filter(i => i >= 0);
    const maxRR = Math.min(failedIdx.length, (state.planning && state.planning.ap[defSide]) || 0);
    const n = Math.min(M.rerollN || maxRR, maxRR);
    if (defSide && n > 0) {
      state.planning.ap[defSide] -= n;
      const _rr = [];
      failedIdx.slice(0, n).forEach(i => { const d = sr.primDice[i]; d.r = rollDie(rng); d.ok = d.r >= d.sv; _rr.push(d.r); });
      recordDice(state, defSide, _rr);
      recomputeSaves(sr);
      sr.rerolled = true; M.rerollN = null;
      M.log.push(`${factionName(state, defSide)} AP Re-roll ${n} saves (${n} AP)`);
    }
  }
  return state;
}

/* Close Protection: spend selected friendly Fighters (M.fighterSpend) to re-roll
   that many failed primary saves. */
export function attackFighterReroll(state, rng, M) {
  const sr = M.saveResult; if (!sr) return state;
  if (sr.rerolled) return state; // already re-rolled via AP ability
  const s = M.shots[M.shotIdx]; const td = getDef(state, s.targetGid);
  const spend = M.fighterSpend || {};
  const nSpend = Object.keys(spend).reduce((a, k) => a + (spend[k] || 0), 0);
  if (nSpend <= 0) return state;
  Object.keys(spend).forEach(wingId => {
    const n = spend[wingId] || 0; if (!n) return;
    const a = (state.launchedAssets || []).find(x => x.id === wingId);
    if (a) a.count = Math.max(0, a.count - n);
  });
  state.launchedAssets = (state.launchedAssets || []).filter(a => a.count > 0);
  const failedIdx = sr.primDice.map((d, i) => (!d.ok ? i : -1)).filter(i => i >= 0);
  const _rr = [];
  failedIdx.slice(0, nSpend).forEach(i => { const d = sr.primDice[i]; d.r = rollDie(rng); d.ok = d.r >= d.sv; _rr.push(d.r); });
  recordDice(state, td.side, _rr);
  recomputeSaves(sr);
  sr.fighterRerolled = true; M.fighterSpend = {};
  M.log.push(`${factionName(state, td.side)} Close Protection: re-rolled ${nSpend} save${nSpend !== 1 ? 's' : ''} (−${nSpend} fighters)`);
  return state;
}

/* Re-derive each hit's saved flag from the (possibly re-rolled) primary + backup
   dice, then recompute total damage / unsaved count. */
function recomputeSaves(sr) {
  sr.hitsList.forEach(h => { h.saved = false; h.savedBy = null; });
  let pIdx = 0;
  sr.hitsList.forEach(h => { if (h.sv == null || h.noSaveDie) return; const d = sr.primDice[pIdx++]; if (d && d.ok) { h.saved = true; h.savedBy = 'primary'; } });
  let bIdx = 0;
  if (sr.backupVal != null) sr.hitsList.forEach(h => { if (h.saved) return; const d = sr.backDice[bIdx++]; if (d && d.ok) { h.saved = true; h.savedBy = 'backup'; } });
  sr.dmg = sr.hitsList.filter(h => !h.saved).reduce((a, h) => a + h.dmg, 0);
  sr.unsaved = sr.hitsList.filter(h => !h.saved).length;
}

/* Commit a resolved attack: log the summary + per-step lines, then for a bomber
   attack apply Crippling-Fire and remove the spent bombers, or for group fire mark
   every ship fired (recording Limited-X uses) and clear its targets. Clears the
   modal. Returns a bomber-scope continuation hint for the caller (asset-phase
   orchestration stays client-side); null for group fire. */
export function finishAttack(state, M) {
  if (!M) return null;
  {
    const atkName = M.bomber ? (M.attackerName || 'Assets') : (getDef(state, M.attackerGid) ? getDef(state, M.attackerGid).name : 'Group');
    const tgtNames = {};
    (M.shots || []).forEach(s => {
      const td = getDef(state, s.targetGid); if (!td) return;
      const multi = state.groups[s.targetGid] && state.groups[s.targetGid].ships.length > 1;
      tgtNames[targetKey(s.targetGid, s.targetSi)] = td.name + (multi ? ` #${s.targetSi + 1}` : '');
    });
    let totDmg = 0, kills = 0;
    Object.keys(M.pendingDamage || {}).forEach(k => {
      totDmg += M.pendingDamage[k] || 0;
      const [g, si] = k.split('#'); const ts = state.groups[g] && state.groups[g].ships[parseInt(si)];
      if (ts && ts.destroyed) kills++;
    });
    const tgtList = Object.values(tgtNames).join(', ') || 'target';
    // Asset (bomber/torpedo/fire-ship/feature) attacks get their own category so the
    // end-game report can surface them alongside launches rather than burying them in
    // ship gunnery.
    const atkCat = M.bomber ? 'bomber' : 'attack';
    // Attach the per-shot roll trace to the summary line so the report can expand it.
    const _detail = (M.shotDetails && M.shotDetails.length) ? { attacker: atkName, shots: M.shotDetails } : null;
    if (totDmg > 0 || kills > 0) logEvent(state, `${atkName} hit ${tgtList} for ${totDmg} dmg${kills ? ` · ${kills} destroyed` : ''}`, atkCat, _detail);
    else logEvent(state, `${atkName} fired at ${tgtList} — no damage`, atkCat, _detail);
    (M.log || []).forEach(line => logEvent(state, `· ${line}`, atkCat));
  }
  let hint = null;
  if (M.bomber) {
    if (M.cripplingFire) {
      const s = M.shots[0];
      const ts = state.groups[s.targetGid] && state.groups[s.targetGid].ships[s.targetSi];
      if (ts && !ts.destroyed) {
        ts.fireTokens = (ts.fireTokens || 0) + M.cripplingFire;
        ts.crippling = ts.crippling || [];
        if (!ts.crippling.includes('fire')) ts.crippling.push('fire');
      }
    }
    state.launchedAssets = state.launchedAssets.filter(a => !M.bomberAssetIds.includes(a.id));
    hint = { bomber: true, scope: state._bomberResolveSide, scopeType: state._bomberResolveType };
  } else {
    const aDef = getDef(state, M.attackerGid);
    const grp = state.groups[M.attackerGid];
    grp.ships.forEach(ship => {
      if (!ship.weaponTargets) { ship.firedThisActivation = true; return; }
      ship.limitedUses = ship.limitedUses || {};
      const seen = new Set();
      Object.keys(ship.weaponTargets).forEach(wi => {
        const sp = parseWeaponSpecials(aDef.weapons[wi]);
        const gk = weaponGroupKey(aDef, parseInt(wi));
        if (sp.limited && !seen.has(gk)) { seen.add(gk); ship.limitedUses[wi] = (ship.limitedUses[wi] || 0) + 1; }
      });
      ship.firedThisActivation = true;
      ship.weaponTargets = {};
    });
  }
  state.attackModal = null;
  return hint;
}

/* ── EXPLOSIVE DETONATION (Resistance "Guy Fawkes" Fire Ship) ──
   Skip weapon assignment: roll the weapon's dice (each natural 6 explodes into an extra
   die), then spread the hits EQUALLY across every Ship — friendly AND enemy — on the same
   layer within 6". Core damage (no Energy/Kinetic save). The ship is then removed from the
   game ("Set Timers And Run": a Fawkes' Crew Battalion rides a friendly Ship within 8";
   the Ship only scores Kill Points when that Battalion is later removed — modelled here as
   a no-KP self-destruct plus a crew marker). Resolves in one shot: any capital caught in
   the blast has its crippling / explosion auto-rolled. */
export function explosiveDetonation(state, rng, gid, si) {
  const grp = state.groups[gid];
  if (!grp) return state;
  const def = getDef(state, gid);
  const ship = grp.ships[si];
  if (!ship || ship.destroyed || ship.offTable) return state;
  const w = (def.weapons || []).find(x => /Explosive Detonation/i.test(x.name)) || { att: 8, lock: '3+', dmg: 1, special: 'Critical-1' };
  const lock = lockVal(w) || 3;
  const critMargin = (/Reinforced Armour/i.test('')) ? 3 : 2;
  const critBonus = parseWeaponSpecials(w).critical || 0; // Critical-1 → +1 dmg per crit

  // Roll att dice; each natural 6 yields one extra die (exploding). Guard against runaways.
  const dice = []; let pool = w.att || 8, hits = 0, crits = 0, guard = 400;
  while (pool > 0 && guard-- > 0) {
    pool--;
    const r = rollDie(rng);
    const isHit = r >= lock, isCrit = r >= lock + critMargin;
    if (isHit) hits++;
    if (isCrit) crits++;
    if (r === 6) pool++;
    dice.push({ r, isHit, isCrit });
  }
  recordDice(state, def.side, dice.map(d => d.r));

  // Affected ships: every living, on-table ship (either side) on the SAME layer within 6",
  // excluding the detonating ship itself.
  const layer = ship.layer || 'orbit';
  const Rpx = 6 * INCH + 1;
  const targets = [];
  Object.keys(state.groups).forEach(tgid => {
    state.groups[tgid].ships.forEach((ts, tsi) => {
      if (ts.destroyed || ts.offTable) return;
      if (tgid === gid && tsi === si) return;
      if ((ts.layer || 'orbit') !== layer) return;
      if (Math.hypot(ts.x - ship.x, ts.y - ship.y) <= Rpx) targets.push({ gid: tgid, si: tsi });
    });
  });

  const M = { attackerGid: gid, attackerSi: si, bomber: false,
              pendingDamage: {}, spillEligible: {}, log: [], crippleQueue: [], explodeQueue: [] };
  const perTarget = [];
  if (targets.length && hits > 0) {
    const base = Math.floor(hits / targets.length);
    let rem = hits % targets.length;
    let critRem = crits;
    targets.forEach((t, i) => {
      const h = base + (i < rem ? 1 : 0);
      const give = Math.min(critRem, h); critRem -= give;   // Critical-1 bonus follows the hits
      const dmg = h + give * critBonus;
      const td = getDef(state, t.gid);
      if (dmg > 0) { const k = targetKey(t.gid, t.si); M.pendingDamage[k] = dmg; M.spillEligible[k] = true; }
      perTarget.push({ gid: t.gid, si: t.si, name: td?.name, side: td?.side, dmg });
    });
    resolveAttackDamage(state, M);
    // Auto-resolve any crippling / explosion the blast queued (capitals only), incl. chains.
    let g2 = 300;
    while (g2-- > 0) {
      if (M.crippleQueue.length)      advanceAttack(state, rng, M, M.crippleQueue[0].rolled ? 'crippling-next' : 'crippling-roll');
      else if (M.explodeQueue.length) advanceAttack(state, rng, M, M.explodeQueue[0].rolled ? 'explosion-next'  : 'explosion-roll');
      else break;
    }
  }

  // Mark which targets ended up destroyed (after spillover / explosion chains).
  perTarget.forEach(t => { const ts = state.groups[t.gid]?.ships[t.si]; t.destroyed = !!(ts && ts.destroyed); });

  // Log under the report's bomber/asset category.
  logEvent(state, `${def.name}: EXPLOSIVE DETONATION — ${hits} hit${hits !== 1 ? 's' : ''} spread to ${targets.length} ship${targets.length !== 1 ? 's' : ''} within 6"`, 'bomber');
  perTarget.forEach(t => { if (t.dmg > 0) logEvent(state, `· ${t.name}: ${t.dmg} Core${t.destroyed ? ' · destroyed' : ''}`, 'bomber'); });

  // Set Timers And Run: remove the ship (no immediate KP), leave a Fawkes' Crew Battalion
  // on the nearest friendly ship within 8".
  ship.destroyed = true; ship.firedThisActivation = true; ship._selfDestruct = true;
  let crewShip = null, crewName = null, crewD = 8 * INCH + 1;
  Object.keys(state.groups).forEach(fgid => {
    const fdef = getDef(state, fgid);
    if (fdef?.side !== def.side) return;
    state.groups[fgid].ships.forEach((fs, fsi) => {
      if (fs.destroyed || fs.offTable) return;
      if (fgid === gid && fsi === si) return;
      const d = Math.hypot(fs.x - ship.x, fs.y - ship.y);
      if (d <= crewD) { crewD = d; crewShip = fs; crewName = fdef.name; }
    });
  });
  if (crewShip) { crewShip.fawkesCrew = (crewShip.fawkesCrew || 0) + 1; logEvent(state, `Set Timers And Run: Fawkes' Crew Battalion placed on ${crewName}`, 'ground'); }

  state.detonationModal = {
    attacker: def.name, side: def.side, dice, hits, crits,
    targets: perTarget, crew: crewName, log: M.log,
  };
  return state;
}

/* Deterministic attack-modal declarations (no dice): raise/lower Shields,
   Overcharge a weapon, declare an Escort redirect, Brace for Impact / Contain
   Reactor (spend 2 AP), or resolve an Impel forced turn/move. */
export function attackDeclare(state, M, decl) {
  if (!M) return state;
  switch (decl.what) {
    case 'shield':
      M.shieldsUp = M.shieldsUp || {};
      M.shieldsUp[decl.key] = !!decl.value;
      if (!decl.value && M.shieldBooster) delete M.shieldBooster[decl.key];
      break;
    case 'shieldBooster':
      M.shieldBooster = M.shieldBooster || {};
      if (decl.value) M.shieldBooster[decl.key] = decl.boosterGid;
      else delete M.shieldBooster[decl.key];
      break;
    case 'overcharge':
      M.overcharge = M.overcharge || {};
      M.overcharge[decl.wi] = !!decl.value;
      break;
    case 'escort': {
      const s = M.shots[decl.idx];
      if (!s || s.escortedTo) break;
      const esc = eligibleEscort(state, s.targetGid, s.targetSi);
      if (!esc) break;
      if (M.escortGid && M.escortGid !== esc.gid) break; // one Escort Group per attack
      M.escortGid = esc.gid;
      const eg = state.groups[esc.gid];
      const leadIdx = eg.ships.findIndex(sh => !sh.destroyed && !sh.offTable);
      s.escortedTo = { gid: esc.gid, si: leadIdx, origGid: s.targetGid, origSi: s.targetSi };
      s.targetGid = esc.gid; s.targetSi = leadIdx;
      M.log.push(`Escort: ${esc.name} intercepts hits`);
      break;
    }
    case 'brace': {
      const c = M.crippleQueue[0]; const defSide = c && getDef(state, c.gid) && getDef(state, c.gid).side;
      if (defSide && state.planning && state.planning.ap[defSide] >= 2 && !c.braced) {
        state.planning.ap[defSide] -= 2; c.braced = true;
        M.log.push(`${factionName(state, defSide)} Braced for Impact (crippling → 4)`);
      }
      break;
    }
    case 'contain': {
      const ex = M.explodeQueue[0]; const defSide = ex && getDef(state, ex.gid) && getDef(state, ex.gid).side;
      if (defSide && state.planning && state.planning.ap[defSide] >= 2 && !ex.contained) {
        state.planning.ap[defSide] -= 2; ex.contained = true;
        M.log.push(`${factionName(state, defSide)} Contained Reactor (explosion → 2)`);
      }
      break;
    }
    case 'impel': {
      const q = M.impelQueue.shift();
      const grp = state.groups[q.gid];
      if (grp) {
        if (decl.choice === 'turn') {
          const turn = q.big ? 90 : 45;
          grp.ships.forEach(s => { if (!s.destroyed && !s.offTable) s.heading = ((s.heading || 0) + turn) % 360; });
          M.log.push(`Impel: ${getDef(state, q.gid).name} turned ${turn}°`);
        } else {
          const distPx = q.x * 2 * INCH;
          grp.ships.forEach(s => {
            if (s.destroyed || s.offTable) return;
            const rad = (s.heading || 0) * Math.PI / 180;
            s.x = Math.max(0, Math.min(BOARD_PX, s.x + Math.cos(rad) * distPx));
            s.y = Math.max(0, Math.min(BOARD_PX, s.y + Math.sin(rad) * distPx));
          });
          M.log.push(`Impel: ${getDef(state, q.gid).name} moved forward ${q.x * 2}"`);
        }
      }
      proceedQueues(M, state);
      break;
    }
  }
  return state;
}

/* ── INTENT LAYER (Phase 1d) ──────────────────────────────────────────────
   An "intent" is a small serialisable action object { type, ...payload }.
   `apply(state, intent, rng)` is the single entry point the server runs after
   `isLegal` (see gating.js) and that the local client runs in hotseat mode.
   Only turn-flow intents are modelled so far; more families migrate over from
   the inline client handlers incrementally. Each intent maps to one mutator. */

/* Active side spends a Pass Token and hands activation to the opponent
   (mirrors the alternation done after a finished activation). */
export function passActivation(state) {
  const P = state.planning;
  if (!P || !state.activeSide || !(P.passTokens[state.activeSide] > 0)) return state;
  const passer = state.activeSide;
  P.passTokens[passer]--;
  logEvent(state, `${factionName(state, passer)} passed (token spent)`, 'misc');
  const other = passer === 'player1' ? 'player2' : 'player1';
  if (sideHasPendingActivation(state, other)) state.activeSide = other;
  else if (!sideHasPendingActivation(state, passer)) state.activeSide = null;
  return state;
}

/* End the Activation Phase: open the end-of-round Dropsite Activation step. */
export function beginEndRound(state) {
  state.dropsiteActivation = { side: state.initiativeHolder || 'player1', done: [], dsId: null };
  return state;
}

// ── STEP 2: REPAIR PHASE ──

export const REPAIRABLE = ['fire', 'defence', 'scanners', 'weapons', 'navigation', 'decay'];

export function anyRepairWork(state) {
  return Object.keys(state.groups).some(gid =>
    state.groups[gid].ships.some(s =>
      !s.destroyed && !s.offTable &&
      ((s.fireTokens > 0) || (s.crippling && s.crippling.some(c => REPAIRABLE.includes(c))))
    )
  );
}

/* Minimum distance from point (px, py) to line segment (ax,ay)→(bx,by), in same units. */
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* Roll a save die and return 1 hull damage if it fails, 0 if it saves. */
function rollHullHit(rng, saveSv) {
  if (saveSv == null) return 1;
  return rollDie(rng) < saveSv ? 1 : 0;
}

function advanceRoundInternal(state, rng) {
  // Status tokens are automatically removed at the start of the End Phase.
  Object.values(state.groups).forEach(g => g.ships.forEach(s => {
    if (s.statusToken) {
      s.statusToken = false;
      if (s.crippling) { const i = s.crippling.indexOf('scanners'); if (i >= 0) s.crippling.splice(i, 1); }
    }
  }));
  state.assetPhase = null;
  state.assetMove = null;
  state.battalionCombat = null;
  state.dropsiteActivation = null;
  state.repairPhase = null;
  // Victory Point scoring for the round just completed (before advancing).
  const completedRound = state.round;
  // runScoring is in mutators too — use internal reference
  const scoreLog = runScoring(state, rng, completedRound);
  if (completedRound >= 6) {
    const u = state.score.player1, s2 = state.score.player2;
    let winner;
    if (u.vp !== s2.vp) winner = u.vp > s2.vp ? 'player1' : 'player2';
    else if (u.kp !== s2.kp) winner = u.kp > s2.kp ? 'player1' : 'player2';
    else winner = 'draw';
    state.gameOver = { winner, scoreLog };
    return state;
  }
  if (state.lastScoring) state.scoringModal = { ...state.lastScoring, log: scoreLog };

  // ── SCENARIO END-PHASE EVENTS ──
  const _layKey = state.scenario && state.scenario.layout;

  // Moonskipper: moon moves diagonally (bottom-left → top-right) each End Phase;
  // ships in orbit within 6" of the swept path are destroyed.
  if (_layKey === 'se1_moonskipper' && completedRound <= 4) {
    const prevX = state.moonPos ? state.moonPos.x : 0;
    const prevY = state.moonPos ? state.moonPos.y : 48;
    const newX = completedRound * 12;
    const newY = 48 - completedRound * 12;
    state.moonPos = { x: newX, y: newY };
    if (state.scenarioData && state.scenarioData.largeObjects && state.scenarioData.largeObjects.length > 0) {
      state.scenarioData.largeObjects[0].x = newX;
      state.scenarioData.largeObjects[0].y = newY;
    }
    const sweepR = 6 * INCH; // half the 12" path width
    const px0 = inchToPx(prevX), py0 = inchToPx(prevY);
    const px1 = inchToPx(newX),  py1 = inchToPx(newY);
    const destroyed = [];
    Object.keys(state.groups).forEach(gid => {
      const def = getDef(state, gid);
      if (!def) return;
      const g = state.groups[gid];
      g.ships.forEach((s, si) => {
        if (s.destroyed || s.offTable) return;
        if (pointSegDist(s.x, s.y, px0, py0, px1, py1) <= sweepR) {
          s.destroyed = true;
          recordKill(state, def, def.side === 'player1' ? 'player2' : 'player1', false, `${gid}#${si}`);
          destroyed.push(def.name);
        }
      });
    });
    const moonNote = destroyed.length ? ` — ${destroyed.join(', ')} destroyed in moon's path` : '';
    logEvent(state, `Moonskipper: moon moves to (${newX}", ${newY}")${moonNote}`);
  }

  // Moonbreaker: check if all moon dropsites are levelled → moon breaks.
  // Each subsequent round the cloud deals 1K + 1E hit (with saves) to ships in the zone.
  if (_layKey === 'se1_moonbreaker') {
    const mbLay = LAYOUTS['se1_moonbreaker'];
    const moonDsSet = new Set(mbLay.moonDropsites || []);
    const moonDsList = ((state.scenarioData && state.scenarioData.dropsites) || []).filter(d => moonDsSet.has(d.id));
    // Detect moon breaking (first time all moon dropsites are levelled).
    if (state.moonBrokenRound == null && moonDsList.length > 0 && moonDsList.every(d => d.destroyed)) {
      state.moonBrokenRound = completedRound;
      logEvent(state, `Moonbreaker: moon breaks! Cloud zone active next round.`);
    }
    // Apply cloud damage to ships in zone (starts the round AFTER the break).
    if (state.moonBrokenRound != null && completedRound > state.moonBrokenRound) {
      const roundsAfterBreak = completedRound - state.moonBrokenRound;
      const cloudR = inchToPx(6 + 3 * roundsAfterBreak); // radius: starts 6" (12" diam), +3" per round
      const cx = inchToPx(24), cy = inchToPx(24);
      const cloudHit = [];
      Object.keys(state.groups).forEach(gid => {
        const def = getDef(state, gid);
        if (!def) return;
        const g = state.groups[gid];
        g.ships.forEach((s, si) => {
          if (s.destroyed || s.offTable) return;
          if (Math.hypot(s.x - cx, s.y - cy) > cloudR) return;
          const kDmg = rollHullHit(rng, saveVal(def.ks));
          const eDmg = rollHullHit(rng, saveVal(def.es));
          const dmg = kDmg + eDmg;
          if (dmg > 0) {
            s.hull = Math.max(0, s.hull - dmg);
            if (s.hull <= 0) {
              s.destroyed = true;
              recordKill(state, def, def.side === 'player1' ? 'player2' : 'player1', false, `${gid}#${si}`);
            }
            cloudHit.push(`${def.name} −${dmg}`);
          }
        });
      });
      const diam = 12 + 6 * roundsAfterBreak;
      logEvent(state, `Moonbreaker cloud (${diam}" diam): ${cloudHit.length ? cloudHit.join(', ') : 'no ships hit'}`);
    }
  }

  state.round = state.round + 1;
  logEvent(state, `── Round ${state.round} begins ──`, 'round');
  Object.values(state.groups).forEach(g => {
    g.activated = false;
    g.order = null;
    g.hitByLastRound = g.hitByThisRound || [];
    g.hitByThisRound = [];
    g.ships.forEach(s => {
      s.movedThisRound = false; s.justArrived = false; s.launchedThisRound = 0;
      s.usedLinks = {}; s.gateRemaining = undefined; s.order = null;
      s.firedThisActivation = false; s.weaponTargets = {}; s.dcRepaired = false;
      s.dcThisRound = false; s.detectorUsed = false; s.arrestedThisRound = false;
      s.usedVectoredSecondMove = false; s.pendingSceneryHits = null;
      s.deployedByGid = null; // cleared each round — cell acts in cells group next turn
    });
    g.moveTrail = [];
  });
  state.selectedShipIdx = null;
  state.groundLaunchLines = [];
  (state.launchedAssets || []).forEach(a => { delete a.fromGid; delete a.fromSi; delete a.fromDropsite; });
  ((state.scenarioData && state.scenarioData.dropsites) || []).forEach(ds => { ds.firedFeatures = []; ds.launchedFeatures = []; });
  if (scoreLog.length) state._lastScoreLog = scoreLog;
  rollInitiative(state, rng);
  return state;
}

export function startRepairPhase(state, rng) {
  // Step 1: apply Fire token damage; clear tokens; track capital destructions.
  const fireLog = [], explosions = [];
  Object.keys(state.groups).forEach(gid => {
    const def = getDef(state, gid);
    state.groups[gid].ships.forEach((s, si) => {
      if (s.destroyed || s.offTable || !s.fireTokens) return;
      const dmg = s.fireTokens;
      s.hull = Math.max(0, s.hull - dmg);
      s.fireTokens = 0;
      fireLog.push(`${def.name} takes ${dmg} Fire damage (${s.hull}/${s.maxHull})`);
      if (s.hull <= 0) { s.destroyed = true; if (isCapital(def)) explosions.push(makeExplosionRoll(gid, si, def, s)); }
    });
  });
  while (explosions.length) {
    const ex = explosions.shift();
    fireLog.push(`${ex.name} exploded: ${ex.effectName}`);
    applyExplosionEffect(state, rng, ex, { explodeQueue: explosions });
  }
  // Step 2: roll repair dice server-side (pre-roll all so client just displays results).
  const repairLog = [], targets = [];
  Object.keys(state.groups).forEach(gid => {
    const def = getDef(state, gid);
    state.groups[gid].ships.forEach((s, si) => {
      if (s.destroyed || s.offTable || !s.crippling) return;
      const eff = s.crippling.filter(c => REPAIRABLE.includes(c));
      if (!eff.length) return;
      const rolled = eff.map(e2 => {
        const dice = s.dcThisRound ? [rollDie(rng), rollDie(rng)] : [rollDie(rng)];
        const need = e2 === 'decay' ? 6 : 4;
        const success = dice.some(d => d >= need);
        if (success) {
          const i = s.crippling.indexOf(e2);
          if (i >= 0) s.crippling.splice(i, 1);
          if (e2 === 'fire') s.fireTokens = 0;
          repairLog.push(`${def.name}: repaired ${e2}`);
        }
        return { eff: e2, dice, need, success };
      });
      targets.push({ gid, si, name: def.name, effects: eff.slice(), dc: !!s.dcThisRound, rolled });
    });
  });
  state.repairPhase = { step: fireLog.length ? 'fire' : 'repair', fireLog, targets, idx: 0, log: repairLog };
  return state;
}

export function advanceRound(state, rng) {
  if (anyRepairWork(state)) {
    state.assetPhase = null;
    state.assetMove = null;
    state.battalionCombat = null;
    state.dropsiteActivation = null;
    return startRepairPhase(state, rng);
  }
  return advanceRoundInternal(state, rng);
}

export function finishRepairPhase(state, rng) {
  state.repairPhase = null;
  return advanceRoundInternal(state, rng);
}

/* Assign an Order to a Group, applying its immediate effects (Spike changes and
   Damage Control hull recovery). Legality is checked by gating.js#isLegal — this
   only mutates. The DC hull roll uses `rng`, so it resolves on whichever runtime
   applies the intent (seeded server rng online, localRng in hotseat). */
export function applyCancelOrder(state, gid) {
  const grp = state.groups[gid];
  if (!grp || !grp.order) return state;
  const snap = grp._cancelSnapshot;
  if (snap) {
    grp.spikes = snap.spikes;
    grp.ships.forEach((s, i) => {
      const ss = snap.ships[i];
      if (!ss) return;
      s.hull = ss.hull;
      s.dcRepaired = ss.dcRepaired;
      s.dcThisRound = ss.dcThisRound;
      // Restore the deploy-adjust window so a just-deployed Group can be UNDO-DEPLOYED again
      // (applyOrder clears justArrived/sigSilent; cancelling the activation must put them back).
      s.justArrived = ss.justArrived;
      s.sigSilent = ss.sigSilent;
    });
    grp._cancelSnapshot = null;
  }
  const def = getDef(state, gid);
  logEvent(state, `${def.name} order cancelled`);
  grp.order = null;
  return state;
}

export function applyOrder(state, rng, gid, order) {
  const grp = state.groups[gid];
  if (!grp) return state;
  const def = getDef(state, gid);
  grp._cancelSnapshot = {
    spikes: grp.spikes,
    ships: grp.ships.map(s => ({ hull: s.hull, dcRepaired: s.dcRepaired, dcThisRound: s.dcThisRound, justArrived: s.justArrived, sigSilent: s.sigSilent })),
  };
  grp.order = order;
  logEvent(state, `${def.name} → ${ORDERS[order].label}`);
  // Re-activating ends any prior deploy-adjust window and Silent Running reduction.
  grp.ships.forEach(s => { s.justArrived = false; s.sigSilent = false; });
  // Immediate Spike effects.
  if (order === 'GQ') grp.spikes = Math.max(0, grp.spikes - 2);
  if (order === 'SR') grp.spikes = 0;
  // Damage Control: each ship recovers Hull once (1, or D3 for H/C tonnage) and
  // is flagged to roll crippling-repair in the Repair step.
  if (order === 'DC') {
    grp.ships.forEach(s => {
      if (s.destroyed || s.offTable) return;
      s.dcThisRound = true;
      if (!s.dcRepaired) {
        s.dcRepaired = true;
        const rec = (def.tonnage === 'H' || def.tonnage === 'C') ? Math.ceil(rollDie(rng) / 2) : 1;
        s.hull = Math.min(s.maxHull, s.hull + rec);
        logEvent(state, `${def.name} Damage Control: +${rec} Hull`, 'repair');
      }
    });
  }
  // Auto-select a ship so its move cone shows immediately (view convenience).
  if (state.selectedShipIdx === null && ORDERS[order] && ORDERS[order].moveMax > 0) {
    const leadIdx = grp.leadShipIdx || 0;
    const pick = (i) => { const s = grp.ships[i]; return s && !s.destroyed && !s.offTable && !s.movedThisRound; };
    const idx = pick(leadIdx) ? leadIdx : grp.ships.findIndex((s, i) => pick(i));
    if (idx >= 0) state.selectedShipIdx = idx;
  }
  return state;
}

export function applyShipOrderMutator(state, gid, si, order) {
  const grp = state.groups[gid];
  if (!grp) return state;
  const ship = grp.ships[si];
  if (!ship) return state;
  const def = getDef(state, gid);
  ship.order = order;
  logEvent(state, `${def.name} #${si + 1} → ${ORDERS[order].label}`);
  // Auto-select the ship so its move cone shows immediately.
  if (ORDERS[order] && ORDERS[order].moveMax > 0) state.selectedShipIdx = si;
  return state;
}

/* ── INDIVIDUAL-ORDER HELPERS (Open Network / Payload) ── */
export function shipInNetwork(state, def, ship) {
  if (!def.openNetwork || !ship) return false;
  if (ship.offTable || ship.destroyed) return false;
  return (ship.deployedRound != null) && (ship.deployedRound < state.round);
}
export function onIndividualOrders(state, def, grp) {
  if (def.openNetwork) return grp && grp.ships.some(s => shipInNetwork(state, def, s));
  if (def.payload) return state.round >= 2 || (grp && grp.ships.some(s => s.deployedByGid));
  return false;
}
/* The ship arc/range measurement originates from the lead ship (when explicitly
   nominated) unless the group is on individual orders (open network / detached
   payload). When no lead is nominated (leadShipIdx == null) each ship measures
   from itself. */
export function firingOriginShip(state, def, grp, shipIdx) {
  if (!grp) return null;
  if (!onIndividualOrders(state, def, grp) && grp.leadShipIdx != null) {
    const lead = grp.ships[grp.leadShipIdx];
    if (lead && !lead.destroyed && !lead.offTable) return lead;
  }
  return grp.ships[shipIdx];
}

/* Effective Order for a ship: its own Order if on individual orders (networked
   Voidgate / detached Payload), otherwise the Group Order. */
export function effectiveOrder(state, def, grp, shipIdx) {
  const s = grp.ships[shipIdx];
  if (def.openNetwork) return shipInNetwork(state, def, s) ? (s ? s.order : null) : grp.order;
  if (onIndividualOrders(state, def, grp)) return s ? s.order : null;
  return grp.order;
}

/* The legal move cone for a ship under its effective Order. Shared by isLegal
   and commitMove so server validation and application never disagree. */
export function moveCone(state, gid, si, layerToggle) {
  const grp = state.groups[gid];
  const def = getDef(state, gid);
  const ship = grp.ships[si];
  const selOrderKey = effectiveOrder(state, def, grp, si);
  const o = ORDERS[selOrderKey];
  const navOff = ship.crippling && ship.crippling.includes('navigation');
  const normalMaxR = effectiveMaxMovePx(def, ship, selOrderKey);
  const lm = layerMove(normalMaxR, ship, layerToggle);
  const maxR = lm.maxPx;
  let minR = navOff ? 0 : (o ? o.moveMin * def.thrust * INCH : 0);
  if (minR > maxR) minR = 0;
  const turnDeg = navOff ? 0 : (o ? (o.turnLimit || 0) : 0);
  return { selOrderKey, o, navOff, lm, maxR, minR, turnDeg };
}

/* Commit a ship's primary move to (tx,ty): validate the cone, resolve base
   overlap, set position/heading/layer, then resolve scenery + mine effects, and
   set up the vectored / Course-Change follow-up aim where applicable. */
export function commitMove(state, rng, gid, si, tx, ty, layerToggle) {
  const grp = state.groups[gid];
  const def = getDef(state, gid);
  const ship = grp && grp.ships[si];
  if (!ship || ship.destroyed || ship.offTable || grp.activated || ship.movedThisRound) return state;
  const { selOrderKey, o, lm, maxR, minR, turnDeg } = moveCone(state, gid, si, layerToggle);
  if (!o || o.moveMax <= 0) return state;

  const dx = tx - ship.x, dy = ty - ship.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < minR - 0.5 || dist > maxR + 0.5) return state;
  const fwd = headingVec(ship.heading);
  const cosAngle = (fwd.x * dx + fwd.y * dy) / Math.max(0.0001, dist);
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
  if (angleDeg > turnDeg + 0.5) return state;

  grp.moveTrail = grp.moveTrail || [];
  grp.moveTrail.push({ si, x: ship.x, y: ship.y, heading: ship.heading, layer: ship.layer });

  const originX = ship.x, originY = ship.y;
  const bases = otherShipBases(state, gid, si);
  const resolved = resolveBaseOverlap(originX, originY, tx, ty, shipBaseRadiusPx(def), bases);
  ship.x = resolved.x;
  ship.y = resolved.y;
  ship.heading = Math.atan2(dy, dx) * 180 / Math.PI;
  ship.movedThisRound = true;
  ship.arrestNext = 0;
  ship.layer = lm.endLayer;
  state.layerToggle = false;
  state.hoverPoint = null;
  {
    const inches = (dist / INCH).toFixed(1);
    const cross = fwd.x * dy - fwd.y * dx;
    const turnTxt = angleDeg < 1 ? 'straight' : `${Math.round(angleDeg)}° ${cross >= 0 ? 'right' : 'left'}`;
    const layerTxt = lm.endLayer !== (grp.moveTrail[grp.moveTrail.length - 1] || {}).layer ? ` · ${lm.endLayer === 'orbit' ? 'ascend' : 'descend'}` : '';
    const nm = def.name + (grp.ships.length > 1 ? ` #${si + 1}` : '');
    logEvent(state, `${nm} moved ${inches}" (${turnTxt})${layerTxt}`);
  }

  // ── SCENERY MOVEMENT EFFECTS (orbit only) ──
  if (ship.layer !== 'atmosphere') {
    let destroyedByObj = false;
    ((state.scenarioData && state.scenarioData.largeObjects) || []).forEach(obj => {
      const ocx = inchToPx(obj.x), ocy = inchToPx(obj.y), orr = inchToPx(obj.diameter / 2);
      if (largeObjectAt(state, ship.x, ship.y) || segCrossesCircle(originX, originY, ship.x, ship.y, ocx, ocy, orr)) destroyedByObj = true;
    });
    if (destroyedByObj) {
      ship.destroyed = true;
      logEvent(state, `${def.name} destroyed — flew into a Large Object`, 'attack');
      if (isCapital(def)) { const ex = makeExplosionRoll(gid, si, def, ship); applyExplosionEffect(state, rng, ex, { explodeQueue: [] }); }
      return state;
    }
    const hits = sceneryMoveHits(state, originX, originY, ship.x, ship.y, ship);
    if (hits.length) {
      ship.pendingSceneryHits = (ship.pendingSceneryHits || []).concat(hits);
    }
  }

  // ── MINES ── enemy ship in Orbit moving through a Mine's Thrust range triggers it.
  if (!ship.destroyed && ship.layer !== 'atmosphere') {
    const enemySide = def.side === 'player1' ? 'player2' : 'player1';
    const mine = (state.launchedAssets || []).find(a => {
      if (a.kind !== 'mine' || a.side !== enemySide) return false;
      const rPx = assetProfile(state, a.side, 'mine').thrust * INCH;
      return segCrossesCircle(originX, originY, ship.x, ship.y, a.x, a.y, rPx) ||
             Math.hypot(ship.x - a.x, ship.y - a.y) <= rPx;
    });
    if (mine) {
      const prof = assetProfile(state, mine.side, 'mine');
      const dice = mine.count * (prof.att || 1);
      const w = { name: `Mine ×${mine.count}`, arc: '—', att: dice, lock: prof.lock, dmg: prof.dmg, type: prof.type, special: prof.special || '' };
      state.attackModal = {
        bomber: true, bomberKind: 'mine', bomberAssetIds: [mine.id], bomberSide: mine.side, saturation: 0, cripplingFire: 0,
        attackerGid: null, attackerSi: null,
        shots: [{ wi: 0, w, targetGid: gid, targetSi: si }],
        step: 'intro', shotIdx: 0, shieldsUp: {}, log: [], pendingDamage: {},
        hitResult: null, saveResult: null, crippleQueue: [], explodeQueue: []
      };
      logEvent(state, `Mine detonates on ${def.name}`);
      return state;
    }
  }

  if (def.vectored) {
    state.aiming = { gid, si, mode: 'vectored', originHeading: ship.heading, remainingMove: maxR - dist };
  } else if (selOrderKey === 'CC') {
    state.aiming = { gid, si, mode: 'course_change', originHeading: ship.heading, remainingMove: 0 };
  }
  return state;
}

/* Set a ship's facing during a vectored pivot or Course-Change bonus turn
   (±45° clamp). A vectored pivot with move left opens the second-move step. */
export function aimShip(state, tx, ty) {
  const a = state.aiming;
  if (!a) return state;
  const grp = state.groups[a.gid];
  const aship = grp && grp.ships[a.si];
  if (aship) {
    const desired = headingToward(aship.x, aship.y, tx, ty);
    aship.heading = clampHeading(a.originHeading, desired, 45);
    if (a.mode === 'vectored' && a.remainingMove > 1) {
      state.vectoredSecondMove = { gid: a.gid, si: a.si, remaining: a.remainingMove };
    }
  }
  state.aiming = null;
  state.hoverPoint = null;
  return state;
}

/* Commit the second leg of a Vectored move (≤ remaining distance, ≤20° off-axis). */
export function commitVectoredSecondMove(state, tx, ty) {
  const v = state.vectoredSecondMove;
  if (!v) return state;
  const grp = state.groups[v.gid];
  const vship = grp && grp.ships[v.si];
  if (vship) {
    const dx = tx - vship.x, dy = ty - vship.y;
    const dist = Math.hypot(dx, dy);
    const fwd = headingVec(vship.heading);
    const cos = (fwd.x * dx + fwd.y * dy) / Math.max(0.0001, dist);
    const angOff = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    if (dist <= v.remaining + 0.5 && angOff <= 20) {
      grp.moveTrail = grp.moveTrail || [];
      grp.moveTrail.push({ si: v.si, x: vship.x, y: vship.y, heading: vship.heading });
      const vBases = otherShipBases(state, v.gid, v.si);
      const vres = resolveBaseOverlap(vship.x, vship.y, tx, ty, shipBaseRadiusPx(getDef(state, v.gid)), vBases);
      vship.x = vres.x; vship.y = vres.y;
      vship.usedVectoredSecondMove = true;
    }
  }
  state.vectoredSecondMove = null;
  state.hoverPoint = null;
  return state;
}

/* Undo the last move for ship `si` in group `gid`, restoring from moveTrail. */
export function undoMove(state, gid, si) {
  const grp = state.groups[gid];
  if (!grp) return state;
  const ship = grp.ships[si];
  if (!ship) return state;
  const trail = grp.moveTrail || [];
  let idx = -1;
  for (let i = trail.length - 1; i >= 0; i--) {
    if (trail[i].si === si) { idx = i; break; }
  }
  if (idx < 0) return state;
  const prev = trail[idx];
  ship.x = prev.x; ship.y = prev.y; ship.heading = prev.heading;
  if (prev.layer !== undefined) ship.layer = prev.layer;
  ship.movedThisRound = false;
  ship.pendingSceneryHits = [];
  trail.splice(idx, 1);
  state.aiming = null;
  state.vectoredSecondMove = null;
  state.hoverPoint = null;
  return state;
}

/* End a Group's activation: apply end-of-activation effects (spikes, damage,
   Regenerate), mark the Group as activated, and hand off to the other side. */
export function finishActivation(state, rng, gid) {
  const grp = state.groups[gid];
  const def = getDef(state, gid);
  if (!grp || !def || grp.activated) return state;

  const openNet = onIndividualOrders(state, def, grp);

  // ── End-of-activation spikes ──
  if (openNet) {
    grp.ships.forEach(s => {
      if (s.destroyed) return;
      const o = s.order;
      if (o === 'WF') addShipSpikes(s, def, 2);
      else if (o === 'CC') addShipSpikes(s, def, 1);
      else if (o === 'MT') addShipSpikes(s, def, 2);
      if (o === 'SR') s.sigSilent = true;
    });
  } else {
    const o = grp.order;
    if (o === 'WF') addGroupSpikes(grp, def, 2);
    else if (o === 'CC') addGroupSpikes(grp, def, 1);
    else if (o === 'MT') addGroupSpikes(grp, def, 2);
    if (o === 'SR') grp.ships.forEach(s => { if (!s.destroyed) s.sigSilent = true; });
  }

  // ── End-of-activation damage ──
  const variantKey = state.scenario && state.scenario.variant;
  const expansiveAtmo = variantKey === 'expansive_atmosphere';
  const orbitalComplex = variantKey === 'orbital_complex';
  const layKey = state.scenario && state.scenario.layout;
  const isOrbitalDecayScen = layKey === 'se1_one_with_almost_nothing' || layKey === 'se1_almost_nothing_at_all';
  const is2D3 = def.tonnage === 'C';
  // Roll D3 (2D3 for Colossal), keeping each raw d6 face so the modal can render
  // the dice the same way it renders hit/save rolls. Returns { dice, total }.
  const rollD3 = (times = is2D3 ? 2 : 1) => {
    const dice = []; let total = 0;
    for (let i = 0; i < times; i++) {
      const face = rollDie(rng); const val = Math.ceil(face / 2);
      dice.push({ face, dmg: val }); total += val;
    }
    return { dice, total };
  };
  const dmgLog = [];
  // Per-ship record of end-of-activation hazard damage (atmosphere, orbital decay,
  // Expansive Atmosphere), surfaced to the client as a dice-roll confirmation
  // modal before the activation passes to the next player.
  const hazardReport = [];

  grp.ships.forEach((s, si) => {
    if (s.destroyed || s.offTable) return;
    let dmg = 0;
    const sources = []; // { label, dice:[{face,dmg}], total }

    if (s.layer === 'atmosphere' && !/Descent/i.test(def.special || '')) {
      const r = rollD3();
      sources.push({ label: 'Atmosphere', kind: 'damage', dice: r.dice, total: r.total });
      dmg += r.total;
      dmgLog.push(`${def.name}: ${r.total} (atmosphere)`);
    }
    if (orbitalComplex && s.crippling && s.crippling.includes('decay')) {
      const r = rollD3();
      sources.push({ label: 'Orbital Decay', kind: 'damage', dice: r.dice, total: r.total });
      dmg += r.total;
      dmgLog.push(`${def.name}: ${r.total} (orbital decay)`);
    }
    // Orbital Decay tokens (One With/Almost Nothing scenarios): each token deals D3 (2D3 for Colossal).
    if (isOrbitalDecayScen && s.orbitalDecayTokens > 0) {
      const r = rollD3((is2D3 ? 2 : 1) * s.orbitalDecayTokens);
      sources.push({ label: `${s.orbitalDecayTokens}× Orbital Decay`, kind: 'damage', dice: r.dice, total: r.total });
      dmg += r.total;
      dmgLog.push(`${def.name}: ${r.total} (${s.orbitalDecayTokens}× Orbital Decay)`);
    }
    const effOrd = openNet ? s.order : grp.order;
    if (expansiveAtmo && (effOrd === 'CC' || effOrd === 'MT')) {
      // Save vs the better of ES/KS; a failed save (or no save) deals 1 damage.
      const sv = Math.min(saveVal(def.es) || 7, saveVal(def.ks) || 7);
      const face = rollDie(rng);
      const failed = sv == null || face < sv;
      sources.push({ label: 'Expansive Atmosphere', kind: 'save', dice: [{ face, dmg: failed ? 1 : 0 }], total: failed ? 1 : 0 });
      if (failed) { dmg += 1; dmgLog.push(`${def.name}: 1 (Expansive Atmosphere)`); }
    }

    const hullBefore = s.hull;
    if (dmg > 0) {
      s.hull = Math.max(0, s.hull - dmg);
      if (s.hull <= 0 && !s.destroyed) {
        s.destroyed = true;
        if (isCapital(def)) {
          applyExplosionEffect(state, rng, makeExplosionRoll(gid, si, def, s), { explodeQueue: [] });
        }
      }
    }

    // Regenerate-X: recover X lost hull (if survived).
    const reg = (def.special || '').match(/Regenerate-(\d)/i);
    if (reg && !s.destroyed && s.hull < s.maxHull) {
      const heal = Math.min(parseInt(reg[1]), s.maxHull - s.hull);
      if (heal > 0) s.hull += heal;
    }

    if (sources.length) {
      hazardReport.push({
        si, name: def.name,
        sources,
        total: dmg,
        hullBefore,
        hullAfter: s.hull,
        maxHull: s.maxHull,
        destroyed: !!s.destroyed,
      });
    }
  });

  if (dmgLog.length) logEvent(state, `End-of-activation: ${dmgLog.join(', ')}`);

  grp.activated = true;

  // Any payload cell deployed by this activation acts as part of it.
  // Mark the cell's own group as also activated so it can't act again this round,
  // and clear the deployedByGid link (it will activate in the cells group next turn).
  Object.values(state.groups).forEach(cgrp => {
    if (cgrp.ships.some(cs => cs.deployedByGid === gid)) {
      cgrp.activated = true;
      cgrp.ships.forEach(cs => { if (cs.deployedByGid === gid) cs.deployedByGid = null; });
    }
  });

  state.selectedShipIdx = null;
  state.selectedGroupId = null;

  // Ships that took end-of-activation hazard damage (atmosphere / orbital decay /
  // Expansive Atmosphere): pause here and surface the roll for confirmation. The
  // activation passes to the next player only once `confirmEndActivation` clears it.
  if (hazardReport.length) {
    state.atmoDamage = { gid, side: def.side, ships: hazardReport };
  } else {
    advanceActiveSide(state);
  }
  return state;
}

/* Clear the end-of-activation hazard-damage report (after the player has
   acknowledged the dice roll) and hand the activation to the next player. */
export function confirmEndActivation(state) {
  if (!state.atmoDamage) return state;
  state.atmoDamage = null;
  advanceActiveSide(state);
  return state;
}

/* Commit the chosen scenario: assign deploy zones via seeded RNG, rebuild fleets,
   initialize all scenario state. Never swaps player1/player2 factions — only the
   physical north/south zones are assigned randomly. */
function applyCommitScenario(state, rng) {
  // Zone assignment: player1 always = f1, player2 always = f2 (no flip).
  state.factions.player1 = state.fleetChoices.f1;
  state.factions.player2 = state.fleetChoices.f2;
  const slotForSide = { player1: 'f1', player2: 'f2' };
  state.slotForSide = slotForSide;
  // Assign deployment zones. The player can pin the rulebook's Blue/Red sides via
  // state.deployChoice (Blue = North zone, Red = South zone); 'random' (default) rolls with the
  // seeded RNG. 'p1blue' = player1 takes Blue/North; 'p2blue' = player2 takes Blue/North.
  const dChoice = state.deployChoice;
  if (dChoice === 'p1blue') {
    state.deployZone = { player1: 'north', player2: 'south' };
  } else if (dChoice === 'p2blue') {
    state.deployZone = { player1: 'south', player2: 'north' };
  } else if (rng() < 0.5) {
    state.deployZone = { player1: 'south', player2: 'north' };
  } else {
    state.deployZone = { player1: 'north', player2: 'south' };
  }
  // Carry player colour choices through to side assignments. An explicit colour is kept; a
  // 'random' choice (or an unset slot) is resolved here with the seeded RNG so it's deterministic
  // and consistent online. f1 defaults to blue and f2 to red when simply unset (legacy behaviour);
  // only an explicit 'random' actually randomises.
  const COLOR_KEYS = ['green', 'purple', 'yellow', 'orange', 'blue', 'red'];
  const pc = state.playerColors || {};
  const pickColor = (exclude) => { const free = COLOR_KEYS.filter(k => k !== exclude); return free[Math.floor(rng() * free.length)]; };
  let c1 = pc.f1 === 'random' ? pickColor(null) : (pc.f1 || 'blue');
  let c2 = pc.f2 === 'random' ? pickColor(c1)   : (pc.f2 || 'red');
  if (c1 === c2) c2 = pickColor(c1); // keep the two sides visually distinct
  state.sideColors = { player1: c1, player2: c2 };
  rebuildFleets(state);
  // Apply stored Payload→Porter links to the rebuilt ship objects.
  ['player1', 'player2'].forEach(side => {
    const slot = slotForSide[side];
    const links = (state.payloadLinks && state.payloadLinks[slot]) || {};
    Object.keys(links).forEach(payKey => {
      const [payBase, paySi] = payKey.split(':');
      const [porBase, porSi] = links[payKey].split(':');
      const payGrp = state.groups[side + ':' + payBase];
      if (!payGrp) return;
      const payShip = payGrp.ships[parseInt(paySi)];
      if (!payShip) return;
      payShip.attachedTo = { gid: side + ':' + porBase, si: parseInt(porSi) };
    });
  });
  // Admiral Levels and Secondaries follow fleet slot → assigned side.
  state.admiralLevel = {
    player1: (state.admiralChoice && state.admiralChoice.f1) || 0,
    player2: (state.admiralChoice && state.admiralChoice.f2) || 0,
  };
  // Admiral assignments (from imported fleet) — map groupIdx → baseId for AP calc.
  const buildAdmiralAsns = (slot) => {
    const imp = state.importedFleets && state.importedFleets[slot];
    if (!imp || !imp.admiralAssignments) return null;
    return imp.admiralAssignments.map(a => ({
      level: a.level || 0,
      baseId: 'imp' + a.groupIdx,
      isFamous: a.isFamous || false,
    }));
  };
  const asn1 = buildAdmiralAsns('f1');
  const asn2 = buildAdmiralAsns('f2');
  if (asn1 || asn2) {
    state.admiralAssignments = { player1: asn1 || [], player2: asn2 || [] };
  } else {
    state.admiralAssignments = null;
  }
  state.secondaries = {
    player1: ((state.secondaryChoice && state.secondaryChoice.f1) || []).slice(),
    player2: ((state.secondaryChoice && state.secondaryChoice.f2) || []).slice(),
  };
  state.captured = { player1: 0, player2: 0 };
  state.admiralKilled = { player1: false, player2: false };
  state.admiralKillCount = { player1: 0, player2: 0 };
  state.moonguardSecondaries = { player1: state.moonguardSecondaryChoice && state.moonguardSecondaryChoice.f1 || null, player2: state.moonguardSecondaryChoice && state.moonguardSecondaryChoice.f2 || null };
  const scenData = buildScenarioState(state.scenario);
  state.scenarioData = scenData;
  // Moonswipe: apply pre-deployment large object repositioning from setup.
  if (state.moonswipe && state.moonswipe.done && state.moonswipe.positions) {
    state.moonswipe.positions.forEach((pos, i) => {
      if (scenData.largeObjects && scenData.largeObjects[i]) {
        scenData.largeObjects[i].x = pos.x;
        scenData.largeObjects[i].y = pos.y;
      }
    });
  }
  // Extract objective: seed Recon Operative tokens on each Dropsite.
  if (objAny(state, 'extract')) {
    scenData.dropsites.forEach(ds => {
      const k = dropsiteSizeKey(ds);
      ds.reconOps = k === 'L' ? 3 : k === 'M' ? 2 : 1;
    });
  }
  state.shipReconOps = {};
  state.reconKills = { player1: 0, player2: 0 };
  state.nominationPhase = false;
  state.breakthroughFlyoff = { player1: 0, player2: 0 };
  state.scoreLog = [];
  state.lastScoring = null;
  state.scoredRounds = [];
  state.eventLog = [];
  state.logExpanded = false;
  // Protect: auto-nominate highest-value dropsite nearest each side's zone.
  state.protectNom = { player1: null, player2: null };
  if (objAny(state, 'protect')) {
    const dss = scenData.dropsites.slice();
    ['player1', 'player2'].forEach(side => {
      if (objectiveForSide(state, side) !== 'protect') return;
      const cands = dss.filter(ds => !Object.values(state.protectNom).includes(ds.id));
      cands.sort((a, b) => {
        const va = (DROPSITE_VP[dropsiteSizeKey(a)] || DROPSITE_VP.M).control;
        const vb = (DROPSITE_VP[dropsiteSizeKey(b)] || DROPSITE_VP.M).control;
        if (vb !== va) return vb - va;
        return distFromZoneIn(state, side, inchToPx(a.y)) - distFromZoneIn(state, side, inchToPx(b.y));
      });
      if (cands.length) state.protectNom[side] = cands[0].id;
    });
  }
  // Secondary nominations (position-based).
  state.secondaryNominations = { player1: {}, player2: {} };
  let needsNomination = false;
  ['player1', 'player2'].forEach(side => {
    (state.secondaries[side] || []).forEach(key => {
      const def = SECONDARY_OBJECTIVES[key];
      if (!def || !def.nominate) return;
      const nom = nominateForSecondary(state, side, key);
      if (nom) { state.secondaryNominations[side][key] = nom; needsNomination = true; }
    });
  });
  state.nominationPhase = needsNomination;
  initShipsOffTable(state);
  // Determine starting phase.
  const t = scenData.sceneryTargets || {};
  if ((t.micrometeor || 0) + (t.dense || 0) > 0) {
    state.phase = 'scenery';
    state.sceneryTurn = 'player1'; // player1 places first in multiplayer
    state.sceneryReady = { player1: false, player2: false };
  } else if (needsNomination) {
    state.phase = 'nominations';
    state.nominationsReady = { player1: false, player2: false };
  } else if (objAny(state, 'protect')) {
    state.protectNomReady = { player1: false, player2: false };
    state.phase = 'protect';
  } else if (!anyoneNeedsDeployPhase(state)) {
    state.phase = 'play';
    rollInitiative(state, rng);
  } else {
    state.deployDone = { player1: false, player2: false };
    state.phase = 'deploy';
  }
  return state;
}

export function applyCommitScenery(state, rng, side) {
  state.sceneryReady = state.sceneryReady || { player1: false, player2: false };
  if (side) state.sceneryReady[side] = true;
  if (!state.sceneryReady.player1 || !state.sceneryReady.player2) return state;
  // Both sides ready — advance.
  state.sceneryPlace = null;
  state.sceneryTurn = null;
  if (state.nominationPhase) {
    state.phase = 'nominations';
    state.nominationsReady = { player1: false, player2: false };
  } else if (objAny(state, 'protect')) {
    state.protectNomReady = { player1: false, player2: false };
    state.phase = 'protect';
  } else if (anyoneNeedsDeployPhase(state)) {
    state.deployDone = state.deployDone || { player1: false, player2: false };
    state.phase = 'deploy';
  } else {
    state.phase = 'play';
    rollInitiative(state, rng);
  }
  return state;
}

export function applyBeginPlay(state, rng) {
  state.phase = 'play';
  rollInitiative(state, rng);
  return state;
}

export function applyGiveInitiative(state, to) {
  if (state.initiative) state.initiative.holder = to;
  return state;
}

export function applyBeginActivation(state) {
  if (!state.initiative) return state;
  state.activeSide = state.initiative.holder;
  state.initiativeHolder = state.initiative.holder;
  state.initiative = null;
  // If the holder has nothing to activate this round (e.g. wiped off the table with
  // only ineligible reserves left), hand off immediately. No finishActivation will
  // ever fire to call advanceActiveSide, so the turn would otherwise stall — the
  // opponent activates their remaining groups, or the round ends if neither can act.
  if (!sideHasPendingActivation(state, state.activeSide)) advanceActiveSide(state);
  return state;
}

export function deployShip(state, gid, si, x, y, heading) {
  const grp = state.groups[gid];
  if (!grp) return state;
  const ship = grp.ships[si];
  if (!ship) return state;
  ship.x = x; ship.y = y; ship.heading = heading;
  ship.offTable = false;
  ship.deployedRound = state.round;
  return state;
}

export function applyUndoDeploy(state, gid) {
  const grp = state.groups[gid];
  const def = getDef(state, gid);
  if (!grp || !def) return state;
  // Undo any moves first so ships return to their placed positions before going off-table.
  grp.ships.forEach((ship, si) => {
    if (!ship.destroyed && !ship.offTable && ship.movedThisRound) undoMove(state, gid, si);
  });
  let removed = 0;
  grp.ships.forEach(ship => {
    if (!ship.destroyed && !ship.offTable) {
      ship.offTable = true;
      ship.x = undefined; ship.y = undefined; ship.heading = undefined;
      ship.deployedRound = undefined; ship.justArrived = false;
      removed++;
    }
  });
  if (removed) {
    grp.order = null;
    logEvent(state, `${def.name} deployment undone (${removed} ship${removed !== 1 ? 's' : ''} returned off-table)`);
  }
  return state;
}

export function arriveShip(state, gid, si, x, y, heading) {
  const grp = state.groups[gid];
  if (!grp) return state;
  const ship = grp.ships[si];
  if (!ship) return state;
  ship.x = x; ship.y = y; ship.heading = heading;
  ship.offTable = false;
  ship.justArrived = true;
  ship.deployedRound = state.round;
  state.deployingGroup = gid;
  return state;
}

export function useDetector(state, rng, gid, si, wi, targetGid, targetSi) {
  const grp = state.groups[gid];
  const def = getDef(state, gid);
  const ship = grp && grp.ships[si];
  const targetGrp = state.groups[targetGid];
  const targetDef = getDef(state, targetGid);
  if (!grp || !def || !ship || !targetGrp || !targetDef) return state;
  addGroupSpikes(targetGrp, targetDef, 2);
  addGroupSpikes(grp, def, 1);
  ship.detectorUsed = true;
  ship.firedThisActivation = true;
  logEvent(state, `${def.name} used Detector on ${targetDef.name} (+2 Spikes · +1 self)`);
  return state;
}

function applyBeginLaunch(state, { gid, si, li, launchType }) {
  state.launching = { gid, si, li, type: launchType, gateSel: null };
}

function applySelectGate(state, { gateSel }) {
  if (state.launching) state.launching.gateSel = gateSel || null;
}

function applyCancelLaunch(state, { clearGateSel }) {
  if (!state.launching) return;
  if (clearGateSel) state.launching.gateSel = null;
  else state.launching = null;
}

function applyLaunchGroundAsset(state, intent) {
  const { gid, si, li, dsId, count, locationKey, targetGid, targetSi, gateSel } = intent;
  const grp = state.groups[gid];
  if (!grp) return state;
  const ship = grp.ships[si];
  if (!ship) return state;
  const def = getDef(state, gid);
  if (!def) return state;
  const entry = (def.launch || [])[li] || {};

  // Voidgate (Shaltari Mothership): decrement the chosen gateship's remaining capacity.
  if (gateSel) {
    const gateGrp = state.groups[gateSel.gid];
    const gateShip = gateGrp && gateGrp.ships[gateSel.si];
    if (gateShip) {
      const gateDef = getDef(state, gateSel.gid);
      gateShip.gateRemaining = Math.max(0, gateRemaining(gateShip, gateDef) - (count || 1));
    }
  }
  // Increment by actual count so multi-gate Mothership launches stack correctly.
  ship.launchedThisRound = (ship.launchedThisRound || 0) + (count || 1);
  if (entry.link) { ship.usedLinks = ship.usedLinks || {}; ship.usedLinks[entry.link] = entry.type || entry.link; }

  if (dsId && count > 0 && locationKey) {
    // Place battalions directly at the chosen location.
    const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === dsId);
    if (ds) {
      const b = dsBattalions(ds);
      if (b[locationKey]) b[locationKey][def.side] = (b[locationKey][def.side] || 0) + count;
      let locLabel = ds.base.name;
      if (locationKey !== 'ground') {
        const fi = parseInt(locationKey.replace('feat', ''));
        const fk = (ds.features || [])[fi];
        if (fk && FEATURES[fk]) locLabel = FEATURES[fk].name;
      }
      logEvent(state, `${def.name} landed ${count} battalion${count !== 1 ? 's' : ''} → ${locLabel}`, 'ground');
    }
    state.groundLaunchLines = state.groundLaunchLines || [];
    state.groundLaunchLines.push({ fromGid: gid, fromSi: si, dsId, side: def.side,
      ...(gateSel ? { gateGid: gateSel.gid, gateSi: gateSel.si } : {}) });
    state.selectedDropsiteId = dsId;
  }
  if (targetGid != null) {
    const tgrp = state.groups[targetGid];
    const tship = tgrp && tgrp.ships[targetSi ?? 0];
    if (tship) {
      tship.battalions = tship.battalions || { player1: 0, player2: 0 };
      tship.battalions[def.side] = (tship.battalions[def.side] || 0) + 1;
    }
  }

  state.launching = null;
  return state;
}

function applyLaunchAsset(state, intent) {
  const { gid, si, li, kind, count, x, y } = intent;
  const grp = state.groups[gid];
  if (!grp) return state;
  const ship = grp.ships[si];
  if (!ship) return state;
  const def = getDef(state, gid);
  if (!def) return state;
  const entry = (def.launch || [])[li] || {};
  state.launchedAssets = state.launchedAssets || [];
  state._assetId = (state._assetId || 0) + 1;
  state.launchedAssets.push({ id: 'a' + state._assetId, kind, count, side: def.side, x, y, moved: false, fromGid: gid, fromSi: si });
  logEvent(state, `${def.name} launched ${count} ${kind}${count !== 1 ? 's' : ''}`, 'launch');
  ship.launchedThisRound = (ship.launchedThisRound || 0) + count;
  if (entry.link) { ship.usedLinks = ship.usedLinks || {}; ship.usedLinks[entry.link] = entry.type || entry.link; }
  state.launching = null;
  return state;
}

function applyNominateLead(state, intent) {
  const { gid, si } = intent;
  const grp = state.groups[gid];
  if (!grp) return state;
  grp.leadShipIdx = si ?? null; // null clears the nomination
  return state;
}

function applyLockWeaponTarget(state, intent) {
  const { gid, si, wi, targetGid, targetSi, volleySlot } = intent;
  const grp = state.groups[gid];
  if (!grp) return state;
  const ship = grp.ships[si];
  if (!ship) return state;
  ship.weaponTargets = ship.weaponTargets || {};
  if (volleySlot != null) {
    const existing = ship.weaponTargets[wi];
    if (!Array.isArray(existing)) ship.weaponTargets[wi] = existing ? [existing] : [];
    ship.weaponTargets[wi][volleySlot] = { gid: targetGid, si: targetSi };
  } else {
    ship.weaponTargets[wi] = { gid: targetGid, si: targetSi };
  }
  return state;
}

function applyLockBombardmentTarget(state, intent) {
  const { gid, si, wi, dsId } = intent;
  const grp = state.groups[gid];
  if (!grp) return state;
  const ship = grp.ships[si];
  if (!ship) return state;
  ship.weaponTargets = ship.weaponTargets || {};
  ship.weaponTargets[wi] = { dsId };
  return state;
}

/* Deploy a detached payload ship onto the board within 3" of its Porter. */
function applyDeployPayload(state, intent) {
  const { gid, si, porterGid, porterSi, x, y } = intent;
  const payGrp = state.groups[gid];
  const payShip = payGrp && payGrp.ships[si];
  if (!payShip) return state;
  const porterGrp = state.groups[porterGid];
  const porter = porterGrp && porterGrp.ships[porterSi];
  if (!porter) return state;
  payShip.x = x; payShip.y = y;
  payShip.heading = porter.heading;
  payShip.layer = porter.layer || 'orbit';
  payShip.offTable = false;
  payShip.attachedTo = null;
  payShip.justArrived = true;
  payShip.deployedRound = state.round;
  payShip.movedThisRound = false;
  payShip.order = 'GQ';
  // Track which group's activation deployed this cell so finishActivation can
  // block until the cell acts, and moveShip/fireWeapons can allow cross-group use.
  payShip.deployedByGid = porterGid;
  return state;
}

function applyUnlockWeapon(state, intent) {
  const { gid, si, wi, volleySlot } = intent;
  const grp = state.groups[gid];
  if (!grp) return state;
  const ship = grp.ships[si];
  if (!ship || !ship.weaponTargets) return state;
  if (volleySlot != null && Array.isArray(ship.weaponTargets[wi])) {
    ship.weaponTargets[wi][volleySlot] = null;
    if (!ship.weaponTargets[wi].some(Boolean)) delete ship.weaponTargets[wi];
  } else {
    delete ship.weaponTargets[wi];
  }
  return state;
}

/* True if a Group definition mounts any weapon with "Mass Driver" in its name. */
export function groupHasMassDriver(def) {
  return !!def && (def.weapons || []).some(w => /Mass Driver/i.test(w.name || ''));
}

// UCM Mass Driver Volley admiral ability (2 AP): set the flag on the open attack modal so every
// Mass-Driver weapon in the firing Group gets Lock +1 (applied in rollHits). Must be invoked
// before any hits are rolled. No-op if it's already on, the attacker can't afford it, or the
// Group has no Mass Driver weapon (gating enforces the same — this is the authoritative apply).
function applySetMassDriverVolley(state) {
  const M = state.attackModal;
  if (!M || !M.attackerGid || M.massDriverVolley) return state;
  if ((M.resolvedShots && M.resolvedShots.length) || M.hitResult) return state; // hits already rolling
  const def = getDef(state, M.attackerGid);
  if (!def || !groupHasMassDriver(def)) return state;
  if (!state.planning || (state.planning.ap[def.side] || 0) < 2) return state;
  state.planning.ap[def.side] -= 2;
  M.massDriverVolley = true;
  logEvent(state, `${def.name}: Mass Driver Volley — Lock +1 (−2 AP)`, 'attack');
  return state;
}

function applyFireWeapons(state, intent) {
  const { gid, si } = intent;
  const grp = state.groups[gid];
  if (!grp) return state;
  const def = getDef(state, gid);
  if (!def) return state;

  // Pool shots: identical weapon+target pairs from all ships combine Attack dice.
  const combined = {};
  grp.ships.forEach((ship, sIdx) => {
    if (ship.destroyed || ship.offTable || !ship.weaponTargets) return;
    const shipEO = effectiveOrder(state, def, grp, sIdx);
    Object.keys(ship.weaponTargets).forEach(wi => {
      const t = ship.weaponTargets[wi];
      const w = def.weapons[parseInt(wi)];
      if (!w) return;
      const sp = parseWeaponSpecials(w);
      const shipAtt = w.att + ((sp.fusillade && shipEO === 'WF') ? sp.fusillade : 0);
      if (!Array.isArray(t) && t.dsId) {
        // Bombardment vs dropsite: pool identical weapon+dropsite pairs.
        const key = w.name + '|ds:' + t.dsId;
        if (combined[key]) {
          combined[key].w = { ...combined[key].w, att: combined[key].w.att + shipAtt };
        } else {
          combined[key] = { wi: parseInt(wi), w: { ...w, att: shipAtt }, dsId: t.dsId, fusilladeBaked: true };
        }
        return;
      }
      const reps = sp.volley > 1 ? sp.volley : 1;
      for (let r = 0; r < reps; r++) {
        // Per-volley target: use slot r if array (different targets), fall back to first valid.
        const tForRep = Array.isArray(t) ? (t[r] || t.find(Boolean)) : t;
        if (!tForRep) continue;
        const tg = state.groups[tForRep.gid];
        const ts = tg && tg.ships[tForRep.si];
        if (!ts || ts.destroyed || ts.offTable) continue;
        const key = w.name + '|' + tForRep.gid + '|' + tForRep.si + (reps > 1 ? '|v' + r : '');
        if (combined[key]) {
          combined[key].w = { ...combined[key].w, att: combined[key].w.att + shipAtt };
        } else {
          combined[key] = { wi: parseInt(wi), w: { ...w, att: shipAtt }, targetGid: tForRep.gid, targetSi: tForRep.si,
            volleyIdx: reps > 1 ? r + 1 : 0, volleyOf: reps, fusilladeBaked: true };
        }
      }
    });
  });

  const shots = Object.values(combined);
  if (!shots.length) return state;

  // Origin ship: lead ship unless group is on individual orders.
  let originSi = si != null ? si : (grp.leadShipIdx != null ? grp.leadShipIdx : 0);
  if (!onIndividualOrders(state, def, grp)) {
    const li = grp.leadShipIdx != null ? grp.leadShipIdx : 0;
    const lead = grp.ships[li];
    if (lead && !lead.destroyed && !lead.offTable) originSi = li;
  }

  state.attackModal = {
    attackerGid: gid, attackerSi: originSi,
    groupFire: true,
    shots,
    step: shots.length > 1 ? 'select' : 'intro',
    shotIdx: shots.length > 1 ? null : 0,
    resolvedShots: [],
    shieldsUp: {},
    log: [],
    pendingDamage: {},
    hitResult: null, saveResult: null, crippleQueue: [], explodeQueue: [],
  };
  return state;
}

function daSidesDone(state) {
  const da = state.dropsiteActivation;
  const dropsites = (state.scenarioData && state.scenarioData.dropsites) || [];
  return dropsites.every(ds => !dropsiteController(ds) || da.done.includes(ds.id));
}

function applyDaFinishDropsite(state, intent, rng) {
  const da = state.dropsiteActivation;
  if (!da) return state;
  if (intent.dsId && !da.done.includes(intent.dsId)) da.done.push(intent.dsId);
  da.dsId = null;
  state.launching = null;
  state.featureAttack = null;
  if (daSidesDone(state)) return applyDaEnd(state, rng);
  // Alternate activation: switch to the other side if they still have dropsites.
  const dropsites = (state.scenarioData && state.scenarioData.dropsites) || [];
  const otherSide = da.side === 'player1' ? 'player2' : 'player1';
  if (dropsites.some(ds => dropsiteController(ds) === otherSide && !da.done.includes(ds.id))) {
    da.side = otherSide;
    state.daActiveSide = null;
  }
  return state;
}

function applyDaSwitchSide(state, rng) {
  const da = state.dropsiteActivation;
  if (!da) return state;
  // Mark any remaining controlled dropsites for the outgoing side as done (skipped)
  const dropsites = (state.scenarioData && state.scenarioData.dropsites) || [];
  dropsites.forEach(ds => {
    if (dropsiteController(ds) === da.side && !da.done.includes(ds.id)) da.done.push(ds.id);
  });
  da.side = da.side === 'player1' ? 'player2' : 'player1';
  da.dsId = null;
  state.launching = null;
  state.featureAttack = null;
  if (daSidesDone(state)) return applyDaEnd(state, rng);
  return state;
}

function advanceStageOrRound(state, rng) {
  const res = advanceAssetStage(state, null);
  return res.done ? advanceRound(state, rng) : null;
}
function autoAdvanceAssetPhase(state, rng) {
  const ap = state.assetPhase;
  if (!ap) return;
  if (!ap.resolved && contestedDropsites(state).length === 0) ap.resolved = true;
  if (!ap.resolved) return;
  if (!ap.boardingResolved) {
    const boardLog = resolveBoardingActions(state, rng);
    ap.boardingResolved = true;
    ap.boardingLog = boardLog.length ? boardLog : ['No boarding damage.'];
  }
  if (ap.step !== 'assets') {
    ap.step = 'assets';
    state.assetMove = null;
    (state.launchedAssets || []).forEach(a => { a.moved = false; a.t2t = false; a.bomberTarget = null; a._preMove = null; });
    state.dogfightResult = null;
    ap.assetType = null; state.assetActiveSide = null;
    const _r = advanceStageOrRound(state, rng);
    if (_r) return _r;
  }
}

function applyDaEnd(state, rng) {
  state.dropsiteActivation = null;
  state.featureAttack = null;
  state.launching = null;
  state.assetPhase = { resolved: false, log: [] };
  autoAdvanceAssetPhase(state, rng);
  return state;
}

function applyLaunchDropsiteAsset(state, intent) {
  const { kind, count, x, y, fromDropsite, fromFeature } = intent;
  state.launchedAssets = state.launchedAssets || [];
  state._assetId = (state._assetId || 0) + 1;
  const side = (state.dropsiteActivation && state.dropsiteActivation.side) || 'player1';
  state.launchedAssets.push({ id: 'a' + state._assetId, kind, count, side, x, y, moved: false, fromDropsite });
  if (fromFeature != null) {
    const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === fromDropsite);
    if (ds) { ds.launchedFeatures = ds.launchedFeatures || []; if (!ds.launchedFeatures.includes(fromFeature)) ds.launchedFeatures.push(fromFeature); }
  }
  logEvent(state, `Dropsite launched ${count} ${kind}${count > 1 ? 's' : ''}`, 'launch');
  state.launching = null;
  return state;
}

function applyFireFeatureWeapon(state, intent) {
  const { dsId, fi, targetGid, targetSi } = intent;
  const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === dsId);
  if (!ds) return state;
  const fk = ds.features && ds.features[fi];
  if (!fk) return state;
  const f = FEATURES[fk];
  if (!f || !f.weapon) return state;
  const wp = f.weapon;
  const wObj = { name: `${f.name}: ${wp.name}`, arc: '—', att: wp.att, lock: wp.lock, dmg: wp.dmg, type: wp.type, special: wp.special || '' };
  const side = (state.dropsiteActivation && state.dropsiteActivation.side) || 'player1';
  state.attackModal = {
    bomber: true, bomberKind: 'feature', bomberAssetIds: [], bomberSide: side, saturation: 0, cripplingFire: 0,
    attackerName: `${f.name}: ${wp.name}`, attackerGid: null, attackerSi: null,
    shots: [{ wi: 0, w: wObj, targetGid, targetSi }],
    step: 'intro', shotIdx: 0, shieldsUp: {}, log: [], pendingDamage: {},
    hitResult: null, saveResult: null, crippleQueue: [], explodeQueue: []
  };
  ds.firedFeatures = ds.firedFeatures || [];
  if (!ds.firedFeatures.includes(fi)) ds.firedFeatures.push(fi);
  state.featureAttack = null;
  return state;
}

function applyBeginBomberAttack(state, intent) {
  const { assetIds, targetGid, targetSi, side, kind: rawKind } = intent;
  const kind = rawKind || 'bomber';
  const movers = (state.launchedAssets || []).filter(a => assetIds.includes(a.id) && a.kind === kind);
  const total = movers.reduce((n, a) => n + a.count, 0);
  if (!total) return state;
  const tg = state.groups[targetGid];
  const ts = tg && tg.ships[targetSi];
  if (!ts) return state;
  const prof = assetProfile(state, side, kind);
  const totalDice = total * (prof.att || 1);
  const saturation = (kind === 'torpedo') ? 0 : Math.max(0, total - 6);
  const cripplingFire = (prof.special || '').includes('Crippling-Fire') ? (total >= 7 ? 2 : 1) : 0;
  const kindLabel = kind === 'torpedo' ? 'Torpedo' : kind === 'fireship' ? 'Fire Ship Wing' : 'Bomber Wing';
  const w = { name: `${kindLabel} ×${total}`, arc: '—', att: totalDice, lock: prof.lock, dmg: prof.dmg, type: prof.type,
    special: [prof.special || '', saturation ? `Saturation −${saturation}` : ''].filter(Boolean).join(', ') };
  state.attackModal = {
    bomber: true, bomberKind: kind, bomberAssetIds: assetIds, bomberSide: side, saturation, cripplingFire,
    attackerName: `${kindLabel} ×${total}`,
    attackerGid: null, attackerSi: null,
    shots: [{ wi: 0, w, targetGid, targetSi }],
    step: 'intro', shotIdx: 0, shieldsUp: {}, log: [], pendingDamage: {},
    hitResult: null, saveResult: null, crippleQueue: [], explodeQueue: []
  };
  return state;
}

/* Place a scenery piece. Server-authoritative so both clients update together. */
function applyPlaceScenery(state, intent) {
  const { sceneryType, x, y, angle } = intent;
  if (!state.scenarioData) return state;
  state.scenarioData.placedScenery = state.scenarioData.placedScenery || [];
  state.scenarioData.placedScenery.push({ type: sceneryType, x, y, angle });
  if (state.sceneryTurn) state.sceneryTurn = state.sceneryTurn === 'player1' ? 'player2' : 'player1';
  logEvent(state, `${sceneryType === 'micrometeor' ? 'Micrometeor Cloud' : 'Dense Field'} placed at (${Math.round(x*10)/10}", ${Math.round(y*10)/10}")`);
  return state;
}

/* Move a launched asset to a new position. Handles auto-lock, split, dogfight, and merge. */
function applyAssetMove(state, rng, intent) {
  const { assetId, x, y, count: moveCount } = intent;
  const assets = state.launchedAssets || [];
  const asset = assets.find(a => a.id === assetId);
  if (!asset || asset.moved || asset.count <= 0) return state;

  const thrPx = assetThrust(state, asset) * INCH;
  const isBomberType = asset.kind === 'bomber' || asset.kind === 'fireship' || asset.kind === 'torpedo';

  // Auto-lock: bomber/fireship/torpedo moved onto an enemy ship → snap to base contact.
  if (isBomberType) {
    const hit = enemyShipAtPoint(state, asset.side, { x, y });
    if (hit && (hit.ship.layer || 'orbit') !== 'atmosphere') {
      const contact = 1 * INCH + shipBaseRadiusPx(hit.def);
      const dist = Math.hypot(hit.ship.x - asset.x, hit.ship.y - asset.y);
      const newX = dist <= contact ? asset.x : hit.ship.x - (hit.ship.x - asset.x) / dist * contact;
      const newY = dist <= contact ? asset.y : hit.ship.y - (hit.ship.y - asset.y) / dist * contact;
      if (Math.hypot(newX - asset.x, newY - asset.y) > thrPx + 2) return state;
      const ox = asset.x, oy = asset.y;
      asset._preMove = { x: ox, y: oy, t2tRange: asset._t2tRange };
      asset.x = newX; asset.y = newY; asset.moved = true; asset._t2tRange = undefined;
      asset.facing = Math.atan2(-(newX - ox), -(newY - oy));
      applyAssetScenery(state, rng, asset, ox, oy);
      if (asset.count > 0) { asset.bomberTarget = { gid: hit.gid, si: hit.si }; state.assetMove = { id: asset.id, count: asset.count }; }
      else { state.launchedAssets = state.launchedAssets.filter(a => a.count > 0); state.assetMove = null; }
      return state;
    }
  }

  if (Math.hypot(x - asset.x, y - asset.y) > thrPx + 2) return state;
  const actualCount = Math.min(moveCount || asset.count, asset.count);
  const ox = asset.x, oy = asset.y;

  let mover;
  if (actualCount < asset.count) {
    asset.count -= actualCount;
    const newId = 'a' + (state._assetId = (state._assetId || 0) + 1);
    mover = { id: newId, kind: asset.kind, count: actualCount, side: asset.side, x, y, moved: true, facing: Math.atan2(-(x - ox), -(y - oy)) };
    state.launchedAssets.push(mover);
  } else {
    asset._preMove = { x: ox, y: oy, t2tRange: asset._t2tRange };
    asset.x = x; asset.y = y; asset.moved = true; asset._t2tRange = undefined;
    asset.facing = Math.atan2(-(x - ox), -(y - oy));
    mover = asset;
  }

  applyAssetScenery(state, rng, mover, ox, oy);

  if (mover.count <= 0) {
    state.launchedAssets = state.launchedAssets.filter(a => a.count > 0);
    state.assetMove = null;
    return state;
  }

  // Fighter dogfight: collide with nearest enemy fighter.
  if (mover.kind === 'fighter') {
    const enemy = mover.side === 'player1' ? 'player2' : 'player1';
    const foe = state.launchedAssets.find(a => a.id !== mover.id && a.side === enemy &&
      Math.hypot(a.x - mover.x, a.y - mover.y) <= shipBaseRadiusPx({ tonnage: 'L' }));
    if (foe) {
      const rem = Math.min(mover.count, foe.count);
      mover.count -= rem; foe.count -= rem;
      state.dogfightResult = { attackerSide: mover.side, foeSide: enemy, foeKind: foe.kind,
        attackerBefore: mover.count + rem, attackerAfter: mover.count,
        foeBefore: foe.count + rem, foeAfter: foe.count, removed: rem };
      logEvent(state, `Dogfight: ${factionName(state, mover.side)} fighters vs ${factionName(state, enemy)} ${foe.kind}s — ${rem} each destroyed`, 'launch');
      state.launchedAssets = state.launchedAssets.filter(a => a.count > 0);
      // Keep assetMove on the surviving mover so the player can see the result and confirm.
      state.assetMove = mover.count > 0 ? { id: mover.id, count: mover.count } : null;
      return state;
    }
  }

  // Friendly merge.
  const merge = state.launchedAssets.find(a => a.id !== mover.id && a.kind === mover.kind &&
    a.side === mover.side && Math.hypot(a.x - mover.x, a.y - mover.y) <= shipBaseRadiusPx({ tonnage: 'L' }));
  if (merge) {
    merge.count += mover.count; merge.moved = true;
    state.launchedAssets = state.launchedAssets.filter(a => a.id !== mover.id);
    state.assetMove = { id: merge.id, count: merge.count };
    return state;
  }

  // Normal move complete — keep assetMove selected so the player sees UNDO/CONFIRM.
  state.assetMove = { id: mover.id, count: mover.count };
  return state;
}

/* Dispatch an intent to its mutator. Mutates `state` in place; returns it. */
export function apply(state, intent, rng) {
  switch (intent && intent.type) {
    case 'commitScenery':     return applyCommitScenery(state, rng, intent.side);
    case 'beginPlay':         return applyBeginPlay(state, rng);
    case 'giveInitiative':    return applyGiveInitiative(state, intent.to);
    case 'beginActivation':   return applyBeginActivation(state);
    case 'commitScenario':    return applyCommitScenario(state, rng);
    case 'readySetup': {
      state.setupReady = state.setupReady || { player1: false, player2: false };
      if (intent.side) state.setupReady[intent.side] = true;
      if (state.setupReady.player1 && state.setupReady.player2) applyCommitScenario(state, rng);
      return state;
    }
    case 'unreadySetup': {
      state.setupReady = state.setupReady || { player1: false, player2: false };
      if (intent.side) state.setupReady[intent.side] = false;
      return state;
    }
    case 'finishActivation':  return finishActivation(state, rng, intent.gid);
    case 'confirmEndActivation': return confirmEndActivation(state);
    case 'undoMove':          return undoMove(state, intent.gid, intent.si);
    case 'deployShip':        return deployShip(state, intent.gid, intent.si, intent.x, intent.y, intent.heading);
    case 'undoDeploy':        return applyUndoDeploy(state, intent.gid);
    case 'arriveShip':        return arriveShip(state, intent.gid, intent.si, intent.x, intent.y, intent.heading);
    case 'useDetector':       return useDetector(state, rng, intent.gid, intent.si, intent.wi, intent.targetGid, intent.targetSi);
    case 'pass':         return passActivation(state);
    case 'endRound':     return beginEndRound(state);
    case 'cancelOrder':     return applyCancelOrder(state, intent.gid);
    case 'applyOrder':      return applyOrder(state, rng, intent.gid, intent.order);
    case 'applyShipOrder':  return applyShipOrderMutator(state, intent.gid, intent.si, intent.order);
    case 'moveShip':     return commitMove(state, rng, intent.gid, intent.si, intent.x, intent.y, intent.layerToggle);
    case 'aimShip':      return aimShip(state, intent.x, intent.y);
    case 'vectoredMove': return commitVectoredSecondMove(state, intent.x, intent.y);
    case 'endVectoredMove': state.vectoredSecondMove = null; state.hoverPoint = null; return state;
    case 'holdPosition': {
      const hpShip = state.groups[intent.gid] && state.groups[intent.gid].ships[intent.si];
      if (hpShip) hpShip.movedThisRound = true;
      if (state.aiming && state.aiming.mode === 'course_change' && state.aiming.gid === intent.gid) {
        state.aiming = null;
        state.hoverPoint = null;
      }
      return state;
    }
    case 'beginBomberAttack':    return applyBeginBomberAttack(state, intent);
    case 'attackSelectShot': {
      const M = state.attackModal;
      if (!M || M.step !== 'select') return state;
      const idx = intent.shotIdx;
      if (idx == null || idx < 0 || idx >= M.shots.length) return state;
      if ((M.resolvedShots || []).includes(idx)) return state;
      M.shotIdx = idx; M.hitResult = null; M.saveResult = null; M.step = 'intro';
      return state;
    }
    case 'attackStep':
      if (state.attackModal && state.attackModal.bomber && intent.to === 'hit') state.dogfightResult = null;
      return advanceAttack(state, rng, state.attackModal, intent.to);
    case 'attackReroll':       return attackReroll(state, rng, state.attackModal, intent.which);
    case 'attackFighterReroll':return attackFighterReroll(state, rng, state.attackModal);
    case 'finishAttack':       finishAttack(state, state.attackModal); return state;
    case 'explosiveDetonation': return explosiveDetonation(state, rng, intent.gid, intent.si);
    case 'dismissDetonation':  state.detonationModal = null; return state;
    case 'attackDeclare':      return attackDeclare(state, state.attackModal, intent);
    case 'attackSetReroll': {
      const M = state.attackModal; if (!M) return state;
      let maxRR = 1;
      if (M.step === 'hit' && M.hitResult) {
        const atkSide = M.bomber ? M.bomberSide : (M.attackerGid ? getDef(state, M.attackerGid).side : null);
        const miss = M.hitResult.dice.filter(d => !d.isHit).length;
        maxRR = Math.min(miss, (state.planning && state.planning.ap[atkSide]) || 0);
      } else if (M.step === 'save' && M.saveResult && M.shots && M.shots[M.shotIdx]) {
        const td = getDef(state, M.shots[M.shotIdx].targetGid);
        const failed = M.saveResult.primDice.filter(d => !d.ok).length;
        maxRR = td ? Math.min(failed, (state.planning && state.planning.ap[td.side]) || 0) : 1;
      }
      const cur = Math.min(M.rerollN || maxRR, maxRR);
      M.rerollN = Math.max(1, Math.min(maxRR, cur + intent.delta));
      return state;
    }
    case 'attackSetFighterSpend': {
      const M = state.attackModal; if (!M || !M.saveResult || !M.shots) return state;
      const s = M.shots[M.shotIdx]; if (!s) return state;
      const sr = M.saveResult;
      const td = getDef(state, s.targetGid);
      const ts = state.groups[s.targetGid] && state.groups[s.targetGid].ships[s.targetSi];
      if (!td || !ts) return state;
      const failed = sr.primDice.filter(d => !d.ok).length;
      const wings = friendlyFightersInRange(state, td.side, ts.x, ts.y);
      const avail = wings.reduce((a, w) => a + w.count, 0);
      const cap = Math.min(failed, avail);
      M.fighterSpend = M.fighterSpend || {};
      const { wingId, delta } = intent;
      const wing = wings.find(w => w.id === wingId);
      if (!wing) return state;
      const curWing = M.fighterSpend[wingId] || 0;
      const otherSpend = Object.keys(M.fighterSpend).reduce((a, k) => a + (k === wingId ? 0 : (M.fighterSpend[k] || 0)), 0);
      M.fighterSpend[wingId] = Math.max(0, Math.min(wing.count, Math.max(0, cap - otherSpend), curWing + delta));
      return state;
    }
    case 'adjustDropsiteDamage': {
      const { dsId: adjDsId, delta: adjDelta } = intent;
      const adjDs = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === adjDsId);
      if (!adjDs || adjDs.destroyed) return state;
      adjDs.damage = Math.max(0, (adjDs.damage || 0) + adjDelta);
      const adjName = (adjDs.base && adjDs.base.name) || adjDsId;
      const adjSz = dropsiteSizeKey(adjDs);
      while (adjDs.maxHull && adjDs.damage >= adjDs.maxHull && !adjDs.destroyed) {
        if (adjDs.ruined) {
          adjDs.destroyed = true;
          logEvent(state, `${adjName}: LEVELLED (manual)`);
          if (adjDs.base && adjDs.base.category === 'station' && !adjDs._debrisPlaced) {
            const adjLayKey = state.scenario && state.scenario.layout;
            const adjLayout = adjLayKey && LAYOUTS[adjLayKey];
            if (adjLayout && adjLayout.stationCityLinks && adjDs.id in adjLayout.stationCityLinks) {
              adjDs._debrisPlaced = true;
              const adjDsx = inchToPx(adjDs.x), adjDsy = inchToPx(adjDs.y), adjR = 2 * INCH;
              Object.keys(state.groups).forEach(gid => { const g = state.groups[gid]; if (g.ships.some(sh => !sh.destroyed && !sh.offTable && Math.hypot(sh.x - adjDsx, sh.y - adjDsy) <= adjR)) g.spikes = (g.spikes || 0) + 1; });
              (state.launchedAssets || []).forEach(a => { if (a.count > 0 && Math.hypot(a.x - adjDsx, a.y - adjDsy) <= adjR) a.spikes = (a.spikes || 0) + 1; });
              state.scenarioData.dynamicDebris = state.scenarioData.dynamicDebris || [];
              state.scenarioData.dynamicDebris.push({ x: adjDs.x, y: adjDs.y, diameter: 4, fromStation: adjDs.id });
              state.scenarioData.focalPoints = state.scenarioData.focalPoints || [];
              state.scenarioData.focalPoints.push({ x: adjDs.x, y: adjDs.y, diameter: 4, label: `Debris (${adjName})`, special: ['low_crippled'], dynamic: true });
              logEvent(state, `${adjName} levelled: debris field placed`);
            }
          }
        } else {
          adjDs.ruined = true; adjDs.damage = adjDs.damage - adjDs.maxHull;
          logEvent(state, `${adjName}: RUINED (manual)`);
        }
      }
      return state;
    }
    case 'adjustBattalion': {
      const { dsId: batDsId, loc: batLoc, side: batSide, delta: batDelta } = intent;
      const batDs = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === batDsId);
      if (!batDs) return state;
      const batB = dsBattalions(batDs);
      if (!batB[batLoc]) batB[batLoc] = { player1: 0, player2: 0 };
      batB[batLoc][batSide] = Math.max(0, (batB[batLoc][batSide] || 0) + batDelta);
      return state;
    }
    case 'openDAFeatureAttack': {
      const { dsId: faDsId, fi: faFi } = intent;
      if (!state.dropsiteActivation) return state;
      state.featureAttack = { dsId: faDsId, fi: faFi, side: state.dropsiteActivation.side };
      state.daActiveSide  = state.dropsiteActivation.side; // needed by fireFeatureWeapon gating
      return state;
    }
    case 'daPickDropsite': {
      if (!state.dropsiteActivation) return state;
      state.dropsiteActivation.dsId = intent.dsId;
      return state;
    }
    case 'beginLaunch':        applyBeginLaunch(state, intent); return state;
    case 'selectGate':         applySelectGate(state, intent); return state;
    case 'cancelLaunch':       applyCancelLaunch(state, intent); return state;
    case 'launchAsset':        return applyLaunchAsset(state, intent);
    case 'launchGroundAsset':  return applyLaunchGroundAsset(state, intent);
    case 'deployPayload':      return applyDeployPayload(state, intent);
    case 'nominateLead':       return applyNominateLead(state, intent);
    case 'lockWeaponTarget':          return applyLockWeaponTarget(state, intent);
    case 'lockBombardmentTarget':        return applyLockBombardmentTarget(state, intent);
    case 'resolveBombardCollateral':     return applyResolveBombardCollateral(state, intent);
    case 'unlockWeapon':              return applyUnlockWeapon(state, intent);
    case 'fireWeapons':        return applyFireWeapons(state, intent);
    case 'setMassDriverVolley':   return applySetMassDriverVolley(state);
    case 'advanceRound':          return advanceRound(state, rng);
    case 'daFinishDropsite':       return applyDaFinishDropsite(state, intent, rng);
    case 'daSwitchSide':           return applyDaSwitchSide(state, rng);
    case 'daEnd':                  return applyDaEnd(state, rng);
    case 'launchDropsiteAsset':    return applyLaunchDropsiteAsset(state, intent);
    case 'fireFeatureWeapon':      return applyFireFeatureWeapon(state, intent);
    case 'openSceneryDamage': {
      const { gid: sdGid } = intent;
      const sdGrp = state.groups[sdGid];
      const sdDef = getDef(state, sdGid);
      if (!sdGrp || !sdDef) return state;
      const shots = [];
      sdGrp.ships.forEach((sdShip, sdSi) => {
        const ph = sdShip.pendingSceneryHits;
        if (!ph || !ph.length) return;
        ph.forEach(h => {
          shots.push({ wi: shots.length, w: { name: h.label, type: h.type, hits: h.n, dmg: 1, arc: '—', special: '' }, targetGid: sdGid, targetSi: sdSi });
        });
        sdShip.pendingSceneryHits = [];
      });
      if (!shots.length) return state;
      state.attackModal = {
        sceneryDamage: true,
        bomber: true, bomberKind: 'scenery', bomberAssetIds: [], bomberSide: sdDef.side,
        saturation: 0, cripplingFire: 0,
        attackerName: 'Scenery Damage',
        attackerGid: null, attackerSi: null,
        shots,
        step: shots.length > 1 ? 'select' : 'intro',
        shotIdx: shots.length === 1 ? 0 : null,
        resolvedShots: [],
        shieldsUp: {}, log: [], pendingDamage: {},
        hitResult: null, saveResult: null, crippleQueue: [], explodeQueue: []
      };
      return state;
    }
    case 'extractRecon': {
      const { gid: exGid, si: exSi, dsId: exDsId } = intent;
      const exGrp = state.groups[exGid];
      const exDef = getDef(state, exGid);
      const exShip = exGrp && exGrp.ships[exSi];
      const exDs = exDsId && state.scenarioData && state.scenarioData.dropsites &&
                   state.scenarioData.dropsites.find(d => d.id === exDsId);
      if (!exGrp || !exDef || !exShip || !exDs || !(exDs.reconOps > 0)) return state;
      const exTake = Math.min(transportValue(exDef), exDs.reconOps);
      if (exTake <= 0) return state;
      exDs.reconOps -= exTake;
      state.shipReconOps = state.shipReconOps || {};
      const exKey = exDef.id + '#' + exSi;
      state.shipReconOps[exKey] = (state.shipReconOps[exKey] || 0) + exTake;
      exShip.launchedThisRound = (exShip.launchedThisRound || 0) + exTake; // blocks re-use this activation
      logEvent(state, `${exDef.name} extracted ${exTake} Operative${exTake > 1 ? 's' : ''} from ${exDs.base.name}`);
      return state;
    }
    case 'objectivesFlyoff':
    case 'breakthroughFlyoff':
    case 'startBattalionCombat':
      state.battalionCombat = { stage: 'pick', dsId: null, done: [], log: [] };
      return state;
    case 'skipBattalionCombat':
      if (state.assetPhase) state.assetPhase.resolved = true;
      return state;
    case 'bcPickDropsite':
      if (state.battalionCombat) { state.battalionCombat.dsId = intent.dsId; state.battalionCombat.stage = 'init'; }
      return state;
    case 'bcAssignGround': {
      const bc = state.battalionCombat;
      if (!bc) return state;
      const ds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === bc.dsId);
      if (!ds) return state;
      const actor = bc.stage === 'init' ? (state.initiativeHolder || 'player1') : (state.initiativeHolder === 'player1' ? 'player2' : 'player1');
      const r = assignGroundToFeature(ds, actor, intent.featKey);
      if (r.removed > 0) {
        bc.log.push(`${ds.base.name}: ground vs ${r.where} — ${r.removed} each`);
        logEvent(state, `${ds.base.name}: ground vs ${r.where} — ${r.removed} battalions each side destroyed`, 'battalion');
      }
      if (bc.stage === 'init') bc.stage = 'other'; else bcResolveDropsite(state, bc, ds);
      return state;
    }
    case 'bcSkipAssign': {
      const bc2 = state.battalionCombat;
      if (!bc2) return state;
      const ds2 = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === bc2.dsId);
      if (bc2.stage === 'init') bc2.stage = 'other'; else if (ds2) bcResolveDropsite(state, bc2, ds2);
      return state;
    }
    case 'bcToDestroy':
      if (state.battalionCombat) { state.battalionCombat.stage = 'destroy'; state.battalionCombat.dsId = null; }
      return state;
    case 'bcFinish':
      state.battalionCombat = null;
      if (state.assetPhase) state.assetPhase.resolved = true;
      autoAdvanceAssetPhase(state, rng);
      return state;
    case 'resolveBoarding': {
      const boardLog = resolveBoardingActions(state, rng);
      if (state.assetPhase) { state.assetPhase.boardingResolved = true; state.assetPhase.boardingLog = boardLog.length ? boardLog : ['No boarding damage.']; }
      return state;
    }
    case 'startAssetMove':
      if (state.assetPhase) { state.assetPhase.step = 'assets'; }
      state.assetMove = null;
      (state.launchedAssets || []).forEach(a => { a.moved = false; a.t2t = false; a.bomberTarget = null; a._preMove = null; });
      state.dogfightResult = null;
      state.assetPhase.assetType = null; state.assetActiveSide = null;
      { const _r = advanceStageOrRound(state, rng); if (_r) return _r; }
      return state;
    case 'assetStageDone': {
      const { assetType: asdType, side: asdSide } = intent;
      if (!state.assetPhase || state.assetPhase.step !== 'assets') return state;
      if (state.assetActiveSide !== asdSide || state.assetPhase.assetType !== asdType) return state;
      (state.launchedAssets || []).forEach(a => {
        if (a.side === asdSide && kindsForAssetType(asdType).includes(a.kind)) a.moved = true;
      });
      state.assetMove = null;
      const asdRes = advanceAssetStage(state, { type: asdType, side: asdSide });
      state.assetPhase._pendingBomberResolve = asdRes.resolveAttacksFor
        ? { side: asdRes.resolveAttacksFor, type: asdRes.resolveType || asdType } : null;
      if (asdRes.done && !state.assetPhase._pendingBomberResolve) return advanceRound(state, rng);
      return state;
    }
    case 'assetPhaseDone': {
      const { side: apdSide } = intent;
      if (!state.assetPhase || state.assetPhase.step !== 'assets') return state;
      if (state.assetActiveSide) return state; // still stages remaining
      if (state.assetPhase._pendingBomberResolve) return state; // attacks unresolved
      state.assetPhase.doneSides = state.assetPhase.doneSides || [];
      if (!state.assetPhase.doneSides.includes(apdSide)) state.assetPhase.doneSides.push(apdSide);
      if (state.assetPhase.doneSides.length >= 2) return advanceRound(state, rng);
      return state;
    }
    case 'placeScenery':    return applyPlaceScenery(state, intent);
    case 'dismissDogfight': state.dogfightResult = null; return state;
    case 'assetMove':       return applyAssetMove(state, rng, intent);
    case 'assetT2T': {
      const at2t = intent.assetId && (state.launchedAssets || []).find(a => a.id === intent.assetId);
      if (at2t) { at2t.moved = false; at2t.t2t = true; at2t._t2tRange = 6; }
      return state;
    }
    case 'selectAssetMove': {
      if (!intent.assetId) { state.assetMove = null; return state; }
      const selA = (state.launchedAssets || []).find(a => a.id === intent.assetId);
      if (selA && state.assetPhase && state.assetPhase.step === 'assets') {
        state.assetMove = { id: intent.assetId, count: intent.count || selA.count };
      }
      return state;
    }
    case 'assetLockTarget': {
      const alck = intent.assetId && (state.launchedAssets || []).find(a => a.id === intent.assetId);
      if (alck) { alck.bomberTarget = { gid: intent.gid, si: intent.si }; }
      return state;
    }
    case 'assetUntarget': {
      const aut = intent.assetId && (state.launchedAssets || []).find(a => a.id === intent.assetId);
      if (aut) { aut.bomberTarget = null; }
      return state;
    }
    case 'assetResetMove': {
      const arm = intent.assetId && (state.launchedAssets || []).find(a => a.id === intent.assetId);
      if (arm) {
        if (arm._preMove) { arm.x = arm._preMove.x; arm.y = arm._preMove.y; arm._t2tRange = arm._preMove.t2tRange; arm._preMove = null; }
        arm.moved = false; arm.bomberTarget = null;
      }
      return state;
    }
    case 'daDestroyFeature': {
      const dds = state.scenarioData && state.scenarioData.dropsites && state.scenarioData.dropsites.find(d => d.id === intent.dsId);
      if (dds) { dds.destroyedFeatures = dds.destroyedFeatures || []; if (!dds.destroyedFeatures.includes(intent.fi)) dds.destroyedFeatures.push(intent.fi); }
      return state;
    }
    case 'deployDone': {
      state.deployDone = state.deployDone || { player1: false, player2: false };
      if (intent.side) state.deployDone[intent.side] = true;
      // Advance to play once every side that actually has ships to deploy is done.
      const _p1Done = !sideNeedsDeployPhase(state, 'player1') || state.deployDone.player1;
      const _p2Done = !sideNeedsDeployPhase(state, 'player2') || state.deployDone.player2;
      if (_p1Done && _p2Done) applyBeginPlay(state, rng);
      return state;
    }
    case 'setNomination': {
      const { side: nomSide, key: nomKey, nom } = intent;
      if (!state.secondaryNominations) state.secondaryNominations = { player1: {}, player2: {} };
      if (!state.secondaryNominations[nomSide]) state.secondaryNominations[nomSide] = {};
      state.secondaryNominations[nomSide][nomKey] = nom;
      return state;
    }
    case 'confirmNominations': {
      state.nominationsReady = state.nominationsReady || { player1: false, player2: false };
      if (intent.side) state.nominationsReady[intent.side] = true;
      if (!state.nominationsReady.player1 || !state.nominationsReady.player2) return state;
      // Both sides confirmed — advance.
      state.nominationPhase = false;
      if (objAny(state, 'protect')) {
        state.protectNomReady = { player1: false, player2: false };
        state.phase = 'protect';
      } else if (anyoneNeedsDeployPhase(state)) {
        state.deployDone = state.deployDone || { player1: false, player2: false };
        state.phase = 'deploy';
      } else {
        state.phase = 'play';
        rollInitiative(state, rng);
      }
      return state;
    }
    case 'setProtectNom':
      if (!state.protectNom) state.protectNom = { player1: null, player2: null };
      if (intent.side && intent.dsId !== undefined) state.protectNom[intent.side] = intent.dsId;
      return state;
    case 'confirmProtectNom': {
      state.protectNomReady = state.protectNomReady || { player1: false, player2: false };
      if (intent.side) state.protectNomReady[intent.side] = true;
      // Only sides whose Objective is Protect need to nominate (asymmetric-safe).
      const protectSides = ['player1','player2'].filter(s => objectiveForSide(state, s) === 'protect');
      if (protectSides.some(s => !state.protectNomReady[s])) return state;
      // Both confirmed — advance to deploy or play.
      if (anyoneNeedsDeployPhase(state)) {
        state.deployDone = state.deployDone || { player1: false, player2: false };
        state.phase = 'deploy';
      } else {
        state.phase = 'play';
        rollInitiative(state, rng);
      }
      return state;
    }
    case 'adjustAP': {
      const { side: tSide, delta } = intent;
      if (!state.planning) return state;
      const old = state.planning.ap[tSide] || 0;
      state.planning.ap[tSide] = Math.max(0, old + delta);
      logEvent(state, `AP ${delta > 0 ? '+' : ''}${delta} → ${state.planning.ap[tSide]}`);
      return state;
    }
    case 'adjustSpike': {
      const { gid, delta } = intent;
      const grp = state.groups[gid];
      const newVal = Math.min(4, Math.max(0, (grp.spikes || 0) + delta));
      grp.spikes = newVal;
      const def = grp.def || {};
      logEvent(state, `${def.name || gid} spike ${delta > 0 ? '+1' : '−1'} → ${newVal}`);
      return state;
    }
    case 'adjustOrbitalDecay': {
      const { gid: odGid, si: odSi, delta: odDelta } = intent;
      const odGrp = state.groups[odGid];
      if (!odGrp) return state;
      const odShip = odGrp.ships[odSi];
      if (!odShip || odShip.destroyed) return state;
      odShip.orbitalDecayTokens = Math.max(0, (odShip.orbitalDecayTokens || 0) + odDelta);
      const odDef = getDef(state, odGid);
      logEvent(state, `${odDef ? odDef.name : odGid}: Orbital Decay ${odDelta > 0 ? '+1' : '−1'} → ${odShip.orbitalDecayTokens} token${odShip.orbitalDecayTokens !== 1 ? 's' : ''}`);
      return state;
    }
    case 'adjustHull': {
      const { gid, si, delta } = intent;
      const grp = state.groups[gid];
      const ship = grp.ships[si];
      const newHull = Math.min(ship.maxHull, Math.max(0, ship.hull + delta));
      ship.hull = newHull;
      if (newHull <= 0) ship.destroyed = true;
      else if (ship.destroyed && newHull > 0) ship.destroyed = false;
      if (grp.leadShipIdx != null && grp.ships[grp.leadShipIdx] && grp.ships[grp.leadShipIdx].destroyed) {
        grp.leadShipIdx = null;
      }
      const def = grp.def || {};
      logEvent(state, `${def.name || gid} #${si + 1} HP ${delta > 0 ? '+1' : '−1'} → ${newHull}/${ship.maxHull}${ship.destroyed ? ' (destroyed)' : ''}`);
      return state;
    }
    case 'assessDropsite': {
      const { gid: asGid, si: asSi, dsId: asDsId } = intent;
      const asDef = getDef(state, asGid);
      if (!asDef) return state;
      const asSide = asDef.side;
      state.assessedDropsites = state.assessedDropsites || { player1: [], player2: [] };
      state.assessedDropsites[asSide] = state.assessedDropsites[asSide] || [];
      if (!state.assessedDropsites[asSide].includes(asDsId)) {
        state.assessedDropsites[asSide].push(asDsId);
        const asDs = state.scenarioData?.dropsites?.find(d => d.id === asDsId);
        const asDsName = asDs?.base?.name || asDsId;
        const asZone = state.deployZone && state.deployZone[asSide];
        const asSr = asDs?.siteRules || [];
        const asVp = (asZone && asSr.includes(`double_assess_${asZone}`)) ? 2 : 1;
        awardVP(state, asSide, asVp, `Assess: ${asDsName}${asVp > 1 ? ' ×2' : ''}`, state.round);
        logEvent(state, `${asDef.name} assessed ${asDsName}`);
      }
      const asShip = state.groups[asGid].ships[asSi];
      asShip.firedThisActivation = true;
      asShip.hasAssessed = true;
      return state;
    }
    case 'surveySite': {
      const { gid: svGid, si: svSi, dsId: svDsId } = intent;
      const svGrp = state.groups[svGid];
      const svDef = getDef(state, svGid);
      const svShip = svGrp && svGrp.ships[svSi];
      const svDs = svDsId && state.scenarioData?.dropsites?.find(d => d.id === svDsId);
      if (!svGrp || !svDef || !svShip || !svDs) return state;
      svDs.surveyedBy = svDs.surveyedBy || [];
      if (!svDs.surveyedBy.includes(svDef.side)) svDs.surveyedBy.push(svDef.side);
      svShip.firedThisActivation = true; // forgo attacking/launching
      logEvent(state, `${svDef.name} surveyed ${svDs.base?.name || svDsId}`, 'ground');
      return state;
    }
    case 'objectivesFlyoff':
    case 'breakthroughFlyoff':
      return state; // client handles these mutations; intent authorises the relay
    default: throw new Error(`apply: unknown intent type "${intent && intent.type}"`);
  }
}
