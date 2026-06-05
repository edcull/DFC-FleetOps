import { generateDeployOptions } from '../options.js';
import { undeployedDeployableCount } from '../../engine/mutators.js';

export function handleDeploy(state, rng, aiSide, applyFn) {
  // If ships still need deploying, try to place one.
  if (undeployedDeployableCount(state, aiSide) > 0) {
    const opts = generateDeployOptions(state, aiSide);
    if (opts.length) {
      const opt = opts[0];
      // If the placement was accepted we're done for this step; if it was rejected
      // (no legal position) fall through to deployDone so we don't spin forever.
      if (applyFn({ type: 'deployShip', gid: opt.gid, si: opt.si, x: Math.round(opt.x), y: Math.round(opt.y), heading: opt.heading })) return;
    }
    // No valid placement available — give up the remainder and signal done.
  }

  // All ships placed (or none placeable) — signal done.
  if (!(state.deployDone || {})[aiSide]) {
    applyFn({ type: 'deployDone', side: aiSide });
  }
}
