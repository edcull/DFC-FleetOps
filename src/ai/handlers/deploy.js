import { generateDeployOptions } from '../options.js';
import { undeployedDeployableCount } from '../../engine/mutators.js';

export function handleDeploy(state, rng, aiSide, applyFn) {
  // If ships still need deploying, place one
  if (undeployedDeployableCount(state, aiSide) > 0) {
    const opts = generateDeployOptions(state, aiSide);
    if (!opts.length) return; // shouldn't happen, but be safe
    const opt = opts[0];
    applyFn({ type: 'deployShip', gid: opt.gid, si: opt.si, x: Math.round(opt.x), y: Math.round(opt.y), heading: opt.heading });
    return;
  }

  // All ships placed — signal done (gating ensures player2 waits for player1 first)
  if (!(state.deployDone || {})[aiSide]) {
    applyFn({ type: 'deployDone', side: aiSide });
  }
}
