import { describe, expect, it } from 'vitest';
import { MemoryFs } from '../fs/memoryFs';
import { newGame, scaleTemplate } from './gameOps';
import { loadWorkspace } from './load';
import { cardsText, gameText, setText, templateText } from './save';
import type { TemplateDef } from './types';

describe('scaleTemplate', () => {
  it('scales positions, sizes and nested layers', () => {
    const t: TemplateDef = {
      formatVersion: 1,
      id: 't',
      faces: {
        front: {
          layers: [
            { id: 'a', type: 'text', text: '', rect: [10, 20, 30, 40], font: { family: 'serif', size: 10 }, shrink: { min: 5 }, stroke: { color: '#000', width: 2 } },
            { id: 'g', type: 'group', offset: [4, 4], layers: [{ id: 'p', type: 'shape', shape: 'polygon', points: [[1, 2], [3, 4], [5, 6]] }] },
          ] as never,
        },
      },
    };
    const s = scaleTemplate(t, 2);
    expect(s.faces.front!.layers![0]).toMatchObject({ rect: [20, 40, 60, 80], font: { size: 20 }, shrink: { min: 10 }, stroke: { width: 4 } });
    expect(s.faces.front!.layers![1]).toMatchObject({ offset: [8, 8], layers: [{ points: [[2, 4], [6, 8], [10, 12]] }] });
    expect(t.faces.front!.layers![0]).toMatchObject({ rect: [10, 20, 30, 40] });
  });
});

describe('newGame', () => {
  it('creates a game that saves and loads back with no issues', async () => {
    const g = newGame('Star Duel', 'star-duel', 'games/star-duel', { w: 63, h: 88 });
    const fs = new MemoryFs('ws', {
      'games/star-duel/game.json': gameText(g.def),
      ...Object.fromEntries(Object.values(g.templates).map((t) => [`games/star-duel/templates/${t.id}.json`, templateText(t)])),
      'games/star-duel/sets/core/set.json': setText(g.sets[0]!.def),
      'games/star-duel/sets/core/cards.csv': cardsText(g.sets[0]!),
    });
    const ws = await loadWorkspace(fs);
    expect(ws.issues).toEqual([]);
    expect(ws.games[0]!.def.name).toBe('Star Duel');
    expect(ws.games[0]!.sets[0]!.cards[0]!.values.name).toBe('First Card');
  });

  it('fits the starter layout to other card sizes', () => {
    const g = newGame('Tarot', 'tarot', 'games/tarot', { w: 70, h: 120 });
    const bg = g.templates._base!.faces.front!.layers![0] as { rect: number[] };
    expect(bg.rect).toEqual([0, 0, 898, 1488]);
  });
});
