import { joinPath } from '../fs/types';
import { cardsText, gameText, setText, templatePath, templateText } from '../model/save';
import type { Game } from '../model/types';

export type Dirty =
  | { kind: 'template'; game: string; id: string }
  | { kind: 'templateDelete'; game: string; id: string; path: string }
  | { kind: 'cards'; game: string; set: string }
  | { kind: 'set'; game: string; set: string }
  | { kind: 'game'; game: string };

export type DirtyMap = Map<string, Dirty>;

export const gameKey = (g: Game) => g.path || g.id;

export const dirtyKey = (d: Dirty | { kind: string; game: string; id?: string; set?: string }) =>
  JSON.stringify([d.kind, d.game, 'id' in d ? d.id : undefined, 'set' in d ? d.set : undefined]);

/** Adds edits to the map. Every call stores new objects, so a later edit can be told apart from an earlier one. */
export function withDirty(prev: DirtyMap, items: Dirty[]): DirtyMap {
  const next = new Map(prev);
  for (const d of items) {
    // A save of a template cancels its pending delete and vice versa.
    if (d.kind === 'template') next.delete(dirtyKey({ kind: 'templateDelete', game: d.game, id: d.id }));
    next.set(dirtyKey(d), { ...d });
  }
  return next;
}

/**
 * The dirty map after a save. Only entries that were written AND have not been
 * edited again since (still the very same object) are removed. An edit made
 * while the save was running replaced its entry with a new object, so it stays
 * marked and is written by the next save.
 */
export function afterSave(current: DirtyMap, written: DirtyMap): DirtyMap {
  const next = new Map(current);
  for (const [key, d] of written) if (next.get(key) === d) next.delete(key);
  return next;
}

/**
 * The file a dirty entry stands for, and the text to write into it
 * (null = delete the file). Used by Save and by the recovery draft, so both
 * write exactly the same text. Null when there is nothing to write.
 */
export function dirtyFile(game: Game, d: Dirty): { path: string; text: string | null } | null {
  switch (d.kind) {
    case 'template': {
      const t = game.templates[d.id];
      return t ? { path: templatePath(game, d.id), text: templateText(t) } : null;
    }
    case 'templateDelete':
      return d.path ? { path: d.path, text: null } : null;
    case 'cards': {
      const s = game.sets.find((x) => x.id === d.set);
      return s ? { path: joinPath(s.path, 'cards.csv'), text: cardsText(s) } : null;
    }
    case 'set': {
      const s = game.sets.find((x) => x.id === d.set);
      return s ? { path: joinPath(s.path, 'set.json'), text: setText(s.def) } : null;
    }
    case 'game':
      return { path: joinPath(game.path, 'game.json'), text: gameText(game.def) };
  }
}
