import { describe, expect, it } from 'vitest';
import { MemoryFs } from '../fs/memoryFs';
import { demoWorkspaceFs } from './demo';
import { loadWorkspace, NOT_UTF8_WARNING } from './load';

const minimalGame = JSON.stringify({
  formatVersion: 1,
  name: 'Mini',
  card: { widthMm: 63, heightMm: 88, dpi: 300 },
  fields: [
    { id: 'name', type: 'text' },
    { id: 'template', type: 'choice', source: 'templates' },
    { id: 'cost', type: 'number' },
    { id: 'rarity', type: 'choice', choices: ['Common', 'Rare'] },
  ],
});
const template = (id: string, extra: object = {}) => JSON.stringify({ id, faces: { front: { layers: [] } }, ...extra });

describe('loadWorkspace: demo workspace', () => {
  it('loads with no errors', async () => {
    const ws = await loadWorkspace(demoWorkspaceFs());
    expect(ws.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(ws.name).toBe('Demo Workspace');
    expect(ws.games.map((g) => g.id)).toEqual(['demo-game']);
  });

  it('reads the game, templates and cards', async () => {
    const game = (await loadWorkspace(demoWorkspaceFs())).games[0]!;
    expect(game.def.name).toBe('Demo Game');
    expect(game.def.card).toMatchObject({ widthMm: 63, heightMm: 88, bleedMm: 3, dpi: 300 });
    expect(Object.keys(game.templates).sort()).toEqual(['_base', 'back', 'spell', 'unit']);
    expect(game.sets).toHaveLength(1);
    const set = game.sets[0]!;
    expect(set.def.name).toBe('Core Set');
    expect(set.cards).toHaveLength(14);
    expect(set.cards[3]!.values.rules).toBe('Shield 2\nWhen Pyre Titan enters, deal 2 damage to every other unit.');
  });

  it('every demo row has exactly as many cells as the header', async () => {
    const ws = await loadWorkspace(demoWorkspaceFs());
    expect(ws.issues).toEqual([]);
  });
});

describe('loadWorkspace: layouts', () => {
  it('accepts a single game folder opened directly', async () => {
    const fs = new MemoryFs('my-game', { 'game.json': minimalGame, 'templates/unit.json': template('unit') });
    const ws = await loadWorkspace(fs);
    expect(ws.games.map((g) => g.id)).toEqual(['my-game']);
    expect(ws.issues).toEqual([]);
  });

  it('loads several games and skips folders without game.json', async () => {
    const fs = new MemoryFs('ws', {
      'games/a/game.json': minimalGame,
      'games/b/game.json': minimalGame,
      'games/notes/readme.txt': 'hi',
    });
    const ws = await loadWorkspace(fs);
    expect(ws.games.map((g) => g.id)).toEqual(['a', 'b']);
    expect(ws.issues).toEqual([{ level: 'warning', file: 'games/notes', message: 'Folder has no game.json, so it was skipped' }]);
  });

  it('warns when cards.csv is not UTF-8 (shown as replacement characters)', async () => {
    const bad = 'name,cost\nCaf' + String.fromCharCode(0xfffd) + ',1\n';
    const fs = new MemoryFs('g', { 'game.json': minimalGame, 'sets/core/cards.csv': bad });
    const ws = await loadWorkspace(fs);
    expect(ws.issues).toEqual([{ level: 'warning', file: 'sets/core/cards.csv', message: NOT_UTF8_WARNING }]);
  });

  it('warns when the folder has no games', async () => {
    const ws = await loadWorkspace(new MemoryFs('empty', { 'notes.txt': '' }));
    expect(ws.games).toEqual([]);
    expect(ws.issues[0]!.message).toMatch(/No games found/);
  });
});

describe('loadWorkspace: problems are reported, not thrown', () => {
  it('reports invalid JSON and keeps loading other games', async () => {
    const fs = new MemoryFs('ws', { 'games/bad/game.json': '{ nope', 'games/good/game.json': minimalGame });
    const ws = await loadWorkspace(fs);
    expect(ws.games.map((g) => g.id)).toEqual(['good']);
    expect(ws.issues[0]).toMatchObject({ level: 'error', file: 'games/bad/game.json' });
    expect(ws.issues[0]!.message).toMatch(/Not valid JSON/);
  });

  it('reports missing card size and bad fields', async () => {
    const fs = new MemoryFs('g', {
      'game.json': JSON.stringify({ name: 'X', fields: [{ id: '1bad', type: 'text' }, { id: 'a', type: 'weird' }] }),
    });
    const msgs = (await loadWorkspace(fs)).issues.map((i) => i.message);
    expect(msgs).toContain('"card" (card size settings) is required');
    expect(msgs.some((m) => m.startsWith('fields[0]: "id" must start with a letter'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('Field "a": type must be one of'))).toBe(true);
  });

  it('refuses files from a newer app version', async () => {
    const fs = new MemoryFs('g', { 'game.json': JSON.stringify({ ...JSON.parse(minimalGame), formatVersion: 99 }) });
    const ws = await loadWorkspace(fs);
    expect(ws.games).toEqual([]);
    expect(ws.issues[0]!.message).toMatch(/newer version/);
  });

  it('reports broken template references and extends loops', async () => {
    const fs = new MemoryFs('g', {
      'game.json': minimalGame,
      'templates/a.json': template('a', { extends: 'b' }),
      'templates/b.json': template('b', { extends: 'a' }),
      'templates/c.json': template('c', { extends: 'missing', faces: { front: {}, back: { useTemplate: 'nope' } } }),
    });
    const msgs = (await loadWorkspace(fs)).issues.map((i) => `${i.file}: ${i.message}`);
    expect(msgs).toContain('templates/c.json: extends "missing", which doesn\'t exist');
    expect(msgs).toContain('templates/c.json: faces.back uses template "nope", which doesn\'t exist');
    expect(msgs.some((m) => m.startsWith('templates/a.json: "extends" loops back'))).toBe(true);
  });

  it('checks card values against field types', async () => {
    const fs = new MemoryFs('g', {
      'game.json': minimalGame,
      'templates/unit.json': template('unit'),
      'sets/core/cards.csv': 'name,template,cost,rarity,notes\nA,unit,two,common,\nB,spel,1,Mythic,\n',
    });
    const ws = await loadWorkspace(fs);
    expect(ws.issues.map((i) => i.message)).toEqual([
      'Columns not defined in game.json (kept, but not used): notes',
      'Row 2, cost: "two" is not a number',
      'Row 3, template: no template named "spel"',
      'Row 3, rarity: "Mythic" is not one of Common, Rare',
    ]);
    expect(ws.games[0]!.sets[0]!.cards[0]!.values.cost).toBe('two');
  });

  it('matches CSV headers to fields ignoring case', async () => {
    const fs = new MemoryFs('g', {
      'game.json': minimalGame,
      'sets/s/cards.csv': 'ID,Name,COST\nx1,A,3\n',
    });
    const set = (await loadWorkspace(fs)).games[0]!.sets[0]!;
    expect(set.columns).toEqual(['id', 'name', 'cost']);
    expect(set.cards[0]).toMatchObject({ id: 'x1', values: { id: 'x1', name: 'A', cost: '3' } });
  });

  it('generates ids for rows without one and warns about duplicates', async () => {
    const fs = new MemoryFs('g', {
      'game.json': minimalGame,
      'sets/s/cards.csv': 'id,name\n,A\nx,B\nx,C\n',
    });
    const ws = await loadWorkspace(fs);
    expect(ws.games[0]!.sets[0]!.cards.map((c) => c.id)).toEqual(['s-row2', 'x', 'x']);
    expect(ws.issues.map((i) => i.message)).toEqual(['Row 4: id "x" is used by another card']);
  });
});
