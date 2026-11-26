import { describe, expect, it } from 'vitest';
import { MemoryFs } from '../fs/memoryFs';
import { keepFeedback, loadFeedback, parseFeedback, summarizeFeedback } from './feedback';
import type { Game } from './types';

const file = (reviewer: string, date: string, cards: Record<string, { votes: string[]; note: string }>) =>
  JSON.stringify({ formatVersion: 1, kind: 'card-maker-feedback', game: 'Demo', gallery: 'g1', reviewer, date, cards });

describe('feedback', () => {
  it('reads a gallery feedback file and ignores unknown votes', () => {
    const f = parseFeedback(file('Ana', '2026-11-20', { 'core/c001': { votes: ['strong', 'strong', 'hack'], note: ' wow ' }, 'core/c002': { votes: [], note: '' } }));
    expect(f.reviewer).toBe('Ana');
    expect(f.cards).toEqual({ 'core/c001': { votes: ['strong'], note: 'wow' } });
    expect(() => parseFeedback('{"x":1}')).toThrow(/not a Cardinal feedback file/);
    expect(() => parseFeedback('nope')).toThrow(/not JSON/);
  });

  it('adds up per card; a newer file from the same person replaces the older one', () => {
    const s = summarizeFeedback([
      parseFeedback(file('Ana', '2026-11-19', { 'core/c001': { votes: ['weak'], note: 'old' } })),
      parseFeedback(file('ana', '2026-11-20', { 'core/c001': { votes: ['strong'], note: 'too good' } })),
      parseFeedback(file('Budi', '2026-11-20', { 'core/c001': { votes: ['strong', 'fun'], note: '' }, 'core/c003': { votes: ['confusing'], note: '' } })),
    ]);
    expect(s[0]).toMatchObject({ key: 'core/c001', reviewers: 2, votes: { strong: 2, fun: 1, weak: 0, confusing: 0 }, notes: [{ reviewer: 'ana', text: 'too good' }] });
    expect(s[1]!.key).toBe('core/c003');
  });

  it('keeps files in the game folder without overwriting', async () => {
    const fs = new MemoryFs('w');
    const game = { path: 'games/demo' } as Game;
    expect(await keepFeedback(fs, game, 'feedback-ana.json', file('Ana', '2026-11-20', {}))).toBe('feedback-ana.json');
    expect(await keepFeedback(fs, game, 'feedback-ana.json', file('Ana', '2026-11-21', {}))).toBe('feedback-ana-2.json');
    await expect(keepFeedback(fs, game, 'x.json', '{}')).rejects.toThrow();
    expect((await loadFeedback(fs, game)).files).toHaveLength(2);
  });
});
