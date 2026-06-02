export const PERSONALITIES = {
  aggressive: {
    label: 'Aggressive',
    systemPrompt: `You favour closing range and maximising kills.
Prioritise hull damage over positioning. Accept risk. Prefer Weapons Free and General Quarters.
Closing to Close Action range is almost always worth it.`,
    weights: { kill: 2.5, vp: 1.0, survival: 0.3, objective: 0.8, momentum: 0.5 },
  },
  positional: {
    label: 'Positional',
    systemPrompt: `You prioritise dropsite control and objective completion.
Avoid unnecessary engagements. Contest key dropsites. Drop battalions early.
Prefer Course Change and Max Thrust for repositioning.`,
    weights: { kill: 0.8, vp: 2.5, survival: 1.0, objective: 2.0, momentum: 0.5 },
  },
  defensive: {
    label: 'Defensive',
    systemPrompt: `You value fleet preservation above all. Avoid being outgunned.
Use Silent Running to shed spikes. Prioritise Damage Control on crippled ships.
Accept losing VP to avoid losing ships.`,
    weights: { kill: 0.6, vp: 1.0, survival: 2.5, objective: 0.8, momentum: 0.3 },
  },
  balanced: {
    label: 'Balanced',
    systemPrompt: `You balance offensive pressure, positional play, and fleet survival.
Adapt: press advantages when ahead on VP, play conservatively when behind.`,
    weights: { kill: 1.2, vp: 1.5, survival: 1.2, objective: 1.5, momentum: 0.5 },
  },
  opportunist: {
    label: 'Opportunist',
    systemPrompt: `You identify and eliminate high-value targets of opportunity.
Ignore cheap ships. Focus fire on crippled enemies and expensive targets.
Sacrifice positioning to secure kills on heavy assets.`,
    weights: { kill: 3.0, vp: 0.8, survival: 0.5, objective: 0.6, momentum: 0.5 },
  },
};

export function getPersonality(key) {
  return PERSONALITIES[key] || PERSONALITIES.balanced;
}
