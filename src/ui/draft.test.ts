import { describe, expect, it } from 'vitest';
import { copyTree } from '../fs/copy';
import { MemoryFs } from '../fs/memoryFs';
import { demoWorkspaceFs } from '../model/demo';
import { newGame } from '../model/gameOps';
import type { Workspace } from '../model/types';
import { dirtyKey, gameKey, type Dirty } from './dirty';
import { buildDraft, changedOnDisk, DraftOverlay, hashText, loadRecording, restoreDraft } from './draft';

async function demoCopy() {
  const fs = new MemoryFs('ws');
  await copyTree(demoWorkspaceFs(), fs);
  const { workspace, bases } = await loadRecording(fs);
  return { fs, workspace, bases };
}

function renameFirstCard(ws: Workspace, name: string): Workspace {
  const g = ws.games[0]!;
  const s = g.sets[0]!;
  const cards = s.cards.map((c, i) => (i === 0 ? { ...c, values: { ...c.values, name } } : c));
  return { ...ws, games: [{ ...g, sets: [{ ...s, cards }] }] };
}

describe('recovery draft', () => {
  it('records a base hash for every file read on load', async () => {
    const { fs, bases } = await demoCopy();
    const csv = 'games/demo-game/sets/core/cards.csv';
    expect(bases.get(csv)).toBe(hashText(await fs.readText(csv)));
  });

  it('builds nothing when nothing is unsaved', async () => {
    const { workspace, bases } = await demoCopy();
    expect(buildDraft('k', workspace, [], bases)).toBeNull();
  });

  it('restores an edited card and marks it unsaved, without touching the files', async () => {
    const { fs, workspace, bases } = await demoCopy();
    const g = workspace.games[0]!;
    const edited = renameFirstCard(workspace, 'Blaze Scout');
    const dirty: Dirty[] = [{ kind: 'cards', game: gameKey(g), set: g.sets[0]!.id }];
    const draft = buildDraft('k', edited, dirty, bases, 1000)!;
    expect(draft.files).toHaveLength(1);
    expect(changedOnDisk(draft, bases)).toEqual([]);

    const before = await fs.readText('games/demo-game/sets/core/cards.csv');
    const r = await restoreDraft(fs, draft);
    expect(r.workspace.games[0]!.sets[0]!.cards[0]!.values.name).toBe('Blaze Scout');
    expect([...r.dirty.keys()]).toEqual([dirtyKey(dirty[0]!)]);
    expect(await fs.readText('games/demo-game/sets/core/cards.csv')).toBe(before);
    expect(r.workspace.issues).toEqual([]);
  });

  it('notices a drafted file that changed on disk since the edits', async () => {
    const { fs, workspace, bases } = await demoCopy();
    const g = workspace.games[0]!;
    const draft = buildDraft('k', renameFirstCard(workspace, 'X'), [{ kind: 'cards', game: gameKey(g), set: 'core' }], bases)!;
    fs.externalWrite('games/demo-game/sets/core/cards.csv', 'id,name\r\nc001,Changed in Excel\r\n');
    const now = await loadRecording(fs);
    expect(changedOnDisk(draft, now.bases)).toEqual(['games/demo-game/sets/core/cards.csv']);
  });

  it('re-applies a template deletion as a pending deletion', async () => {
    const { fs, workspace, bases } = await demoCopy();
    const g = workspace.games[0]!;
    const { spell: _gone, ...templates } = g.templates;
    const ws: Workspace = { ...workspace, games: [{ ...g, templates }] };
    const del: Dirty = { kind: 'templateDelete', game: gameKey(g), id: 'spell', path: 'games/demo-game/templates/spell.json' };
    const draft = buildDraft('k', ws, [del], bases)!;
    expect(draft.files[0]).toMatchObject({ path: del.path, text: null });

    const r = await restoreDraft(fs, draft);
    expect(Object.keys(r.workspace.games[0]!.templates)).not.toContain('spell');
    expect(r.dirty.get(dirtyKey(del))).toEqual(del);
    expect(await fs.exists(del.path)).toBe(true);
  });

  it('restores a new game that only exists in the draft', async () => {
    const { fs, workspace, bases } = await demoCopy();
    const game = newGame('Star Duel', 'star-duel', 'games/star-duel', { w: 63, h: 88 });
    const ws: Workspace = { ...workspace, games: [...workspace.games, game] };
    const key = gameKey(game);
    const dirty: Dirty[] = [
      { kind: 'game', game: key },
      ...Object.keys(game.templates).map((id) => ({ kind: 'template', game: key, id }) as Dirty),
      ...game.sets.flatMap((s) => [{ kind: 'set', game: key, set: s.id } as Dirty, { kind: 'cards', game: key, set: s.id } as Dirty]),
    ];
    const draft = buildDraft('k', ws, dirty, bases)!;
    const r = await restoreDraft(fs, draft);
    expect(r.workspace.games.map((g) => g.id)).toEqual(['demo-game', 'star-duel']);
    expect(r.workspace.games[1]!.sets.map((s) => s.id)).toEqual(game.sets.map((s) => s.id));
    expect(r.dirty.size).toBe(dirty.length);
    expect(await fs.exists('games/star-duel')).toBe(false);
  });

  it('the overlay lists new folders and hides deleted files', async () => {
    const fs = new MemoryFs('ws', { 'a/x.json': '{}', 'a/y.json': '{}' });
    const overlay = new DraftOverlay(fs, {
      formatVersion: 1,
      key: 'k',
      savedAt: 0,
      dirty: [],
      files: [
        { path: 'a/y.json', text: null, base: null },
        { path: 'a/new/z.json', text: '{"z":1}', base: null },
      ],
    });
    expect((await overlay.list('a')).map((e) => `${e.name}:${e.kind}`)).toEqual(['new:directory', 'x.json:file']);
    expect(await overlay.exists('a/y.json')).toBe(false);
    expect(await overlay.readText('a/new/z.json')).toBe('{"z":1}');
    expect(await overlay.list('a/new')).toEqual([{ name: 'z.json', kind: 'file' }]);
  });
});
