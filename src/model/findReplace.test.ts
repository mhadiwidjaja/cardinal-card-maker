import { describe, expect, it } from 'vitest';
import { findReplace, type FindOptions } from './findReplace';
import type { CardSet, Game } from './types';

const game = {
  def: {
    fields: [
      { id: 'name', type: 'text' },
      { id: 'rules', type: 'richtext' },
      { id: 'power', type: 'number', computed: '{cost} * 2' },
    ],
  },
} as unknown as Game;

const set = {
  cards: [
    { id: 'a', row: 2, values: { id: 'a', name: 'Shield Bearer', rules: 'Shield 2. Shields up! shield' } },
    { id: 'b', row: 3, values: { id: 'b', name: 'Scout', rules: 'Draw a card.', power: 'Shield' } },
    { id: 'c', row: 4, values: { id: 'c', name: 'Bouclier élevé', rules: 'Shieldé' } },
  ],
} as unknown as CardSet;

const base: FindOptions = { find: 'Shield', replace: 'Ward', column: null, matchCase: false, wholeWord: false, only: null };

describe('findReplace', () => {
  it('replaces in every editable column, ignoring case', () => {
    const r = findReplace(game, set, base);
    expect(r.matches).toBe(5);
    expect(r.cards).toBe(2);
    expect(r.changed.get(0)).toMatchObject({ name: 'Ward Bearer', rules: 'Ward 2. Wards up! Ward' });
    expect(r.changed.has(1)).toBe(false);
  });

  it('matches case and whole words when asked', () => {
    const r = findReplace(game, set, { ...base, matchCase: true, wholeWord: true });
    expect(r.changed.get(0)!.rules).toBe('Ward 2. Shields up! shield');
    expect(r.changed.get(0)!.name).toBe('Ward Bearer');
    expect(r.changed.has(2)).toBe(false);
  });

  it('limits to one column and to chosen cards', () => {
    expect(findReplace(game, set, { ...base, column: 'name' }).matches).toBe(1);
    expect(findReplace(game, set, { ...base, only: [2] }).matches).toBe(1);
  });

  it('treats the texts literally', () => {
    const s = { cards: [{ id: 'x', row: 2, values: { rules: 'Cost (2) + [fire]' } }] } as unknown as CardSet;
    const r = findReplace(game, s, { ...base, find: '(2) + [fire]', replace: '$& $1' });
    expect(r.changed.get(0)!.rules).toBe('Cost $& $1');
  });

  it('does nothing for an empty search', () => {
    expect(findReplace(game, set, { ...base, find: '' }).matches).toBe(0);
  });
});
