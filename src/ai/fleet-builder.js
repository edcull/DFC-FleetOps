// AI fleet builder.
// buildAiFleet(opts) — full constraint-guided random builder.
// buildAiFleet(factionString) — legacy form, falls back to fastplay list.
//
// Constraints enforced (Dropfleet Commander Rulebook v2.3.1 §4.2):
//   Heavy pts ≤ Medium pts (points-ratio rule)
//   Colossal groups: 0 / 1 / 2 / 3 by game size
//   Rare groups per name: 1 / 2 / 3 / 4 by game size
//   Unique groups per name: max 1
//   Total pts in [0.97 × targetPts, targetPts]

import { FLEET_DB } from '../fleet/db.js';
import { FASTPLAY_LISTS } from '../fleet/fastplay/index.js';
import { parseNewRecruit } from '../fleet/parser.js';

// ── Game size helpers ─────────────────────────────────────────────────────────

function gameSize(pts) {
  if (pts <= 1000) return 'skirmish';
  if (pts <= 2000) return 'clash';
  if (pts <= 3000) return 'battle';
  return 'reconquest';
}

const COLOSSAL_LIMIT = { skirmish: 0, clash: 1, battle: 2, reconquest: 3 };
const RARE_LIMIT     = { skirmish: 1, clash: 2, battle: 3, reconquest: 4 };
const ADMIRAL_PTS    = { 2: 20, 3: 40, 4: 60, 5: 80 };

// ── Ship predicates ───────────────────────────────────────────────────────────

function isFamousAdmiral(def) { return /Famous\s+Admiral/i.test(def.special || ''); }
function isRare(def)          { return /\bRare\b/i.test(def.special || ''); }
function isUnique(def)        { return /\bUnique\b/i.test(def.special || ''); }

function hasDrop(def) {
  return (def.launch || []).some(l =>
    l.type === 'bulk_lander' || l.type === 'dropship' || l.type === 'gate_dropship' || l.type === 'drop_pod'
  );
}

// ── Personality scoring ───────────────────────────────────────────────────────

function shipScore(def, personality) {
  const attack   = (def.weapons || []).reduce((s, w) => s + (w.att || 0), 0);
  const dropBonus = hasDrop(def) ? 8 : 0;
  const heavyBonus = (def.tonnage === 'H' || def.tonnage === 'C') ? 4 : 0;
  switch (personality) {
    case 'aggressive':
    case 'opportunist':
      return attack * 1.5 + heavyBonus + dropBonus * 0.3;
    case 'positional':
      return dropBonus * 4.0 + attack * 0.3 + (def.vanguard ? 3 : 0);
    case 'defensive':
      return (def.hull || 0) * 0.5 - (def.sig || 0) * 0.2 + dropBonus * 0.5;
    default: // balanced
      return attack * 0.8 + dropBonus * 2.5 + (def.hull || 0) * 0.15;
  }
}

// Weighted random pick from the top-N items in a sorted array.
function weightedPick(sorted, topN) {
  const pool = sorted.slice(0, Math.min(topN, sorted.length));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

// ── Tactics generation ────────────────────────────────────────────────────────

function generateTactics(groups) {
  const tactics = [];
  const allDefs = groups.map(g => g._def).filter(Boolean);

  const hasVanguard  = allDefs.some(d => d.vanguard);
  const hasHeavy     = groups.some(g => g.tonnage === 'H' || g.tonnage === 'C');
  const hasFighters  = allDefs.some(d => (d.launch || []).some(l => l.type === 'fighter_bomber'));
  const hasBombers   = allDefs.some(d => (d.launch || []).some(l => l.type === 'bomber'));
  const hasTorpedo   = allDefs.some(d => (d.launch || []).some(l => l.type === 'torpedo'));
  const hasDetector  = allDefs.some(d => /Detector/i.test(d.special || ''));
  const hasCommand   = allDefs.some(d => /Command Ship/i.test(d.special || ''));
  const hasAegis     = allDefs.some(d => /Aegis/i.test(d.special || ''));
  const hasBombard   = allDefs.some(d => (d.weapons || []).some(w => /Bombardment/i.test(w.special || '')));

  const groupCostFn = g => g.pts * (g.count || 1);
  const totalPts = groups.reduce((s, g) => s + groupCostFn(g), 0);
  const dropPts  = groups.filter(g => hasDrop(g._def)).reduce((s, g) => s + groupCostFn(g), 0);
  const dropPct  = totalPts > 0 ? dropPts / totalPts : 0;

  const closeActionCount = allDefs.reduce((n, d) =>
    n + (d.weapons || []).filter(w => /Close Action/i.test(w.special || '')).length, 0);
  const totalWeapons = allDefs.reduce((n, d) => n + (d.weapons || []).length, 0);
  const isCAHeavy = totalWeapons > 0 && closeActionCount / totalWeapons > 0.5;

  const lowSigLights = groups.filter(g => g.tonnage === 'L' && (g._def?.sig || 0) <= 2).length;

  if (hasVanguard)    tactics.push('Vanguard ships available — use early board presence to contest dropsites before the opponent settles');
  if (hasHeavy)       tactics.push('Heavy/Colossal flagship present — protect it; it is the prime focus-fire target');
  if (dropPct > 0.35) tactics.push('Drop-heavy roster — prioritise landing battalions early; fleet is built around ground control');
  else if (dropPct < 0.15) tactics.push('Limited drop capacity — choose dropsites carefully; cannot contest all objectives');
  if (hasFighters || hasBombers) tactics.push('Fighter/bomber wings available — screen against incoming bombers and threaten crippled targets');
  if (lowSigLights >= 2) tactics.push('Low-signature light elements — Silent Running can neutralise targeting; exploit approach lanes');
  if (hasCommand)     tactics.push('Command Ship in fleet — maintain AP generation; prioritise its survival above most other groups');
  if (hasDetector)    tactics.push('Detector available — use it early to spike high-value enemy targets and open them to long-range fire');
  if (hasBombard)     tactics.push('Bombardment capable — engage dropsites from distance; deny enemy battalion build-up without close approach');
  if (isCAHeavy)      tactics.push('Close-Action-heavy fleet — closing range is essential; plan approaches that survive the initial exchange');
  if (hasTorpedo)     tactics.push('Torpedo complement — use them to threaten or finish off crippled heavy targets');
  if (hasAegis)       tactics.push('Aegis ships present — cluster near carriers and Capital Ships to provide anti-wing screening');

  return tactics.slice(0, 6);
}

// ── Full constraint-guided builder ────────────────────────────────────────────

function buildFull({ faction, targetPts, admiralLevel = 0, personality = 'balanced' }) {
  const db = FLEET_DB[faction];
  if (!db) return null;

  const size   = gameSize(targetPts);
  const cLimit = COLOSSAL_LIMIT[size];
  const rLimit = RARE_LIMIT[size];

  // Admiral pts reserved from the budget.
  const admPts = (admiralLevel >= 2 && ADMIRAL_PTS[admiralLevel]) ? ADMIRAL_PTS[admiralLevel] : 0;
  const groupBudget = targetPts - admPts;

  // Candidates: exclude Famous Admirals.
  const candidates = Object.entries(db)
    .filter(([, def]) => !isFamousAdmiral(def))
    .map(([name, def]) => ({ name, def }))
    .sort((a, b) => shipScore(b.def, personality) - shipScore(a.def, personality));

  const byTonnage = t => candidates.filter(s => s.def.tonnage === t);
  const mSorted = byTonnage('M');
  const hSorted = byTonnage('H');
  const lSorted = byTonnage('L');
  const cSorted = cLimit > 0 ? byTonnage('C') : [];

  for (let attempt = 0; attempt < 25; attempt++) {
    const groups = [];         // internal: { name, count, pts, options, tonnage, _def }
    const rareCount  = {};
    const uniqueSet  = new Set();
    let totalPts  = 0;
    let mediumPts = 0;
    let heavyPts  = 0;

    // def.pts is per-ship; total group cost = def.pts * groupSize.
    const groupCost = def => def.pts * (def.groupSize || 1);

    function fits(name, def) {
      if (groupCost(def) > groupBudget - totalPts) return false;
      if (isUnique(def) && uniqueSet.has(name)) return false;
      if (isRare(def) && (rareCount[name] || 0) >= rLimit) return false;
      if (def.tonnage === 'H' && heavyPts + groupCost(def) > mediumPts) return false;
      if (def.tonnage === 'C') {
        if (cLimit === 0) return false;
        if (groups.filter(g => g.tonnage === 'C').length >= cLimit) return false;
      }
      return true;
    }

    function add(name, def) {
      const cost = groupCost(def);
      groups.push({ name, count: def.groupSize || 1, pts: def.pts, options: [], tonnage: def.tonnage, _def: def });
      totalPts += cost;
      if (def.tonnage === 'M') mediumPts += cost;
      if (def.tonnage === 'H') heavyPts  += cost;
      if (isUnique(def)) uniqueSet.add(name);
      if (isRare(def))   rareCount[name] = (rareCount[name] || 0) + 1;
    }

    // 1. Medium backbone: 2–3 groups picked from top-6 by score.
    const mPool = [...mSorted];
    const numMedium = 2 + Math.floor(Math.random() * 2); // 2 or 3
    for (let i = 0; i < numMedium && mPool.length; i++) {
      const eligible = mPool.filter(s => fits(s.name, s.def));
      if (!eligible.length) break;
      const pick = weightedPick(eligible, 6);
      if (!pick) break;
      add(pick.name, pick.def);
      mPool.splice(mPool.indexOf(pick), 1);
    }

    // 2. Optional Heavy group (aggressive/opportunist or Battle+, not Skirmish).
    if (size !== 'skirmish' && hSorted.length) {
      const wantsHeavy = personality === 'aggressive' || personality === 'opportunist'
        || size === 'battle' || size === 'reconquest';
      if (wantsHeavy || Math.random() < 0.35) {
        const eligible = hSorted.filter(s => fits(s.name, s.def));
        const pick = eligible.length ? weightedPick(eligible, 4) : null;
        if (pick) add(pick.name, pick.def);
      }
    }

    // 3. Optional Colossal group (Battle+ only, not Skirmish/Clash unless wantsHeavy).
    if (cLimit > 0 && cSorted.length && (size === 'battle' || size === 'reconquest')) {
      if (Math.random() < 0.45) {
        const eligible = cSorted.filter(s => fits(s.name, s.def));
        const pick = eligible.length ? weightedPick(eligible, 2) : null;
        if (pick) add(pick.name, pick.def);
      }
    }

    // 4. Fill remaining budget with L and M groups.
    // When drop% is below target and personality cares about objectives, prefer drop-capable ships.
    // Positional/balanced aim for 35%; aggressive/defensive still want some drop capability at 20%.
    const wantsDrop = true;
    const DROP_TARGET = (personality === 'positional') ? 0.40
                      : (personality === 'balanced')   ? 0.35
                      : 0.30;

    const fillPool = [...lSorted, ...mSorted];
    let guard = 60;
    while (guard-- > 0) {
      const remaining = groupBudget - totalPts;
      if (remaining <= 0) break;

      const eligible = fillPool.filter(s => fits(s.name, s.def) && groupCost(s.def) <= remaining);
      if (!eligible.length) break;

      // If we're short on drop capability, strongly prefer drop-capable ships.
      const dropPts = groups.filter(g => hasDrop(g._def)).reduce((s, g) => s + groupCost(g._def), 0);
      const dropPct = totalPts > 0 ? dropPts / totalPts : 0;
      let pool = eligible;
      if (wantsDrop && dropPct < DROP_TARGET) {
        const dropEligible = eligible.filter(s => hasDrop(s.def));
        if (dropEligible.length) pool = dropEligible; // force drop ship this iteration
      }

      const pick = weightedPick(pool, 8);
      if (!pick) break;
      add(pick.name, pick.def);
    }

    // 5. Validate.
    const minPts = targetPts * 0.97;
    const finalPts = totalPts + admPts;
    if (finalPts < minPts || finalPts > targetPts) continue; // retry

    const tactics   = generateTactics(groups);
    const finalGroups = groups.map(({ name, count, pts, options }) => ({ name, count, pts, options }));

    return {
      faction,
      groups: finalGroups,
      admiralLevel,
      totalPts: finalPts,
      tactics,
      validation: {
        valid: true,
        totalPts: finalPts,
        targetPts,
        pctUsed: +(finalPts / targetPts).toFixed(3),
        hGroups: groups.filter(g => g.tonnage === 'H').length,
        cGroups: groups.filter(g => g.tonnage === 'C').length,
        rareNames: Object.keys(rareCount),
        uniqueNames: [...uniqueSet],
        warnings: [],
      },
    };
  }

  return null; // all attempts failed
}

// ── Fastplay fallback ─────────────────────────────────────────────────────────

function buildFromFastplay(faction) {
  const listText = FASTPLAY_LISTS[faction];
  if (!listText) return null;
  const parsed = parseNewRecruit(listText);
  if (!parsed || !parsed.valid || !parsed.groups?.length) return null;
  return {
    faction: parsed.faction || faction,
    groups: parsed.groups,
    admirals: parsed.admirals || [],
    admiralLevel: parsed.admiralLevel || 0,
    secondaries: parsed.secondaries || [],
  };
}

// ── Public export ─────────────────────────────────────────────────────────────

/**
 * Build a fleet for the AI opponent.
 *
 * Accepts either:
 *   buildAiFleet('ucm')                          — legacy: returns fastplay list
 *   buildAiFleet({ faction, targetPts, ... })    — full constraint-guided builder
 *
 * Returns an importedFleets-compatible object, or null on failure.
 * Falls back to the fastplay list if the guided builder exhausts its retries.
 */
export function buildAiFleet(factionOrOpts) {
  if (!factionOrOpts) return null;

  // Legacy string call: no pts budget → use fastplay list.
  if (typeof factionOrOpts === 'string') {
    return buildFromFastplay(factionOrOpts);
  }

  const { faction, targetPts, admiralLevel = 0, personality = 'balanced' } = factionOrOpts;
  if (!faction) return null;

  // No target pts → fastplay fallback.
  if (!targetPts || targetPts <= 0) return buildFromFastplay(faction);

  const result = buildFull({ faction, targetPts, admiralLevel, personality });
  if (result) return result;

  console.warn(`[AI/Fleet] builder failed after 25 attempts for ${faction}@${targetPts}pts — using fastplay`);
  return buildFromFastplay(faction);
}
