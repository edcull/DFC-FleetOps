// New Recruit fleet list parser.
// Accepts the plain-text export format from the New Recruit army builder.

const FACTION_MAP = {
  'united colonies of mankind': 'ucm',
  'ucmf': 'ucm',
  'ucm': 'ucm',
  'scourge': 'scourge',
  'post human republic': 'phr',
  'post-human republic': 'phr',
  'phr': 'phr',
  'shaltari': 'shaltari',
  'resistance': 'resistance',
  'bioficer': 'bioficer',
};

const SECONDARY_MAP = {
  'key site':          'key_site',
  'gather intel':      'gather_intel',
  'annihilate':        'annihilate',
  'take prizes':       'take_prizes',
  'decapitate':        'decapitate',
  'priority target':   'priority_target',
  'long shot':         'long_shot',
  'objectives beyond': 'objectives_beyond',
};

// Known hardpoint option names (lower-case, for detection)
const KNOWN_OPTIONS = new Set([
  'scanner array', 'drive refit', 'laser refit', 'ablative armour', 'sensor dome',
  'xn-31 mass driver turret', 'n-11 artillery cannon turret',
  'n-109 bombardment mortar turret', 'vent cannon turret',
  'n-31 hybrid gun bank', 'n-8 artillery cannon bank', 'nc-16 missile bank',
  'n-31 hybrid gun turret', 'nc-16 missile turret', 'light vent cannon turret',
  '10k mass driver turret', 'heavy dual vent cannon turret',
  'n-31 hybrid gun battery', 'nc-16 missile battery',
  'fighters & bombers', 'mines', 'bulk landers & fire ships', 'torpedo',
]);

function detectFaction(line) {
  const l = line.toLowerCase();
  for (const [k, v] of Object.entries(FACTION_MAP)) {
    if (l.includes(k)) return v;
  }
  return null;
}

// Extract options from parenthetical content: "Cruiser (Drive Refit, N-31 Hybrid Gun Bank)"
function extractParenOptions(name) {
  const m = name.match(/\(([^)]+)\)/);
  if (!m) return { cleanName: name.trim(), options: [] };
  const cleanName = name.replace(/\s*\([^)]*\)/, '').trim();
  const options = m[1].split(/[,+]/).map(s => s.trim()).filter(s => {
    const k = s.toLowerCase().replace(/\s+/g,' ');
    return KNOWN_OPTIONS.has(k);
  });
  return { cleanName, options };
}

// Parse "2x Rio Cruiser [85 pts]" or "Rio Cruiser [165 pts]" or "• 2x Rio Cruiser [85 pts]"
// Also handles inline options after [pts]: "1x Cruiser [102 pts]: Ablative Armour, Vent Cannon Turret"
function parseShipLine(line) {
  let s = line.replace(/^[•·\-*]\s*/, '').trim();
  const countMatch = s.match(/^(\d+)x\s+/);
  let count = 1;
  if (countMatch) {
    count = parseInt(countMatch[1]);
    s = s.slice(countMatch[0].length);
  }
  const ptsMatch = s.match(/^(.*?)\s*\[(\d+)\s*pts\](.*)/);
  if (!ptsMatch) return null;
  const rawName = ptsMatch[1].trim();
  const pts = parseInt(ptsMatch[2]);
  const afterPts = ptsMatch[3] || '';
  if (!rawName) return null;
  const { cleanName, options } = extractParenOptions(rawName);
  // Extract inline options from ": Option [Xpts], 2x Option2, ..." after the pts bracket.
  if (afterPts) {
    afterPts.replace(/^[:\s]+/, '').split(',').forEach(part => {
      const countM = part.trim().match(/^(\d+)x\s+/);
      const n = countM ? parseInt(countM[1]) : 1;
      const clean = part.replace(/^\s*\d+x\s+/, '').replace(/\s*\[\d+\s*pts?\]\s*$/, '').trim();
      const key = clean.toLowerCase().replace(/\s+/g, ' ');
      if (clean && KNOWN_OPTIONS.has(key)) {
        for (let i = 0; i < n; i++) options.push(clean);
      }
    });
  }
  return { name: cleanName, count, pts, options };
}

// Detect if a line is a hardpoint option sub-line (indented or starts with -)
function parseOptionLine(line) {
  // Must start with spaces+dash or just a dash (not a bullet •)
  if (!line.match(/^[\s]*[-–]\s/) && !line.match(/^\s{2,}/)) return null;
  const s = line.replace(/^[\s\-–]+/, '').trim();
  // Strip pts annotation
  const clean = s.replace(/\s*\[\d+\s*pts?\].*$/, '').trim();
  const key = clean.toLowerCase().replace(/\s+/g,' ');
  return KNOWN_OPTIONS.has(key) ? clean : null;
}

export function parseNewRecruit(text) {
  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  let faction = null;
  const admirals = []; // non-famous: [{ level, title, cost }]
  const groups = [];
  const secondaries = [];
  let inAdmiralSection = false;
  let inNonFamousAdmiralSection = false;
  let inGroupSection = false;
  let inGameSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Faction from first header line
    if (!faction && !trimmed.startsWith('#')) {
      faction = detectFaction(trimmed);
    }

    // Section headers
    if (trimmed.startsWith('##')) {
      const lower = trimmed.toLowerCase();
      const isAdmiral = lower.includes('admiral');
      const isFamous  = lower.includes('famous');
      inAdmiralSection = isAdmiral;
      inNonFamousAdmiralSection = isAdmiral && !isFamous;
      inGroupSection   = lower.includes('groups') || lower.includes('group');
      inGameSection    = lower.includes('## game') || lower.includes('game');
      continue;
    }
    if (trimmed.startsWith('#')) {
      if (!faction) faction = detectFaction(trimmed);
      continue;
    }

    // Admiral section: non-famous sets level + title; famous admiral adds a group
    if (inAdmiralSection) {
      const lvlMatch = trimmed.match(/Lvl\s*(\d+)/i);
      // Famous admiral line: "Lvl 2: Typhoon Vasquez - Heavy Cruiser [158 pts]:"
      const famousMatch = trimmed.match(/Lvl\s*\d+\s*:\s*(.+?)\s*-\s*[^[]+\[(\d+)\s*pts\]/i);
      if (famousMatch) {
        groups.push({ name: famousMatch[1].trim(), count: 1, pts: parseInt(famousMatch[2]), isFamousAdmiral: true });
      } else if (inNonFamousAdmiralSection && lvlMatch) {
        // Non-famous admiral line: "Lvl 1: Captain [25 pts]: Mass Driver Volley" or "Lvl 2: Admiral [20 pts]"
        const level = parseInt(lvlMatch[1]);
        const ptsM = trimmed.match(/\[(\d+)\s*pts\]/i);
        const cost = ptsM ? parseInt(ptsM[1]) : 0;
        const titleM = trimmed.match(/Lvl\s*\d+\s*:\s*([^\[:\n]+)/i);
        const title = titleM ? titleM[1].trim() : 'Admiral';
        // Capture chosen ability/abilities after "[pts]:"
        const abilityM = trimmed.match(/\[\d+\s*pts\]\s*:\s*(.+)$/i);
        const abilities = abilityM
          ? abilityM[1].split(',').map(s => s.trim()).filter(Boolean)
          : [];
        admirals.push({ level, title, cost, abilities });
      }
      continue; // skip bullet sub-lines (cost breakdowns)
    }

    // Secondary objectives from ## Game section
    if (inGameSection) {
      if (trimmed.toLowerCase().startsWith('secondary objectives:')) {
        const part = trimmed.replace(/^secondary objectives:\s*/i, '');
        part.split(',').map(s => s.trim().toLowerCase()).forEach(s => {
          const key = SECONDARY_MAP[s];
          if (key && !secondaries.includes(key)) secondaries.push(key);
        });
      }
      continue;
    }

    // Group lines
    if (inGroupSection) {
      // Option sub-line for the last group
      if (groups.length > 0) {
        const opt = parseOptionLine(line);
        if (opt) {
          const last = groups[groups.length - 1];
          last.options = last.options || [];
          last.options.push(opt);
          continue;
        }
      }

      // Bullet sub-ship line
      if (trimmed.startsWith('•') || trimmed.startsWith('·') || trimmed.match(/^\d+x\s/)) {
        const parsed = parseShipLine(trimmed);
        if (parsed) {
          groups.push(parsed);
        }
        continue;
      }

      // Group header line: "Name [pts]:" or "Name [pts]: weapons..."
      const headerMatch = trimmed.match(/^(.*?)\s*\[(\d+)\s*pts\]/);
      if (headerMatch) {
        const rawName = headerMatch[1].trim();
        const groupPts = parseInt(headerMatch[2]);
        const nextLine = lines.slice(i + 1).map(l => l.trim()).find(l => l);
        if (nextLine && (nextLine.startsWith('•') || nextLine.startsWith('·') || nextLine.match(/^\d+x\s/))) {
          // Multi-ship group — bullets will be parsed next iterations
        } else {
          // Single-ship group — use parseShipLine so INLINE options after "[pts]: ..." are
          // captured too (e.g. "Delhi Battleship [275 pts]: ..., Drive Refit [45 pts], ..."),
          // not just parenthetical ones. (The header path previously dropped inline options, so
          // upgrades like Drive Refit never applied.)
          const parsedShip = parseShipLine(trimmed);
          if (parsedShip) {
            groups.push({ name: parsedShip.name, count: 1, pts: groupPts,
              options: parsedShip.options.length ? parsedShip.options : undefined });
          } else {
            const { cleanName, options } = extractParenOptions(rawName);
            groups.push({ name: cleanName, count: 1, pts: groupPts, options: options.length ? options : undefined });
          }
        }
        continue;
      }
    }
  }

  // Fallback faction detection
  if (!faction) {
    for (const line of lines) {
      const f = detectFaction(line);
      if (f) { faction = f; break; }
    }
  }

  const admiralLevel = admirals.length > 0 ? Math.max(...admirals.map(a => a.level)) : 0;
  const valid = !!faction && groups.length > 0;
  return { faction, admiralLevel, admirals, groups, secondaries, valid };
}
