import type { CardSet, Game } from './types';

export interface FindOptions {
  find: string;
  replace: string;
  column: string | null;
  matchCase: boolean;
  wholeWord: boolean;
  only: number[] | null;
}

export interface FindResult {
  matches: number;
  cards: number;
  changed: Map<number, Record<string, string>>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function searchableColumns(game: Game): string[] {
  return game.def.fields.filter((f) => !f.computed).map((f) => f.id);
}

export function findReplace(game: Game, set: CardSet, o: FindOptions): FindResult {
  const changed = new Map<number, Record<string, string>>();
  let matches = 0;
  if (o.find === '') return { matches, cards: 0, changed };
  // Word edges that also work next to accented letters (\b only knows ASCII).
  const word = (s: string) => (o.wholeWord ? `(?<![\\p{L}\\p{N}_])${s}(?![\\p{L}\\p{N}_])` : s);
  const re = new RegExp(word(escapeRe(o.find)), o.matchCase ? 'gu' : 'giu');
  const columns = o.column ? [o.column] : searchableColumns(game);
  const indices = o.only ?? set.cards.map((_, i) => i);
  for (const i of indices) {
    const card = set.cards[i];
    if (!card) continue;
    let values: Record<string, string> | null = null;
    for (const c of columns) {
      const before = card.values[c];
      if (!before) continue;
      let n = 0;
      // A function as replacement, so "$1" or "$&" in the replace text stays literal.
      const after = before.replace(re, () => {
        n++;
        return o.replace;
      });
      if (n === 0) continue;
      matches += n;
      values ??= { ...card.values };
      values[c] = after;
    }
    if (values) changed.set(i, values);
  }
  return { matches, cards: changed.size, changed };
}
