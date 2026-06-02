// Battalion combat handler.
// Drives all stages of state.battalionCombat: pick → init → other → destroy → finish.
// Strategy: skip ground-unit assignment (bcSkipAssign) — just resolve contested
// dropsites quickly without spending ground battalions on feature attacks.

import { contestedDropsites, dsBattalions, dsSideBattalions } from '../../engine/mutators.js';

export function handleBattalion(state, aiSide, applyFn) {
  const bc = state.battalionCombat;
  if (!bc) return;

  switch (bc.stage) {
    case 'pick': {
      // Find a contested dropsite not yet resolved this combat round.
      const contested = contestedDropsites(state);
      if (contested.length > 0) {
        // Prioritise dropsites where AI has more battalions (best chance to survive).
        const sorted = contested.slice().sort((a, b) =>
          dsSideBattalions(b, aiSide) - dsSideBattalions(a, aiSide)
        );
        applyFn({ type: 'bcPickDropsite', dsId: sorted[0].id });
      } else {
        // No more contested dropsites — move to destroy phase.
        applyFn({ type: 'bcToDestroy' });
      }
      break;
    }

    case 'init':
    case 'other':
      // Skip ground-unit assignment; let the engine resolve 1-for-1 automatically.
      applyFn({ type: 'bcSkipAssign' });
      break;

    case 'destroy':
      // No feature destruction logic in Phase A — just finish.
      applyFn({ type: 'bcFinish' });
      break;

    default:
      // Unknown stage — finish to unblock.
      applyFn({ type: 'bcFinish' });
  }
}
