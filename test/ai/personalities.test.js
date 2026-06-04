import { describe, it, expect } from 'vitest';
import { PERSONALITIES, getPersonality } from '../../src/ai/personalities.js';

describe('getPersonality', () => {
  it('returns the named personality for every defined key', () => {
    for (const key of Object.keys(PERSONALITIES)) {
      expect(getPersonality(key)).toBe(PERSONALITIES[key]);
    }
  });

  it('falls back to balanced for an unknown key', () => {
    expect(getPersonality('unknown')).toBe(PERSONALITIES.balanced);
    expect(getPersonality(undefined)).toBe(PERSONALITIES.balanced);
    expect(getPersonality('')).toBe(PERSONALITIES.balanced);
  });

  it('every personality has the five expected weight dimensions', () => {
    const DIMS = ['kill', 'vp', 'survival', 'objective', 'momentum'];
    for (const [key, p] of Object.entries(PERSONALITIES)) {
      for (const dim of DIMS) {
        expect(p.weights[dim], `${key}.weights.${dim}`).toBeTypeOf('number');
        expect(p.weights[dim]).toBeGreaterThan(0);
      }
    }
  });

  it('every personality has a non-empty label and systemPrompt', () => {
    for (const [key, p] of Object.entries(PERSONALITIES)) {
      expect(p.label, `${key}.label`).toBeTypeOf('string');
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.systemPrompt, `${key}.systemPrompt`).toBeTypeOf('string');
      expect(p.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it('aggressive has higher kill weight than defensive', () => {
    expect(PERSONALITIES.aggressive.weights.kill)
      .toBeGreaterThan(PERSONALITIES.defensive.weights.kill);
  });

  it('positional has higher vp weight than aggressive', () => {
    expect(PERSONALITIES.positional.weights.vp)
      .toBeGreaterThan(PERSONALITIES.aggressive.weights.vp);
  });

  it('defensive has higher survival weight than opportunist', () => {
    expect(PERSONALITIES.defensive.weights.survival)
      .toBeGreaterThan(PERSONALITIES.opportunist.weights.survival);
  });
});
