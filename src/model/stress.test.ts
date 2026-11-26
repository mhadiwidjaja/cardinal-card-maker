import { describe, expect, it } from 'vitest';
import { demoWorkspaceFs } from './demo';
import { loadWorkspace } from './load';
import { neverShown, stressCards, switchFields } from './stress';

describe('template stress test (demo game)', async () => {
  const ws = await loadWorkspace(demoWorkspaceFs());
  const game = ws.games[0]!;

  it('finds the fields the unit template switches on', () => {
    const ids = switchFields(game, 'unit').map((f) => f.id);
    expect(ids).toContain('element');
    expect(ids).toContain('rarity');
    expect(ids).not.toContain('template');
  });

  it('builds worst cases and every combination', () => {
    const cards = stressCards(game, 'unit');
    const longest = cards.find((c) => c.label === 'Every field at its longest')!;
    const unitRules = game.sets[0]!.cards.filter((c) => c.values.template === 'unit').map((c) => c.values.rules ?? '');
    expect(longest.card.values.rules!.length).toBe(Math.max(...unitRules.map((r) => r.length)));
    expect(longest.card.values.template).toBe('unit');
    expect(cards.some((c) => c.label === 'Optional fields empty')).toBe(true);
    const combos = cards.filter((c) => c.label.includes('element = '));
    expect(combos.length).toBeGreaterThan(4);
    expect(new Set(combos.map((c) => c.card.id)).size).toBe(combos.length);
  });

  it('lists layers no card shows', () => {
    expect(neverShown(game, 'spell').map((n) => n.layer)).toContain('flavor');
    expect(neverShown(game, 'unit').map((n) => n.layer)).not.toContain('flavor');
  });
});
