import { describe, expect, it } from 'vitest';
import { editDistance, lintWording, similarity, wordingOf } from './lint';
import type { Card, CardSet, Game } from './types';

const game = {
  def: {
    fields: [
      { id: 'name', type: 'text', identifying: true },
      { id: 'rules', type: 'richtext' },
    ],
    keywords: [{ name: 'Shield', match: 'Shield {n:number}' }, { name: 'Swift', match: 'Swift' }],
  },
} as unknown as Game;

const set = (rules: string[]): CardSet => ({ id: 'core', cards: rules.map((r, i) => ({ id: `c${i}`, row: i + 2, values: { name: `Card ${i}`, rules: r } }) as Card) }) as CardSet;

describe('wording check', () => {
  it('measures words', () => {
    expect(editDistance('sheild', 'shield')).toBe(1);
    expect(wordingOf('Deal 2 damage to each *enemy* unit.')).toBe('deal # damage to each enemy unit');
    expect(similarity('deal # damage to each enemy unit', 'deals # damage to each enemy units')).toBeGreaterThan(0.8);
    expect(similarity('deal # damage to each enemy unit', 'draw # cards')).toBeLessThan(0.3);
  });

  it('finds misspelled and differently written keywords', () => {
    const f = lintWording(game, [set(['Sheild 2', 'swift, Shield 1', 'This swift unit attacks.', 'Shield 3'])], []);
    expect(f.find((x) => x.kind === 'keyword-typo')).toMatchObject({ suggestion: 'Shield', cards: [{ cardId: 'c0' }] });
    const kase = f.filter((x) => x.kind === 'keyword-case');
    expect(kase).toHaveLength(1);
    expect(kase[0]!.cards.map((c) => c.cardId)).toEqual(['c1']);
  });

  it('finds two wordings of the same effect and suggests the common one', () => {
    const f = lintWording(game, [set(['Deal 1 damage to each enemy unit.', 'Deal 3 damage to each enemy unit.', 'Deals 2 damage to each enemy units.', 'Draw 2 cards.'])], []);
    const two = f.filter((x) => x.kind === 'two-wordings');
    expect(two).toHaveLength(1);
    expect(two[0]!.suggestion).toBe('deal # damage to each enemy unit');
    expect(two[0]!.cards.map((c) => c.cardId).sort()).toEqual(['c0', 'c1', 'c2']);
  });

  it('applies house style rules and spots stray spaces', () => {
    const f = lintWording(game, [set(['Return all enemy units .', 'Enemy units  get -1.'])], [{ find: 'enemy units', use: 'enemies' }]);
    expect(f.find((x) => x.kind === 'style')!.cards).toHaveLength(2);
    expect(f.filter((x) => x.kind === 'spacing').map((x) => x.message).sort()).toEqual(['A space before a punctuation mark', 'Two spaces in a row']);
  });
});
