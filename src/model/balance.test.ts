import { describe, expect, it } from 'vitest';
import { costField, fitBalance, formulaTerm, learnedTerms } from './balance';
import type { Entry } from './stats';
import type { Card, CardSet, Game } from './types';

const game = {
  def: {
    fields: [
      { id: 'name', type: 'text', identifying: true },
      { id: 'template', type: 'choice', source: 'templates' },
      { id: 'cost', type: 'number' },
      { id: 'rules', type: 'richtext' },
      { id: 'attack', type: 'number' },
      { id: 'health', type: 'number' },
      { id: 'count', type: 'number', role: 'quantity' },
    ],
    keywords: [{ name: 'Shield', match: 'Shield {n:number}' }, { name: 'Swift', match: 'Swift' }],
  },
  templates: {},
} as unknown as Game;

// cost = 0.5 + 0.5 attack + 0.5 health + 1 per Shield point, except "Bargain", which is 2 too cheap.
const rows: [string, number, number, string, number][] = [
  ['a', 1, 1, '', 1.5],
  ['b', 2, 2, '', 2.5],
  ['c', 3, 1, '', 2.5],
  ['d', 1, 3, 'Shield 1', 3.5],
  ['e', 2, 4, 'Shield 2', 5.5],
  ['f', 4, 2, '', 3.5],
  ['g', 3, 3, 'Shield 1', 4.5],
  ['h', 5, 5, '', 5.5],
  ['Bargain', 4, 4, '', 2.5],
];
const set = { id: 'core', cards: [] as Card[] } as CardSet;
set.cards = rows.map(([name, attack, health, rules, cost], i) => ({ id: `c${i}`, row: i + 2, values: { name, template: 'unit', attack: String(attack), health: String(health), rules, cost: String(cost) } }));
const entries: Entry[] = set.cards.map((card) => ({ card, set }));

describe('balance lens', () => {
  it('finds the cost field', () => {
    expect(costField(game)).toBe('cost');
  });

  it('learns what attack, health and keywords are worth, and spots the bargain', () => {
    const terms = learnedTerms(game, entries);
    expect(terms.map((t) => t.label)).toEqual(['attack', 'health', 'Shield']);
    const fit = fitBalance(game, entries, terms, 0.01);
    if ('error' in fit) throw new Error(fit.error);
    const worst = [...fit.rows].sort((a, b) => a.residual - b.residual)[0]!;
    expect(worst.entry.card.values.name).toBe('Bargain');
    expect(worst.residual).toBeLessThan(-1);
    const shield = fit.worth.find((w) => w.term.label === 'Shield')!.worth;
    expect(shield).toBeGreaterThan(0.6);
  });

  it('fits a value formula, and refuses too few cards', () => {
    const fit = fitBalance(game, entries, [formulaTerm(game, 'attack + health')], 0);
    if ('error' in fit) throw new Error(fit.error);
    expect(fit.worth[0]!.worth).toBeGreaterThan(0.3);
    expect(fitBalance(game, entries.slice(0, 4), learnedTerms(game, entries))).toHaveProperty('error');
  });
});
