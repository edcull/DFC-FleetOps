// LLM interface — Anthropic and OpenAI wrapper with timeout + fallback.
// Called by the activation handler when AI_PROVIDER and AI_API_KEY are configured.
// All calls (success, fallback, timeout) are appended to logs/llm.log as JSON lines.

import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

const LOG_FILE = join(process.cwd(), 'logs', 'llm.log');

async function logCall(entry) {
  try {
    await mkdir(join(process.cwd(), 'logs'), { recursive: true });
    await appendFile(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* logging is non-critical */ }
}

const PROVIDER   = process.env.AI_PROVIDER   || 'anthropic';
const API_KEY    = process.env.AI_API_KEY    || '';
const MODEL      = process.env.AI_MODEL      || (PROVIDER === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001');
const TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '8000', 10);
const FALLBACK_ONLY = process.env.AI_FALLBACK_ONLY === 'true';

export const llmAvailable = !FALLBACK_ONLY && !!API_KEY;

// Build the LLM prompt messages array.
function buildPrompt(briefing, options, personality) {
  const optionList = options
    .map((o, i) => `${i + 1}. ${o.label}`)
    .join('\n');

  const tactics = personality.aiTactics?.length
    ? `\nFleet Tactics:\n${personality.aiTactics.map(t => `- ${t}`).join('\n')}`
    : '';

  return {
    systemSuffix: tactics,
    messages: [
      {
        role: 'user',
        content: `${briefing}\n\nOPTIONS:\n${optionList}\n\nChoose one option (1–${options.length}):`,
      },
    ],
  };
}

// Parse the index from the LLM's reply (e.g. "3 — advancing to DS-2" → 2).
function parseOptionIndex(text, count) {
  const m = text.trim().match(/^(\d+)/);
  if (!m) return null;
  const idx = parseInt(m[1], 10) - 1;
  return (idx >= 0 && idx < count) ? idx : null;
}

async function callAnthropic(messages, systemPrompt, maxTokens = 64) {
  const requestBody = { model: MODEL, max_tokens: maxTokens, system: systemPrompt, messages };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  return { text: data.content?.[0]?.text || '', request: requestBody, rawResponse: data };
}

async function callOpenAI(messages, systemPrompt, maxTokens = 64) {
  const requestBody = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify(requestBody),
  });
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || '', request: requestBody, rawResponse: data };
}

// ── Single generate+choose call ───────────────────────────────────────────────
// LLM produces 4-8 activation plans and immediately picks the best one.
// Returns { lines: string[], chosenIdx: number|null } or null on failure.
export async function llmGenerateOptions(stateBriefing, groupCapabilities, personality) {
  if (!llmAvailable) return null;

  const tactics = personality.aiTactics?.length
    ? `\nFleet Tactics:\n${personality.aiTactics.map(t => `- ${t}`).join('\n')}`
    : '';

  const systemPrompt =
    `You are an AI admiral in Dropfleet Commander. Personality: ${personality.label} — ${personality.systemPrompt}${tactics}\n\n` +
    `TACTICAL PRIORITIES:\n` +
    `  DROP ships (Troopship/Barge/Strike Carrier — those with Bulk Lander or Dropship launch):\n` +
    `    → Advance toward uncontrolled or enemy-held dropsites and drop battalions. This wins games.\n` +
    `    → Use GQ to advance and launch in one activation. Prioritise DS marked * (enemy or free).\n` +
    `    → Bulk Landers (any layer): target Atmosphere cities first (Medium/Large City) — highest VP value.\n` +
    `    → Dropships (same layer only): target Orbital stations they can legally reach.\n` +
    `    → When two ships have equivalent sprint options, commit the Bulk Lander to the central Atmo site.\n` +
    `  COMBAT ships (Cruisers/Destroyers/Frigates — no drop capability):\n` +
    `    → Identify enemy drop-capable ships and engage them before they land battalions.\n` +
    `    → Use WF if already in range, GQ to close. Deny the opponent their ground game.\n` +
    `  RACE vs DENY — when an enemy DROP ship is already on-table and your combat ships can't yet fire:\n` +
    `    → Count how many dropsites YOUR drop ships can lock in before the enemy drops land.\n` +
    `    → If you can match or out-drop the enemy this round, ADVANCE YOUR OWN DROPS (ignore the enemy carrier).\n` +
    `    → Only MT-sprint a combat ship into an enemy carrier's range if the enemy will score a dropsite\n` +
    `      next round that you cannot contest — and the combat ship won't be destroyed doing it.\n\n` +
    `ORDERS:\n` +
    `  GQ – move ½–full thrust, turn ≤45°, fire ½ weapons, launch. Spikes −2.\n` +
    `  WF – move ½–full thrust, fire ALL weapons, launch. Spikes +2.\n` +
    `  SR – move ½–full thrust, NO firing/turning. Removes ALL spikes (go dark).\n` +
    `  CC – two ≤45° turns + ½ thrust move, fire 1 weapon. Spikes +1. Repositions heading.\n` +
    `  MT – move full–2× thrust straight, no fire/launch. Spikes +2 at end — ship arrives exposed (higher sig = easier to target).\n` +
    `  DC – move ≤½ thrust, repair 1HP (D3 for H/C), fire 1 CA weapon only.\n\n` +
    `RANGES: Standard weapon: Scan + target Sig. Close Action (CA): Scan only.\n` +
    `DROPS: Bulk Lander 6" any layer. Dropship 3" same layer only.\n\n` +
    `Choose ONE activation for this turn from YOUR UNACTIVATED SHIPS only.\n` +
    `Ships marked ✓ are already activated this round — do NOT choose them.\n` +
    `Output a single line: GroupName | ORDER | what to do\n\n` +
    `Format: <ShipName> | <ORDER> | <what to do>\n` +
    `Examples (use your actual ship names from YOUR UNACTIVATED SHIPS):\n` +
    `  [ShipName] | WF | fire on [EnemyName] (already in range)\n` +
    `  [ShipName] | MT | sprint toward DS1 Medium City (not yet in drop range)\n` +
    `  [ShipName] | GQ | advance to DS1 and drop battalions (drop DS1? YES)\n` +
    `  [ShipName] | SR | go silent to shed spikes\n` +
    `  [ShipName] | DC | repair damage\n` +
    `Begin your reply IMMEDIATELY with the line. No analysis, no preamble, no headings — the line is the entire reply.`;

  const userContent = `${stateBriefing}\n\n${groupCapabilities}`;
  const t0 = Date.now();

  let lastRequest = null;
  try {
    const result = await Promise.race([
      PROVIDER === 'openai'
        ? callOpenAI([{ role: 'user', content: userContent }], systemPrompt, 200)
        : callAnthropic([{ role: 'user', content: userContent }], systemPrompt, 200),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    const { text, request, rawResponse } = result;
    lastRequest = request;

    // Strip markdown per line, then find the plan line: <name> | <ORDER> | ...
    // Prefer a line whose 2nd field is a real order, so reasoning lines that
    // happen to contain a pipe don't false-match before the actual plan.
    const ORDER_RE = /\|\s*(GQ|WF|SR|CC|MT|DC)\s*\|/i;
    const cleaned = text.split('\n').map(l => l.replace(/[\*_`#~>]+/g, '').trim());
    const line = cleaned.find(l => ORDER_RE.test(l))
              || cleaned.find(l => l.includes('|') && l.length > 5);
    if (!line) throw new Error(`no plan line parsed — raw: "${text.trim().slice(0, 120)}"`);
    const ms = Date.now() - t0;
    console.log(`[AI/LLM] chose in ${ms}ms: ${line}`);
    logCall({ ts: new Date().toISOString(), provider: PROVIDER, model: MODEL, ms, call: 'choose', personality: personality.label, response: line, request, rawResponse });
    // Return as a single-element list with chosenIdx=0 so the existing mapping code works unchanged.
    return { lines: [line], chosenIdx: 0 };
  } catch (err) {
    const ms = Date.now() - t0;
    console.warn(`[AI/LLM] generate fallback after ${ms}ms:`, err.message);
    logCall({ ts: new Date().toISOString(), provider: PROVIDER, model: MODEL, ms, call: 'choose', personality: personality.label, request: lastRequest, error: err.message });
    return null;
  }
}

// Returns the chosen option index (0-based), or null on failure/timeout → use fallback.
export async function llmChoose(briefing, options, personality) {
  if (!llmAvailable || !options.length) return null;

  const { systemSuffix, messages } = buildPrompt(briefing, options, personality);
  const systemPrompt = `You are an AI opponent in a game of Dropfleet Commander, ${personality.label} personality.\n${personality.systemPrompt}${systemSuffix}\nReply with ONLY the option number you choose, followed by one sentence explaining why.\nFormat: "3 — advancing Orpheus to DS-2 contests the Key Site before the human reinforces."`;

  console.log(`[AI/LLM] ${PROVIDER}/${MODEL} — ${options.length} options, personality: ${personality.label}`);
  const t0 = Date.now();

  let lastRequest = null;
  try {
    const result = await Promise.race([
      PROVIDER === 'openai' ? callOpenAI(messages, systemPrompt) : callAnthropic(messages, systemPrompt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    const { text, request, rawResponse } = result;
    lastRequest = request;
    const idx = parseOptionIndex(text, options.length);
    if (idx === null) throw new Error(`unparseable response: "${text.slice(0, 60)}"`);
    const ms = Date.now() - t0;
    console.log(`[AI/LLM] chose option ${idx + 1} in ${ms}ms: "${options[idx].label}" — ${text.trim().slice(0, 120)}`);
    logCall({ ts: new Date().toISOString(), provider: PROVIDER, model: MODEL, ms, personality: personality.label, optionCount: options.length, chosen: idx + 1, chosenLabel: options[idx].label, request, response: text, rawResponse });
    return idx;
  } catch (err) {
    const ms = Date.now() - t0;
    console.warn(`[AI/LLM] fallback after ${ms}ms:`, err.message);
    logCall({ ts: new Date().toISOString(), provider: PROVIDER, model: MODEL, ms, personality: personality.label, optionCount: options.length, chosen: null, request: lastRequest, error: err.message });
    return null;
  }
}
