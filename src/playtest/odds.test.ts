import { describe, expect, it } from 'vitest';
import { atLeast, cardsSeen, hypergeometric } from './odds';

describe('draw odds', () => {
  it('matches known values', () => {
    expect(atLeast(60, 4, 7, 1)).toBeCloseTo(0.3995, 3);
    expect(atLeast(40, 3, 5, 1)).toBeCloseTo(1 - (37 * 36 * 35 * 34 * 33) / (40 * 39 * 38 * 37 * 36), 10);
    const sum = [0, 1, 2, 3, 4].reduce((s, x) => s + hypergeometric(60, 4, 7, x), 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('handles the edges', () => {
    expect(atLeast(30, 0, 5, 1)).toBe(0);
    expect(atLeast(30, 30, 5, 5)).toBeCloseTo(1, 10);
    expect(atLeast(30, 5, 40, 5)).toBeCloseTo(1, 10);
    expect(atLeast(30, 5, 5, 0)).toBe(1);
    expect(atLeast(30, 2, 5, 3)).toBe(0);
  });

  it('counts the cards seen by a turn', () => {
    expect(cardsSeen(5, 1, 1, true)).toBe(5);
    expect(cardsSeen(5, 1, 1, false)).toBe(6);
    expect(cardsSeen(7, 2, 3, true)).toBe(11);
  });
});
