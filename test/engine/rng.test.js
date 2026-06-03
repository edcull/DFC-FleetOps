/**
 * Seeded PRNG tests.
 *
 * makeRng must be deterministic (same seed → same stream) and reproducible
 * via getState/setState so the server can replay authoritative dice.
 */
import { describe, it, expect } from 'vitest';
import { makeRng, localRng, rollD6, rollDie } from '../../src/engine/rng.js';

describe('makeRng', () => {
  it('produces floats in [0, 1)', () => {
    const rng = makeRng(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('coerces seed to uint32 (negative / fractional seeds are stable)', () => {
    const a = makeRng(-1);
    const b = makeRng(-1);
    expect(Array.from({ length: 5 }, () => a())).toEqual(Array.from({ length: 5 }, () => b()));
  });

  it('getState / setState replays the exact same stream', () => {
    const rng = makeRng(777);
    rng(); rng(); rng();                 // advance a few
    const snapshot = rng.getState();
    const after = Array.from({ length: 10 }, () => rng());
    // Rewind and replay
    rng.setState(snapshot);
    const replay = Array.from({ length: 10 }, () => rng());
    expect(replay).toEqual(after);
  });

  it('two rngs synced via setState stay in lockstep', () => {
    const a = makeRng(9);
    a(); a();
    const b = makeRng(0);
    b.setState(a.getState());
    expect(Array.from({ length: 8 }, () => a()))
      .toEqual(Array.from({ length: 8 }, () => b()));
  });
});

describe('rollD6 / rollDie', () => {
  it('only ever returns faces 1–6', () => {
    const rng = makeRng(2024);
    const seen = new Set();
    for (let i = 0; i < 5000; i++) {
      const r = rollD6(rng);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
      expect(Number.isInteger(r)).toBe(true);
      seen.add(r);
    }
    // Over 5000 rolls every face should appear at least once.
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rollDie is an alias with identical behaviour', () => {
    const a = makeRng(55), b = makeRng(55);
    expect(Array.from({ length: 30 }, () => rollD6(a)))
      .toEqual(Array.from({ length: 30 }, () => rollDie(b)));
  });

  it('maps the rng floor boundaries correctly', () => {
    // rng = Math.floor(x*6)+1: 0 → 1, just-under-1 → 6
    expect(rollD6(() => 0)).toBe(1);
    expect(rollD6(() => 0.999999)).toBe(6);
    expect(rollD6(() => 0.5)).toBe(4);   // floor(3.0)+1
  });
});

describe('localRng', () => {
  it('returns a float in [0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const v = localRng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
