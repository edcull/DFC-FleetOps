// Converts game state to a compact text briefing (~400–600 tokens) for the LLM.

import { INCH } from '../engine/constants.js';
import { dropsiteController, dropsiteContested, dsSideBattalions } from '../engine/mutators.js';

const BOARD_PX = 48 * INCH;

const QUADRANT_LABELS = [
  ['NW','N','NE'],
  ['W', 'C', 'E'],
  ['SW','S','SE'],
];

function quadrant(px) {
  const col = Math.min(2, Math.floor((px / (48 * INCH)) * 3));
  return col;
}

function quadLabel(xPx, yPx) {
  const col = quadrant(xPx);
  const row = quadrant(yPx);
  return QUADRANT_LABELS[row][col];
}

function distToZone(state, side, yPx) {
  const zone = state.deployZone?.[side] || 'south';
  const zoneY = zone === 'south' ? 48 * INCH : 0;
  return Math.round(Math.abs(yPx - zoneY) / INCH);
}

function formatShipLine(name, def, ships, aiSide, state) {
  const alive = ships.filter(s => !s.destroyed && !s.offTable);
  if (!alive.length) return null;
  const lead = alive[0];
  const totalHull = alive.reduce((s, sh) => s + sh.hull, 0);
  const maxHull  = alive.reduce((s, sh) => s + (sh.maxHull || def.hull || 1), 0);
  const hpStr = totalHull < maxHull ? `${totalHull}/${maxHull}HP` : `${maxHull}HP`;
  const quad = quadLabel(lead.x, lead.y);
  const layer = lead.layer === 'atmosphere' ? 'Atmo' : 'Orbit';
  const order = lead.order || '—';
  const count = alive.length > 1 ? ` ×${alive.length}` : '';
  return `  ${name}${count}  [${def.tonnage}]  ${hpStr}  ${layer} ${quad}  ${order}`;
}

function formatDropsite(ds, state, aiSide) {
  const ctrl = dropsiteController(ds);
  const contested = dropsiteContested(ds);
  const ctrlStr = contested ? 'CONTESTED' : (ctrl ? ctrl.toUpperCase() + ' controlled' : 'UNCONTROLLED');
  const aiBat = dsSideBattalions(ds, aiSide);
  const humBat = dsSideBattalions(ds, aiSide === 'player1' ? 'player2' : 'player1');
  const batStr = (aiBat > 0 || humBat > 0) ? `  AI:${aiBat} / Opp:${humBat} bat` : '';
  const sizeMap = { S: 'Small', M: 'Med', L: 'Large' };
  const size = sizeMap[ds.base?.size] || ds.base?.size || '?';
  return `  ${ds.base?.name || ds.id}  [${size}]  ${ctrlStr}${batStr}`;
}

// Capabilities are now embedded in buildStateBriefing. This stub is kept for
// compatibility with the activation handler call site.
export function buildGroupCapabilities(state, aiSide) {
  return '';
  const enemySide = aiSide === 'player1' ? 'player2' : 'player1';
  const dropsites  = state.scenarioData?.dropsites || [];
  const LAUNCH_RANGE = { dropship: 3, bulk_lander: 6, drop_pod: 6 };

  function pxToIn(px) { return +(px / INCH).toFixed(1); }
  function dist(ax, ay, bx, by) { return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2); }
  function coord(xPx, yPx) { return `(${pxToIn(xPx)},${pxToIn(yPx)})`; }

  const lines = [];

  // ── Map targets with coordinates ──────────────────────────────────────────
  lines.push('MAP TARGETS (all positions in inches on the 48×48" board):');
  for (const ds of dropsites) {
    if (ds.destroyed) continue;
    const ctrl = dropsiteController(ds);
    const ctrlStr = ctrl === aiSide ? 'OURS' : ctrl ? 'ENEMY' : 'FREE';
    const aiBat = dsSideBattalions(ds, aiSide);
    const oppBat = dsSideBattalions(ds, enemySide);
    const layer = ds.base?.layer === 'Atmosphere' ? 'Atmo' : 'Orbit';
    lines.push(`  ${ds.base?.name || ds.id} at (${ds.x},${ds.y}) [${layer}] ${ctrlStr} AI:${aiBat}/Opp:${oppBat} bat`);
  }
  for (const [, eg] of Object.entries(state.groups)) {
    if (eg.def?.side !== enemySide) continue;
    const alive = eg.ships.filter(s => !s.destroyed && !s.offTable);
    if (!alive.length) continue;
    const lead = alive[0];
    const hp = alive.reduce((s, sh) => s + sh.hull, 0);
    const maxHp = alive.reduce((s, sh) => s + (sh.maxHull || eg.def?.hull || 1), 0);
    const hpStr = hp < maxHp ? `${hp}/${maxHp}HP` : `${maxHp}HP`;
    const sigStr = eg.def?.sig != null ? ` sig:${eg.def.sig}"` : '';
    lines.push(`  ${eg.def?.name} at ${coord(lead.x, lead.y)} [${eg.def?.tonnage}] ${hpStr}${sigStr}`);
  }

  // ── Unactivated AI groups with capabilities ────────────────────────────────
  lines.push('UNACTIVATED AI GROUPS:');
  for (const [, grp] of Object.entries(state.groups)) {
    const def = grp.def;
    if (def?.side !== aiSide || grp.activated) continue;
    const alive = grp.ships.filter(s => !s.destroyed && !s.offTable);
    const offTable = grp.ships.filter(s => !s.destroyed && s.offTable);
    if (!alive.length && !offTable.length) continue;

    const ships = alive.length ? alive : offTable;
    const lead = ships[0];
    // Off-table ships have correct maxHull but hull may not reflect current state.
    const allShips = grp.ships.filter(s => !s.destroyed);
    const hp    = alive.reduce((s, sh) => s + sh.hull, 0);
    const maxHp = allShips.reduce((s, sh) => s + (sh.maxHull || def.hull || 1), 0);
    const hpStr = !alive.length ? `${maxHp}HP (off-table)` : hp < maxHp ? `${hp}/${maxHp}HP` : `${maxHp}HP`;
    const count  = ships.length > 1 ? ` ×${ships.length}` : '';
    const layer  = lead.layer === 'atmosphere' ? 'Atmo' : 'Orbit';
    const posStr = alive.length ? ` pos:${coord(lead.x, lead.y)}` : ' OFF-TABLE';
    const status = offTable.length ? '' : hp < maxHp * 0.5 ? ' CRIPPLED' : hp < maxHp ? ' DAMAGED' : '';
    const spikes = grp.spikes > 0 ? ` ${grp.spikes}spikes` : '';

    const scan = def.scan ?? 6;
    const weps = (def.weapons || []).map(w => {
      const isCA = /Close Action/i.test(w.special || '');
      return `${w.att}att ${w.lock}${isCA ? `(CA range:${scan}")` : ''}`;
    }).join(', ');

    // Launch capabilities — all asset types
    const launchParts = [];
    (def.launch || []).forEach(l => {
      switch (l.type) {
        case 'bulk_lander': {
          // 6" range, any orbital layer
          const rangePx = (6 + 8) * INCH;
          const reachable = alive.length
            ? dropsites.filter(ds => !ds.destroyed && dist(lead.x, lead.y, ds.x * INCH, ds.y * INCH) <= rangePx)
                .sort((a, b) => dist(lead.x, lead.y, a.x * INCH, a.y * INCH) - dist(lead.x, lead.y, b.x * INCH, b.y * INCH))
                .slice(0, 3).map(ds => `${ds.base?.name || ds.id}(${ds.x},${ds.y})`)
            : dropsites.filter(d => !d.destroyed).slice(0, 3).map(ds => `${ds.base?.name || ds.id}(${ds.x},${ds.y})`);
          launchParts.push(`${l.n}× Bulk Lander (range 6", any layer${reachable.length ? ` → ${reachable.join(', ')}` : ''})`);
          break;
        }
        case 'dropship':
        case 'drop_pod': {
          // 3" range, must match dropsite layer
          const rangePx = (3 + 8) * INCH;
          const reachable = alive.length
            ? dropsites.filter(ds => !ds.destroyed && dist(lead.x, lead.y, ds.x * INCH, ds.y * INCH) <= rangePx)
                .slice(0, 3).map(ds => `${ds.base?.name || ds.id}(${ds.x},${ds.y})`)
            : [];
          launchParts.push(`${l.n}× Dropship (range 3", same layer${reachable.length ? ` → ${reachable.join(', ')}` : ''})`);
          break;
        }
        case 'fighter_bomber':
          launchParts.push(`${l.n}× Fighter/Bomber per round (air cover & attack)`);
          break;
        case 'bomber':
          launchParts.push(`${l.n}× Heavy Bomber per round (anti-ship strikes)`);
          break;
        case 'torpedo':
        case 'light_torpedo':
        case 'medium_torpedo':
        case 'heavy_torpedo': {
          const label = l.type === 'torpedo' ? 'Torpedo' : l.type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
          launchParts.push(`${l.n}× ${label} (targeted at enemy ships)`);
          break;
        }
        case 'boarding_pod':
          launchParts.push(`${l.n}× Boarding Pod (assault enemy ships)`);
          break;
        case 'mine':
          launchParts.push(`${l.n}× Mine (area denial)`);
          break;
        default:
          launchParts.push(`${l.n}× ${l.type.replace(/_/g, ' ')}`);
      }
    });

    // Nearest on-table enemies with range assessment
    const enemyLines = [];
    for (const [, eg] of Object.entries(state.groups)) {
      if (eg.def?.side !== enemySide) continue;
      for (const es of eg.ships) {
        if (es.destroyed || es.offTable) continue;
        const d = Math.round(dist(lead.x || 0, lead.y || 0, es.x, es.y) / INCH);
        const targetSig = eg.def?.sig ?? 3;
        const stdRange = scan + targetSig;
        const caRange  = scan;
        const inStdRange = d <= stdRange + 8;  // +8" for one activation's move
        const inCARange  = d <= caRange + 8;
        const rangeNote = d <= stdRange ? `IN RANGE(${stdRange}")` :
          inStdRange ? `in range after move(${stdRange}")` :
          `out of range(max ${stdRange}")`;
        enemyLines.push(`${eg.def.name} ${coord(es.x, es.y)} sig:${targetSig}" dist:${d}" — ${rangeNote}`);
      }
    }
    const enemyStr = enemyLines.length ? enemyLines.slice(0, 3).join('; ') : '';

    let line = `  ${def.name}${count} [${def.tonnage}]${posStr}${status}${spikes} ${hpStr} ${layer} scan:${scan}"`;
    if (weps)           line += ` | Wpn: ${weps}`;
    if (launchParts.length) line += ` | Launch: ${launchParts.join('; ')}`;
    if (enemyStr)       line += ` | Enemies: ${enemyStr}`;
    lines.push(line);
  }

  return lines.join('\n');
}

// Order max-move fractions (multiplier on ship thrust)
const ORDER_MOVE = { GQ: 1, WF: 1, SR: 1, CC: 0.5, MT: 2, DC: 0.5 };
const ORDER_CAN_FIRE  = { GQ: 'half', WF: 'all', SR: 'none', CC: 'one', MT: 'none', DC: 'one-CA' };
const ORDER_CAN_LAUNCH = { GQ: true, WF: true, SR: false, CC: true, MT: false, DC: false };
// gate_dropship uses -1 as a sentinel — range is determined by Voidgate proximity, not ship-to-DS distance
const LAUNCH_RANGE_IN = { dropship: 3, bulk_lander: 6, drop_pod: 6, gate_dropship: -1 };
function isDropLaunch(type) { return LAUNCH_RANGE_IN[type] !== undefined || type === 'gate_dropship'; }

// Single comprehensive briefing — state + per-ship capabilities, no redundancy.
export function buildStateBriefing(state, aiSide) {
  const humanSide = aiSide === 'player1' ? 'player2' : 'player1';
  const aiSlot    = aiSide    === 'player1' ? 'f1' : 'f2';
  const humSlot   = humanSide === 'player1' ? 'f1' : 'f2';

  const shipReconOps = state.shipReconOps || {};
  const aiFaction  = (state.factions?.[aiSide]    || state.fleetChoices?.[aiSlot]  || '?').toUpperCase();
  const humFaction = (state.factions?.[humanSide]  || state.fleetChoices?.[humSlot] || '?').toUpperCase();
  const aiName     = state.playerNames?.[aiSlot]   || 'AI';
  const aiVp  = state.score?.[aiSide]?.vp    ?? 0;
  const humVp = state.score?.[humanSide]?.vp ?? 0;
  const aiKp  = state.score?.[aiSide]?.kp    ?? 0;
  const humKp = state.score?.[humanSide]?.kp ?? 0;

  const aiZone   = state.deployZone?.[aiSide]    || 'south';
  const humZone  = state.deployZone?.[humanSide] || 'north';
  const aiEdgeY  = aiZone  === 'south' ? 47 : 1;
  const humEdgeY = humZone === 'south' ? 47 : 1;

  const dropsites  = state.scenarioData?.dropsites || [];
  const objKey     = state.scenario?.objective || '';
  const secs       = (state.secondaries?.[aiSide] || []).join(', ');
  const LAUNCH_RANGE = { dropship: 3, bulk_lander: 6, drop_pod: 6 };

  function px(n) { return +(n / INCH).toFixed(1); }
  function co(x, y) { return `(${px(x)},${px(y)})`; }
  function d(ax, ay, bx, by) { return Math.round(Math.hypot(ax - bx, ay - by) / INCH); }

  // ── Stable short IDs ──────────────────────────────────────────────────────
  // Dropsites: DS1, DS2, ... (by array index, stable across parser + mapper)
  // AI ships:  A1, A2, ...  (unactivated first, then activated)
  // Enemy ships: E1, E2, ... (on-table groups in insertion order)
  const dsIds = {};
  dropsites.filter(ds => !ds.destroyed).forEach((ds, i) => { dsIds[ds.id] = `DS${i + 1}`; });

  const aiGroups  = Object.entries(state.groups).filter(([, g]) => g.def?.side === aiSide);
  const aiIds = {};
  aiGroups.forEach(([gid], i) => { aiIds[gid] = `A${i + 1}`; });

  const humGroups = Object.entries(state.groups).filter(([, g]) => g.def?.side === humanSide);
  const humIds = {};
  humGroups.forEach(([gid], i) => { humIds[gid] = `E${i + 1}`; });

  const L = [];

  // ── Header ────────────────────────────────────────────────────────────────
  L.push(`=== DROPFLEET COMMANDER Round ${state.round || 1}/6 · Objective: ${objKey.toUpperCase() || 'UNKNOWN'} ===`);
  L.push(`You (${aiFaction}): VP ${aiVp} KP ${aiKp} | Opponent (${humFaction}): VP ${humVp} KP ${humKp}`);
  L.push(`Your edge: ${aiZone.toUpperCase()} y=${aiEdgeY}" | Opponent edge: ${humZone.toUpperCase()} y=${humEdgeY}"`);
  if (secs) L.push(`Your secondaries: ${secs}`);

  // ── Positions (all coordinates in one compact block) ──────────────────────
  L.push('\nPOSITIONS (x,y in inches, 48×48" board):');
  if (dropsites.length) {
    const dsArr = dropsites.filter(ds => !ds.destroyed).map(ds => {
      const layer = ds.base?.layer === 'Atmosphere' ? 'Atmo' : 'Orbit';
      const ctrl  = dropsiteController(ds);
      const tag   = ctrl === aiSide ? 'OURS' : ctrl ? 'ENEMY' : 'free';
      return `${dsIds[ds.id]}:${ds.base?.name || ds.id}(${ds.x},${ds.y})[${layer},${tag}]`;
    });
    L.push(`  Dropsites: ${dsArr.join('  ')}`);
  }
  const yourPos = aiGroups.map(([gid, g]) => {
    const alive  = g.ships.filter(s => !s.destroyed && !s.offTable);
    const lead   = alive[0];
    const id     = aiIds[gid];
    const isDrop = (g.def?.launch || []).some(l => isDropLaunch(l.type)) || g.def?.gateship > 0;
    const reconAboard = g.ships.reduce((s, sh, si) => s + (shipReconOps[g.def?.id + '#' + si] || 0), 0);
    const dtag   = isDrop ? '[DROP]' : '';
    const rtag   = reconAboard > 0 ? `[RECON:${reconAboard}]` : '';
    return alive.length
      ? `${id}:${g.def?.name}${dtag}${rtag}${co(lead.x, lead.y)}${g.activated ? '✓' : ''}`
      : `${id}:${g.def?.name}${dtag}${rtag}(off)`;
  });
  L.push(`  Yours:    ${yourPos.join('  ')}`);
  const humPos = humGroups.map(([gid, g]) => {
    const alive   = g.ships.filter(s => !s.destroyed && !s.offTable);
    const lead    = alive[0];
    const id      = humIds[gid];
    const isDrop  = (g.def?.launch || []).some(l => isDropLaunch(l.type)) || g.def?.gateship > 0;
    const dtag    = isDrop ? '[DROP]' : '';
    return alive.length
      ? `${id}:${g.def?.name}${dtag}${co(lead.x, lead.y)}`
      : `${id}:${g.def?.name}${dtag}(off)`;
  });
  L.push(`  Enemy:    ${humPos.join('  ')}`);

  // ── Dropsites detail ──────────────────────────────────────────────────────
  if (dropsites.length) {
    L.push('\nDROPSITES:');
    for (const ds of dropsites) {
      if (ds.destroyed) continue;
      const ctrl    = dropsiteController(ds);
      const ctrlStr = ctrl === aiSide ? 'YOURS' : ctrl ? 'ENEMY' : 'FREE';
      const aiBat   = dsSideBattalions(ds, aiSide);
      const oppBat  = dsSideBattalions(ds, humanSide);
      const layer   = ds.base?.layer === 'Atmosphere' ? 'Atmo' : 'Orbit';
      const reconStr = (ds.reconOps > 0) ? ` ReconOps:${ds.reconOps}` : '';
      L.push(`  ${dsIds[ds.id]} ${ds.base?.name || ds.id} [${layer}] ${ctrlStr} You:${aiBat} Opp:${oppBat} bat${reconStr}`);
    }
  }

  // ── Opponent ships ────────────────────────────────────────────────────────
  const humOnTable  = humGroups.filter(([, g]) => g.ships.some(s => !s.destroyed && !s.offTable));
  const humOffCount = humGroups.filter(([, g]) => g.ships.every(s => s.destroyed || s.offTable) && g.ships.some(s => !s.destroyed)).length;
  L.push('\nOPPONENT:');
  if (humOnTable.length === 0 && humOffCount === 0) {
    L.push('  (none)');
  } else {
    for (const [gid, grp] of humOnTable) {
      const alive  = grp.ships.filter(s => !s.destroyed && !s.offTable);
      const hp     = alive.reduce((s, sh) => s + sh.hull, 0);
      const maxHp  = alive.reduce((s, sh) => s + (sh.maxHull || grp.def?.hull || 1), 0);
      const hpStr  = hp < maxHp ? `${hp}/${maxHp}HP` : `${maxHp}HP`;
      const count  = alive.length > 1 ? ` ×${alive.length}` : '';
      const isDrop = (grp.def?.launch || []).some(l => isDropLaunch(l.type)) || grp.def?.gateship > 0;
      const reconOpsAboard = grp.ships.reduce((s, sh, si) => s + (shipReconOps[grp.def?.id + '#' + si] || 0), 0);
      L.push(`  ${humIds[gid]} ${grp.def?.name}${count} [${grp.def?.tonnage}] ${hpStr}${isDrop ? ' DROP' : ''}${reconOpsAboard > 0 ? ` RECON:${reconOpsAboard}` : ''}`);
    }
    if (humOffCount > 0) {
      const offDropCount = humGroups.filter(([, g]) =>
        g.ships.every(s => s.destroyed || s.offTable) && g.ships.some(s => !s.destroyed) &&
        ((g.def?.launch || []).some(l => isDropLaunch(l.type)) || g.def?.gateship > 0)
      ).length;
      L.push(`  +${humOffCount} off-table${offDropCount > 0 ? ` (${offDropCount} DROP)` : ''}`);
    }
  }

  // ── Rules reference (once, globally) ─────────────────────────────────────
  L.push('\nRULES:');
  L.push(`  Reserve arrival: off-table ships enter from own edge (y=${aiEdgeY}"), can move up to full thrust inward on arrival.`);
  L.push(`  Grouping: each A/E ID is one activation group (may contain multiple ships that activate together).`);
  L.push(`  Survey VP: scored each round end — 1VP per dropsite your side has more battalions on than the opponent.`);
  L.push(`  Spikes: increase enemy targeting range. SR removes all spikes. WF adds +2. Higher spikes = easier to shoot.`);
  L.push(`  Range formula: Standard weapon = your Scan + target Sig. CA weapon = your Scan only.`);

  // ── Your unactivated ships ────────────────────────────────────────────────
  L.push('\nYOUR UNACTIVATED SHIPS:');
  let hasAny = false;

  for (const [gidAi, grp] of aiGroups) {
    const def = grp.def;
    if (grp.activated) continue;
    const alive    = grp.ships.filter(s => !s.destroyed && !s.offTable);
    const offTable = grp.ships.filter(s => !s.destroyed && s.offTable);
    if (!alive.length && !offTable.length) continue;
    hasAny = true;

    const allShips = grp.ships.filter(s => !s.destroyed);
    const hp    = alive.reduce((s, sh) => s + sh.hull, 0);
    const maxHp = allShips.reduce((s, sh) => s + (sh.maxHull || def.hull || 1), 0);
    const ships  = alive.length ? alive : offTable;
    const lead   = ships[0];
    const count  = allShips.length > 1 ? ` ×${allShips.length}` : '';
    const scan   = def.scan ?? 6;
    const sig    = def.sig ?? 3;
    const thrust = def.thrust ?? 8;
    const layer  = lead.layer === 'atmosphere' ? 'Atmo' : 'Orbit';
    const isDrop = (def.launch || []).some(l => isDropLaunch(l.type)) || def.gateship > 0;
    const hpStr  = offTable.length ? `${maxHp}HP` : hp < maxHp ? `${hp}/${maxHp}HP` : `${maxHp}HP`;
    const spkStr = grp.spikes > 0 ? `  Spikes:${grp.spikes}` : '';
    const posStr = offTable.length ? 'RESERVE' : co(lead.x, lead.y);
    // Only evaluate damage state for on-table ships — off-table have hp=0 (no alive ships)
    const condStr = !alive.length ? '' : hp < maxHp * 0.5 ? ' CRIPPLED' : hp < maxHp ? ' DAMAGED' : '';
    const dropTag = isDrop ? ' DROP' : '';

    L.push('');
    L.push(`  ${aiIds[gidAi]} ${def.name}${count} [hull:${def.tonnage}] ${hpStr}${condStr}${dropTag}  ${posStr}  ${layer}  Thrust:${thrust}"  Scan:${scan}"  Sig:${sig}"${spkStr}`);

    // Weapon summary
    const hasStd = (def.weapons || []).some(w => !/Close Action/i.test(w.special || ''));
    const hasCA  = (def.weapons || []).some(w =>  /Close Action/i.test(w.special || ''));
    const wepParts = [];
    if (hasStd) {
      const rawSpecials = [...new Set((def.weapons||[]).filter(w => !/Close Action/i.test(w.special||''))
        .flatMap(w => (w.special||'').split(',').map(s => s.trim())).filter(s => s && s !== '—'))].slice(0,3);
      const specials = rawSpecials.map(s => /Bombardment/i.test(s) ? `${s}(ANTI-GROUND — hits battalions on DS, not ships)` : s);
      wepParts.push(`Standard(${scan}+sig")${specials.length ? ' ' + specials.join(', ') : ''}`);
    }
    if (hasCA) wepParts.push(`CA(${scan}" only)`);
    if (wepParts.length) L.push(`    Weapons: ${wepParts.join('  ')}`);

    // Voidgate ships: note their role as drop enablers
    if (def.gateship > 0) {
      L.push(`    Role: Voidgate (capacity ${def.gateship}/round) — position within 3" of a DS to enable Mothership drops`);
    }

    // Per-order this-turn analysis: compute end position and capability flags
    // Primary move target: toward nearest enemy for combat, nearest free DS for drop ships
    const shipLayer = (alive.length ? lead.layer : 'orbit') || 'orbit';
    const eOnTable = humGroups.flatMap(([, g]) => {
      const a = g.ships.filter(s => !s.destroyed && !s.offTable);
      return a.length ? [{ gid: g.def?.id, def: g.def, ship: a[0] }] : [];
    });

    let primaryTargX, primaryTargY;
    if (isDrop) {
      // gate_dropship ships (Motherships) and gateship ships (Voidgates) both aim for dropsites
      const hasBulk = (def.launch||[]).some(l => l.type === 'bulk_lander' || l.type === 'drop_pod');
      const dsCandidates = dropsites.filter(ds => !ds.destroyed && dropsiteController(ds) !== aiSide);
      const byDist = (a, b) => Math.hypot(lead.x - a.x*INCH, lead.y - a.y*INCH) - Math.hypot(lead.x - b.x*INCH, lead.y - b.y*INCH);
      // Bulk landers prefer Atmosphere cities; dropships prefer same-layer
      const preferred = hasBulk
        ? dsCandidates.filter(ds => ds.base?.layer === 'Atmosphere')
        : dsCandidates.filter(ds => (ds.base?.layer === 'Atmosphere' ? 'atmosphere' : 'orbit') === shipLayer);
      const nearDs = (preferred.length ? preferred : dsCandidates).sort(byDist)[0];
      primaryTargX = nearDs ? nearDs.x * INCH : BOARD_PX / 2;
      primaryTargY = nearDs ? nearDs.y * INCH : BOARD_PX / 2;
    } else {
      const nearEnemy = eOnTable.sort((a, b) =>
        Math.hypot(lead.x - a.ship.x, lead.y - a.ship.y) - Math.hypot(lead.x - b.ship.x, lead.y - b.ship.y))[0];
      primaryTargX = nearEnemy ? nearEnemy.ship.x : BOARD_PX / 2;
      primaryTargY = nearEnemy ? nearEnemy.ship.y : BOARD_PX / 2;
    }

    // For reserve ships: compute entry position (x aligned with primary target, y=edge)
    const startX = offTable.length ? Math.max(INCH, Math.min(BOARD_PX - INCH, primaryTargX)) : lead.x;
    const startY = offTable.length ? aiEdgeY * INCH : lead.y;

    const ORDERS_TO_SHOW = isDrop
      ? ['GQ', 'MT']  // drop ships: advance + sprint
      : [
          'MT',        // sprint to close the gap — always show first for combat ships
          'WF',        // fire all weapons if in range
          'GQ',        // advance and fire half
          ...(grp.spikes > 0 ? ['SR'] : []),  // SR only if ship actually has spikes to shed
          ...(hp < maxHp ? ['DC'] : []),       // DC only if damaged
        ];

    for (const ord of ORDERS_TO_SHOW) {
      const moveFrac  = ORDER_MOVE[ord] ?? 1;
      const maxMovePx = thrust * moveFrac * INCH;
      const canFire   = ORDER_CAN_FIRE[ord] !== 'none';
      const canLaunch = ORDER_CAN_LAUNCH[ord];

      // This-turn end position: move from start toward primary target, capped at maxMove
      const dx = primaryTargX - startX, dy = primaryTargY - startY;
      const dist2targ = Math.hypot(dx, dy);
      const moveDist  = Math.min(maxMovePx, dist2targ);
      const endX = dist2targ > 0 ? startX + (dx / dist2targ) * moveDist : startX;
      const endY = dist2targ > 0 ? startY + (dy / dist2targ) * moveDist : startY;
      const endIn = co(endX, endY);

      // Spike delta note for orders that change spike count
      const SPIKE_DELTA = { GQ: -2, WF: 2, SR: -(grp.spikes), MT: 2, CC: 1, DC: 1 };
      const spikeDelta  = SPIKE_DELTA[ord] ?? 0;
      const spikesAfter = Math.max(0, grp.spikes + spikeDelta);
      const spikeNote   = spikeDelta > 0 ? ` Spikes→${spikesAfter}` : spikeDelta < 0 && grp.spikes > 0 ? ` Spikes→${spikesAfter}` : '';

      const parts = [`${ord}${spikeNote} → end ${endIn}`];
      if (offTable.length) parts[0] = `${ord}${spikeNote} → enters ${co(startX, startY)} → end ${endIn}`;

      // Fire checks vs each on-table enemy
      if (canFire && (hasStd || hasCA) && eOnTable.length) {
        for (const [egid, eg] of humGroups) {
          const eAlive = eg.ships.filter(s => !s.destroyed && !s.offTable);
          if (!eAlive.length) continue;
          const es     = eAlive[0];
          const eSig   = eg.def?.sig ?? 3;
          const maxRng = (hasStd ? scan + eSig : scan);
          const distEnd = Math.round(Math.hypot(endX - es.x, endY - es.y) / INCH);
          parts.push(`fire ${humIds[egid]}? ${distEnd <= maxRng ? `YES(${distEnd}"≤${maxRng}")` : `NO(${distEnd}">max${maxRng}")`}`);
        }
      }

      // Drop checks — show both current and toggled layer for same-layer weapons
      // shipLayer already defined above (at primary-target computation)
      const toggledLayer = shipLayer === 'orbit' ? 'atmosphere' : 'orbit';
      if (canLaunch && isDrop) {
        // gate_dropship (Shaltari Mothership): drops via on-table Voidgates within 3" of dropsite
        const hasGateDrop = (def.launch||[]).some(l => l.type === 'gate_dropship');
        if (hasGateDrop) {
          const gates = Object.values(state.groups).flatMap(g => {
            if (g.def?.side !== aiSide || !g.def?.gateship) return [];
            return g.ships.filter(s => !s.destroyed && !s.offTable).map(s => s);
          });
          const reachableViaGate = dropsites.filter(ds => {
            if (ds.destroyed) return false;
            return gates.some(gate => Math.hypot(gate.x - ds.x * INCH, gate.y - ds.y * INCH) <= 3 * INCH);
          });
          if (gates.length === 0) {
            parts.push(`drop via Voidgate: NO Voidgates on table — position Voidgates within 3" of DS first`);
          } else if (reachableViaGate.length > 0) {
            const dsLabels = reachableViaGate.map(ds => {
              const ctrl = dropsiteController(ds);
              return `${dsIds[ds.id]}${ctrl !== aiSide ? '*' : ''}`;
            });
            parts.push(`drop via Voidgate: YES → ${dsLabels.join(' ')}`);
          } else {
            const closestGate = gates.sort((a, b) =>
              Math.min(...dropsites.filter(d => !d.destroyed).map(ds => Math.hypot(a.x - ds.x*INCH, a.y - ds.y*INCH))) -
              Math.min(...dropsites.filter(d => !d.destroyed).map(ds => Math.hypot(b.x - ds.x*INCH, b.y - ds.y*INCH)))
            )[0];
            const nearestDsDist = closestGate ? Math.round(Math.min(...dropsites.filter(d => !d.destroyed).map(ds => Math.hypot(closestGate.x - ds.x*INCH, closestGate.y - ds.y*INCH))) / INCH) : '?';
            parts.push(`drop via Voidgate: NO (nearest Voidgate ${nearestDsDist}" from nearest DS, need ≤3")`);
          }
        }

        for (const l of (def.launch || [])) {
          const rng = LAUNCH_RANGE_IN[l.type];
          if (!rng || rng < 0) continue; // skip gate_dropship (handled above) and unknowns
          const sameLayerOnly = l.type === 'dropship';
          // For each valid layer (current; and toggled if same-layer weapon), check drop eligibility
          const layersToCheck = sameLayerOnly ? [shipLayer, toggledLayer] : [null]; // null = any layer
          for (const checkLayer of layersToCheck) {
            const layerLabel = sameLayerOnly ? ` [${checkLayer}]` : '';
            for (const ds of dropsites) {
              if (ds.destroyed) continue;
              const dsLayer = ds.base?.layer === 'Atmosphere' ? 'atmosphere' : 'orbit';
              if (checkLayer !== null && dsLayer !== checkLayer) continue;
            const distDrop = Math.round(Math.hypot(endX - ds.x * INCH, endY - ds.y * INCH) / INCH);
              const ctrl = dropsiteController(ds);
              const tag  = ctrl !== aiSide ? '*' : '';
              parts.push(`drop${layerLabel} ${dsIds[ds.id]}${tag}? ${distDrop <= rng ? `YES(${distDrop}"≤${rng}")` : `NO(${distDrop}">max${rng}")`}`);
            }
          }
        }
      }

      // MT-specific notes (applies to all ships — drop and combat alike)
      if (ord === 'MT') {
        if (isDrop) {
          // Drop ships: show next-turn setup distances to dropsites
          for (const l of (def.launch || [])) {
            const rng = LAUNCH_RANGE_IN[l.type];
            if (!rng) continue;
            const sameLayerOnly = l.type === 'dropship';
            const setupNotes = [];
            for (const ds of dropsites) {
              if (ds.destroyed) continue;
              const dsLayer = ds.base?.layer === 'Atmosphere' ? 'atmosphere' : 'orbit';
              if (sameLayerOnly && dsLayer !== shipLayer) continue;
              const distNext = +(Math.hypot(endX - ds.x * INCH, endY - ds.y * INCH) / INCH).toFixed(1);
              const ctrl = dropsiteController(ds);
              const tag  = ctrl !== aiSide ? '*' : '';
              setupNotes.push(distNext === 0 ? `${dsIds[ds.id]}${tag} AT SITE` : `${dsIds[ds.id]}${tag} ${distNext}"`);
            }
            if (setupNotes.length)
              parts.push(`CANNOT launch | sets up: ${setupNotes.slice(0, 4).join('  ')}`);
          }
        } else {
          // Combat ships: show gap closure to nearest on-table enemy
          const nearEnemyEntry = humGroups
            .map(([egid, eg]) => {
              const eAlive = eg.ships.filter(s => !s.destroyed && !s.offTable);
              if (!eAlive.length) return null;
              const es = eAlive[0];
              const distBefore = Math.round(Math.hypot(startX - es.x, startY - es.y) / INCH);
              const distAfter  = Math.round(Math.hypot(endX   - es.x, endY   - es.y) / INCH);
              return { egid, distBefore, distAfter };
            })
            .filter(Boolean)
            .sort((a, b) => a.distAfter - b.distAfter)[0];
          if (nearEnemyEntry) {
            parts.push(`CANNOT fire | closes ${humIds[nearEnemyEntry.egid]}: ${nearEnemyEntry.distBefore}"→${nearEnemyEntry.distAfter}"`);
          }
        }

        // Spike exposure for all MT: +2 spikes → effective sig rises → enemies can target further
        const mtSpikesAfter = grp.spikes + 2;
        const mtEffSig = sig + mtSpikesAfter;
        const exposureNotes = [];
        for (const [egid, eg] of humGroups) {
          const eAlive = eg.ships.filter(s => !s.destroyed && !s.offTable);
          if (!eAlive.length) continue;
          const eScan     = eg.def?.scan ?? 6;
          const newMaxRng = eScan + mtEffSig;
          const distEnd   = Math.round(Math.hypot(endX - eAlive[0].x, endY - eAlive[0].y) / INCH);
          exposureNotes.push(`${humIds[egid]} range ${newMaxRng}" dist ${distEnd}" — ${distEnd <= newMaxRng ? 'EXPOSED' : 'safe'}`);
        }
        parts.push(`AFTER: Spikes ${grp.spikes}→${mtSpikesAfter} Sig ${sig}"→${mtEffSig}"eff | ${exposureNotes.join('  ')}`);
      }

      L.push(`    ${parts.join('  |  ')}`);
    }

    if (hp > 0 && hp < maxHp) L.push(`    DC → repair ${def.tonnage === 'H' || def.tonnage === 'C' ? 'D3HP' : '1HP'}`);
  }

  if (!hasAny) L.push('  (all activated)');

  return L.join('\n');
}
