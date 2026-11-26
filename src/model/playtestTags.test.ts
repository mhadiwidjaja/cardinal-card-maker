import { describe, expect, it } from 'vitest';
import { copyTree } from '../fs/copy';
import { MemoryFs } from '../fs/memoryFs';
import { demoWorkspaceFs } from './demo';
import { loadWorkspace } from './load';
import { cardsText } from './save';
import { changedSince, createTag, diffCards, errataText, listTags, loadTag, sharedCards, tagSlug } from './playtestTags';

async function demoCopy() {
  const fs = new MemoryFs('copy');
  await copyTree(demoWorkspaceFs(), fs);
  return fs;
}

describe('playtest snapshots', () => {
  it('makes safe folder names', () => {
    expect(tagSlug('Playtest #3 (Friday)')).toBe('playtest-3-friday');
    expect(tagSlug('   ')).toBe('playtest');
  });

  it('snapshots, lists, and finds what changed since', async () => {
    const fs = await demoCopy();
    const game = (await loadWorkspace(fs)).games[0]!;
    const tag = await createTag(fs, game, 'Playtest 1', new Date('2026-11-01T10:00:00Z'));
    expect(tag.slug).toBe('playtest-1');
    expect(await fs.exists(`${game.path}/playtests/playtest-1/sets/core/cards.csv`)).toBe(true);
    expect((await createTag(fs, game, 'Playtest 1', new Date('2026-11-02T10:00:00Z'))).slug).toBe('playtest-1-2');
    expect((await listTags(fs, game)).map((t) => t.slug)).toEqual(['playtest-1-2', 'playtest-1']);

    const set = game.sets[0]!;
    const removed = set.cards[1]!.id;
    const cards = set.cards
      .filter((c) => c.id !== removed)
      .map((c) => (c.id === 'c001' ? { ...c, values: { ...c.values, cost: '2' } } : c));
    cards.push({ id: 'c999', row: 0, values: { id: 'c999', name: 'Brand New', template: 'unit', cost: '3' } });
    await fs.writeText(`${set.path}/cards.csv`, cardsText({ ...set, cards }), { force: true });

    const now = (await loadWorkspace(fs)).games[0]!;
    const then = await loadTag(fs, now, 'playtest-1');
    expect(then.path).toBe(now.path);
    const changes = diffCards(then, now);
    expect(changes.find((c) => c.cardId === 'c001')).toMatchObject({ kind: 'changed', fields: [{ field: 'cost', from: '1', to: '2' }] });
    expect(changes.find((c) => c.cardId === 'c999')?.kind).toBe('added');
    expect(changes.find((c) => c.cardId === removed)?.kind).toBe('removed');
    expect(changes).toHaveLength(3);
    expect(sharedCards(then, now).length).toBe(now.sets[0]!.cards.length - 1);

    expect(changedSince(then, now).filter((c) => c.looks)).toHaveLength(0);
    const spells = now.sets[0]!.cards.filter((c) => c.values.template === 'spell').length;
    const restyled = { ...now, templates: { ...now.templates, spell: { ...now.templates.spell!, orientation: 'landscape' as const } } };
    expect(changedSince(then, restyled).filter((c) => c.looks && !c.fields.length)).toHaveLength(spells);

    const errata = errataText(now, (await listTags(fs, now))[1]!, changes, ['Tide Caller']);
    expect(errata).toContain('Ember Scout\n  cost: 1 -> 2');
    expect(errata).toContain('NEW  Brand New');
    expect(errata).toContain('Tide Caller  (new look, same text)');
  });
});
