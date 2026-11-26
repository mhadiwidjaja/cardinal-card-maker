import { describe, expect, it } from 'vitest';
import { blankCard, cardProblems, filterCards, fromTsv, importRows, newCardId, sortIndices, toTsv } from './cardOps';
import { demoWorkspaceFs } from './demo';
import { loadWorkspace } from './load';

async function demo() {
  const game = (await loadWorkspace(demoWorkspaceFs())).games[0]!;
  return { game, set: game.sets[0]! };
}

describe('ids and blank cards', () => {
  it('continues the id pattern', async () => {
    const { set } = await demo();
    expect(newCardId(set)).toBe('c015');
    expect(newCardId(set, new Set(['c015']))).toBe('c016');
  });

  it('creates a blank card with a template preselected', async () => {
    const { game, set } = await demo();
    const c = blankCard(game, set);
    expect(c.id).toBe('c015');
    expect(c.values.template).toBe('spell');
    expect(c.values.name).toBe('');
  });
});

describe('cardProblems', () => {
  it('flags bad numbers, choices and templates', async () => {
    const { game, set } = await demo();
    const card = { ...set.cards[0]!, values: { ...set.cards[0]!.values, cost: 'two', rarity: 'Mythic', template: 'nope', element: 'Fire, Air' } };
    const p = cardProblems(game, card);
    expect(p.get('cost')).toBe('"two" is not a number');
    expect(p.get('rarity')).toMatch(/"Mythic" is not one of/);
    expect(p.get('template')).toBe('no template named "nope"');
    expect(p.get('element')).toMatch(/"Air" is not one of/);
    expect(cardProblems(game, set.cards[0]!).size).toBe(0);
  });

  it('checks min and max', async () => {
    const { game, set } = await demo();
    expect(cardProblems(game, { ...set.cards[0]!, values: { ...set.cards[0]!.values, cost: '-1' } }).get('cost')).toMatch(/below the minimum/);
  });
});

describe('importRows', () => {
  it('replaces all cards, matching columns by name or label ignoring case', async () => {
    const { game, set } = await demo();
    const { set: out, report } = importRows(game, set, [['Name', 'COST', 'Subtype', 'extra'], ['A', '1', 'Elf', 'x'], ['', '', '', '']], 'replace');
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0]!.values).toMatchObject({ name: 'A', cost: '1', subtype: 'Elf', extra: 'x' });
    expect(report).toMatchObject({ added: 1, removed: 14, unknownColumns: ['extra'] });
    expect(out.columns).toContain('extra');
  });

  it('merges by id: updates given columns, adds new rows', async () => {
    const { game, set } = await demo();
    const { set: out, report } = importRows(game, set, [['id', 'cost'], ['c001', '9'], ['new1', '2']], 'merge');
    expect(report).toMatchObject({ updated: 1, added: 1 });
    expect(out.cards[0]!.values).toMatchObject({ name: 'Ember Scout', cost: '9' });
    expect(out.cards[14]!.id).toBe('new1');
  });

  it('lists what changes: field changes by card name, added and removed cards', async () => {
    const { game, set } = await demo();
    const merged = importRows(game, set, [['id', 'name', 'cost'], ['c001', 'Ember Scout', '9'], ['new1', 'Fresh', '2']], 'merge').report;
    expect(merged.changes).toEqual([
      { kind: 'changed', card: 'Ember Scout', field: 'cost', from: set.cards[0]!.values.cost, to: '9' },
      { kind: 'added', card: 'Fresh' },
    ]);
    const replaced = importRows(game, set, [['name'], ['Only One']], 'replace').report;
    expect(replaced.changes.filter((c) => c.kind === 'removed')).toHaveLength(14);
    expect(replaced.changes).toContainEqual({ kind: 'removed', card: 'Ember Scout' });
    expect(replaced.changes).toContainEqual({ kind: 'added', card: 'Only One' });
  });

  it('names a card without a name by its id', async () => {
    const { game, set } = await demo();
    const r = importRows(game, set, [['id', 'cost'], ['x9', '1']], 'append').report;
    expect(r.changes).toEqual([{ kind: 'added', card: 'x9' }]);
  });

  it('appends with fresh ids when ids collide', async () => {
    const { game, set } = await demo();
    const { set: out } = importRows(game, set, [['id', 'name'], ['c001', 'Copy']], 'append');
    expect(out.cards).toHaveLength(15);
    expect(out.cards[14]!.id).toBe('c015');
  });
});

describe('filter and sort', () => {
  it('filters by words and by expressions', async () => {
    const { game, set } = await demo();
    expect(filterCards(game, set, 'water rare').indices.map((i) => set.cards[i]!.values.name)).toEqual(['Maelstrom', 'Steam Elemental']);
    expect(filterCards(game, set, "= cost >= 5 and template == 'unit'").indices.map((i) => set.cards[i]!.values.name)).toEqual(['Pyre Titan']);
    expect(filterCards(game, set, '= cost >').error).toBeTruthy();
  });

  it('sorts numbers numerically and choices in their defined order, blanks last', async () => {
    const { game, set } = await demo();
    const all = set.cards.map((_, i) => i);
    const byCost = sortIndices(game, set, all, 'cost', -1).map((i) => set.cards[i]!.values.cost);
    expect(byCost.slice(0, 3)).toEqual(['6', '5', '4']);
    const byRarity = sortIndices(game, set, all, 'rarity', 1).map((i) => set.cards[i]!.values.rarity);
    expect(byRarity[0]).toBe('Common');
    expect(byRarity[13]).toBe('Rare');
    const bySubtype = sortIndices(game, set, all, 'subtype', -1).map((i) => set.cards[i]!.values.subtype);
    expect(bySubtype[13]).toBe('');
  });
});

describe('clipboard', () => {
  it('round-trips tab-separated text including line breaks', () => {
    const rows = [
      ['a', 'b\nc'],
      ['d"e', ''],
    ];
    expect(fromTsv(toTsv(rows))).toEqual(rows);
  });

  it('reads a single cell as is', () => {
    expect(fromTsv('hello "world"')).toEqual([['hello "world"']]);
  });
});
