import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { demoWorkspaceFs } from './demo';
import { loadWorkspace } from './load';
import { cardsText, prettyJson, templateText } from './save';

describe('prettyJson', () => {
  it('keeps short values on one line', () => {
    expect(prettyJson({ a: 1, b: [1, 2] })).toBe('{ "a": 1, "b": [1, 2] }');
  });

  it('expands long objects and lists of objects', () => {
    const out = prettyJson({ layers: [{ id: 'a', rect: [0, 0, 10, 10] }] });
    expect(out).toBe('{\n  "layers": [\n    { "id": "a", "rect": [0, 0, 10, 10] }\n  ]\n}');
  });

  it('round-trips', () => {
    const v = { x: [1, { y: 'z'.repeat(150) }], n: null, t: true };
    expect(JSON.parse(prettyJson(v))).toEqual(v);
  });
});

describe('saving the demo', () => {
  it('template files round-trip', async () => {
    const game = (await loadWorkspace(demoWorkspaceFs())).games[0]!;
    for (const t of Object.values(game.templates)) expect(JSON.parse(templateText(t))).toEqual(t);
  });

  it('cards.csv round-trips', async () => {
    const set = (await loadWorkspace(demoWorkspaceFs())).games[0]!.sets[0]!;
    const table = parseCsv(cardsText(set));
    expect(table.columns).toEqual(set.columns);
    expect(table.rows).toEqual(set.cards.map((c) => c.values));
  });
});
