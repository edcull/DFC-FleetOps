import { describe, it, expect } from 'vitest';
import { handleAsset } from '../../src/ai/handlers/asset.js';
import { makeState, shipDef, shipInstance, addGroup } from '../engine/helpers.js';

// Build an asset-phase state with one player1 bomber stage active and a player2 target.
function bomberStage() {
  const s = makeState();
  s.assetPhase = { step: 'assets' };
  s.assetActiveSide = 'player1';
  s.launchedAssets = [{ id: 'a1', kind: 'bomber', count: 2, side: 'player1', x: 200, y: 200, moved: false }];
  addGroup(s, shipDef({ id: 'player2:m', side: 'player2', name: 'Emerald Mothership', launch: [{ type: 'gate_dropship', n: 4 }] }),
    [Object.assign(shipInstance({ x: 300, y: 300 }), { maxHull: 12, hull: 12 })]);
  return s;
}

describe('handleAsset — never stalls the asset phase', () => {
  it('forces assetStageDone when an asset move is rejected (stays unmoved)', () => {
    const s = bomberStage();
    s.assetPhase.assetType = 'bomber';
    const intents = [];
    // applyFn that REJECTS assetMove (asset can't move / zero-distance rejected) but accepts others.
    const applyFn = (i) => { intents.push(i.type); return i.type !== 'assetMove'; };
    handleAsset(s, 'player1', null, applyFn);
    // It must not leave the stage hanging: it issues assetStageDone to advance.
    expect(intents).toContain('assetStageDone');
  });

  it('forces assetStageDone when the side has no movable assets of this stage type', () => {
    const s = bomberStage();
    s.assetPhase.assetType = 'fighter'; // player1 has only a bomber → no movable fighters
    const intents = [];
    const applyFn = (i) => { intents.push(i.type); return true; };
    handleAsset(s, 'player1', null, applyFn);
    expect(intents).toContain('assetStageDone');
    expect(intents).not.toContain('assetMove'); // didn't try to move the wrong-type bomber
  });

  it('confirms assetPhaseDone when all stages are finished (no active side)', () => {
    const s = bomberStage();
    s.assetActiveSide = null;
    s.assetPhase.assetType = null;
    s.assetPhase.doneSides = [];
    const intents = [];
    const applyFn = (i) => { intents.push(i.type); return true; };
    handleAsset(s, 'player1', null, applyFn);
    expect(intents).toContain('assetPhaseDone');
  });
});
