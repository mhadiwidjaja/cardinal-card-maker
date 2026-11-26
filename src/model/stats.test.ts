import { describe, expect, it } from 'vitest';
import { demoWorkspaceFs } from './demo';
import { loadWorkspace } from './load';
import { countBy, crossCount, dimensionsFor, numericSummary, weightFn, type Entry } from './stats';

async function demo() {
  const game = (await loadWorkspace(demoWorkspaceFs())).games[0]!;
  const set = game.sets[0]!;
  const entries: Entry[] = set.cards.map((card) => ({ card, set }));
  const dims = dimensionsFor(game);
  const dim = (id: string) => dims.find((d) => d.id === id)!;
  return { game, entries, dims, dim };
}

describe('statistics', () => {
  it('uses configured dimensions first, then other countable fields', async () => {
    const { dims } = await demo();
    expect(dims.map((d) => d.id)).toEqual(['cost', 'element', 'rarity', 'template', 'attack', 'health']);
  });

  it('counts a numeric field as a curve with empty bins filled', async () => {
    const { game, entries, dim } = await demo();
    const r = countBy(game, entries, dim('cost'), weightFn(game, false));
    expect(r.groups.map((g) => `${g.label}:${g.value}`)).toEqual(['1:3', '2:4', '3:2', '4:3', '5:1', '6:1']);
    expect(r.total).toBe(14);
  });

  it('bins numbers', async () => {
    const { game, entries, dim } = await demo();
    const r = countBy(game, entries, { ...dim('cost'), bin: 2 }, weightFn(game, false));
    expect(r.groups.map((g) => `${g.label}:${g.value}`)).toEqual(['0–1:3', '2–3:6', '4–5:4', '6–7:1']);
  });

  it('splits multi-value fields and keeps the configured order', async () => {
    const { game, entries, dim } = await demo();
    const r = countBy(game, entries, dim('element'), weightFn(game, false));
    expect(r.groups.map((g) => `${g.label}:${g.value}`)).toEqual(['Fire:5', 'Water:6', 'Earth:5']);
  });

  it('can count copies instead of cards', async () => {
    const { game, entries, dim } = await demo();
    const r = countBy(game, entries, dim('rarity'), weightFn(game, true));
    expect(r.groups.map((g) => `${g.label}:${g.value}`)).toEqual(['Common:18', 'Uncommon:10', 'Rare:3']);
    expect(r.total).toBe(31);
  });

  it('counts blanks separately and shows template names', async () => {
    const { game, entries, dim } = await demo();
    expect(countBy(game, entries, dim('attack'), weightFn(game, false)).blank).toBe(5);
    expect(countBy(game, entries, dim('template'), weightFn(game, false)).groups.map((g) => g.label)).toEqual(['Unit', 'Spell']);
  });

  it('cross-tabulates two dimensions', async () => {
    const { game, entries, dim } = await demo();
    const r = crossCount(game, entries, dim('cost'), dim('element'), weightFn(game, false));
    expect(r.series).toEqual(['Fire', 'Water', 'Earth']);
    expect(r.cells[3]).toEqual([1, 2, 1]);
  });

  it('summarises numbers', async () => {
    const { game, entries } = await demo();
    expect(numericSummary(game, entries, 'cost', weightFn(game, false))).toMatchObject({ count: 14, min: 1, max: 6, median: 2 });
  });
});
