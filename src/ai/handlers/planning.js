import { scorePlanning } from '../fallback.js';

export function handlePlanning(state, rng, aiSide, personality, applyFn) {
  const ini = state.initiative;
  if (!ini) return;

  // Initiative winner decides who goes first
  if (ini.winner === aiSide && !ini.holder) {
    const takeInitiative = scorePlanning(state, aiSide);
    const to = takeInitiative ? aiSide : (aiSide === 'player1' ? 'player2' : 'player1');
    applyFn({ type: 'giveInitiative', to });
    return;
  }

  // Initiative holder starts the activation phase
  if (ini.holder === aiSide) {
    applyFn({ type: 'beginActivation' });
  }
}
