import { joinPath, type FileStore } from '../fs/types';
import { quantityOf } from '../export/exporters';
import { prettyJson } from '../model/save';
import type { Card, CardSet, Game } from '../model/types';
import type { DeckEntry } from './table';

/**
 * Deck lists for the playtest table, saved as games/<game>/decks/<id>.json:
 *   { "formatVersion": 1, "name": "Fire aggro", "cards": [{ "card": "core/c001", "count": 3 }] }
 * "card" is "<set folder>/<card id>". Every set also works as a ready-made
 * deck that uses each card's quantity (count) field.
 */

export interface DeckFile {
  formatVersion: number;
  name: string;
  cards: { card: string; count: number }[];
}

export interface Deck {
  /** "set:<setId>" for built-in set decks, "file:<id>" for saved deck files. */
  id: string;
  name: string;
  entries: DeckEntry[];
  file?: string;
}

export const cardKey = (set: CardSet, card: Card) => `${set.id}/${card.id}`;

export function findCard(game: Game, key: string): { set: CardSet; card: Card } | null {
  const slash = key.indexOf('/');
  const set = game.sets.find((s) => s.id === key.slice(0, slash));
  const card = set?.cards.find((c) => c.id === key.slice(slash + 1));
  return set && card ? { set, card } : null;
}

export function setDeck(game: Game, set: CardSet): Deck {
  return {
    id: `set:${set.id}`,
    name: `${set.def.name} (whole set)`,
    entries: set.cards.map((card) => ({ key: cardKey(set, card), count: quantityOf(game, { set, card }) })).filter((e) => e.count > 0),
  };
}

export function deckSize(d: { entries: DeckEntry[] }): number {
  return d.entries.reduce((n, e) => n + e.count, 0);
}

export function parseDeck(text: string, fileId: string): { deck: Deck | null; problem?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { deck: null, problem: `Not valid JSON: ${(e as Error).message}` };
  }
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<DeckFile>;
  if (!Array.isArray(o.cards)) return { deck: null, problem: '"cards" must be a list' };
  const entries: DeckEntry[] = [];
  for (const c of o.cards) {
    if (typeof c?.card !== 'string') continue;
    const count = typeof c.count === 'number' && Number.isFinite(c.count) ? Math.max(0, Math.min(999, Math.floor(c.count))) : 1;
    if (count > 0) entries.push({ key: c.card, count });
  }
  return { deck: { id: `file:${fileId}`, file: fileId, name: typeof o.name === 'string' && o.name ? o.name : fileId, entries } };
}

export function deckText(d: Deck): string {
  const file: DeckFile = { formatVersion: 1, name: d.name, cards: d.entries.map((e) => ({ card: e.key, count: e.count })) };
  return prettyJson(file) + '\n';
}

export const decksDir = (game: Game) => joinPath(game.path, 'decks');

export async function loadDecks(fs: FileStore, game: Game): Promise<{ decks: Deck[]; problems: string[] }> {
  const dir = decksDir(game);
  const decks: Deck[] = [];
  const problems: string[] = [];
  if (!(await fs.exists(dir))) return { decks, problems };
  for (const e of await fs.list(dir)) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue;
    const id = e.name.slice(0, -5);
    const r = parseDeck(await fs.readText(joinPath(dir, e.name)), id);
    if (r.deck) decks.push(r.deck);
    else problems.push(`decks/${e.name}: ${r.problem}`);
  }
  return { decks, problems };
}

export async function saveDeck(fs: FileStore, game: Game, d: Deck): Promise<void> {
  await fs.writeText(joinPath(decksDir(game), `${d.file}.json`), deckText(d), { force: true });
}

export function missingCards(game: Game, d: Deck): string[] {
  return d.entries.filter((e) => !findCard(game, e.key)).map((e) => e.key);
}
