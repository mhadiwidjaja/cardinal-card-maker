import { SubFs } from '../fs/subFs';
import { joinPath, type FileStore } from '../fs/types';
import { loadWorkspace } from './load';
import { prettyJson } from './save';
import { faceNames, isFaceLandscape, resolveFace } from './resolve';
import type { Card, CardSet, Game } from './types';

/**
 * Playtest snapshots ("tags"): a copy of a game's data files as they were
 * when a round of playtesting started, so the app can later list and print
 * only the cards that changed since then.
 *
 * Layout, inside the game folder (plain files, like everything else):
 *   playtests/<slug>/tag.json            { formatVersion, name, date }
 *   playtests/<slug>/game.json
 *   playtests/<slug>/templates/*.json
 *   playtests/<slug>/sets/<set>/cards.csv and set.json
 * Art and fonts are not copied: they are large and change rarely, so
 * comparisons draw old and new cards with the current art.
 */

export const TAGS_DIR = 'playtests';

export interface PlaytestTag {
  slug: string;
  name: string;
  date: string;
}

export const tagSlug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'playtest';

async function dataFiles(fs: FileStore, game: Game): Promise<string[]> {
  const files = ['game.json'];
  const tplDir = joinPath(game.path, 'templates');
  if (await fs.exists(tplDir)) for (const e of await fs.list(tplDir)) if (e.kind === 'file' && e.name.endsWith('.json')) files.push(`templates/${e.name}`);
  for (const set of game.sets) {
    const rel = set.path.slice(game.path.length).replace(/^\/+/, '');
    for (const f of ['cards.csv', 'set.json']) if (await fs.exists(joinPath(set.path, f))) files.push(joinPath(rel, f));
  }
  return files;
}

export async function createTag(fs: FileStore, game: Game, name: string, now = new Date()): Promise<PlaytestTag> {
  const existing = new Set((await listTags(fs, game)).map((t) => t.slug));
  let slug = tagSlug(name);
  for (let i = 2; existing.has(slug); i++) slug = `${tagSlug(name)}-${i}`;
  const dir = joinPath(game.path, TAGS_DIR, slug);
  for (const f of await dataFiles(fs, game)) await fs.writeText(joinPath(dir, f), await fs.readText(joinPath(game.path, f)), { force: true });
  const tag: PlaytestTag = { slug, name: name.trim() || slug, date: now.toISOString() };
  await fs.writeText(joinPath(dir, 'tag.json'), prettyJson({ formatVersion: 1, name: tag.name, date: tag.date }) + '\n', { force: true });
  return tag;
}

export async function listTags(fs: FileStore, game: Game): Promise<PlaytestTag[]> {
  const root = joinPath(game.path, TAGS_DIR);
  if (!(await fs.exists(root))) return [];
  const tags: PlaytestTag[] = [];
  for (const e of await fs.list(root)) {
    if (e.kind !== 'directory') continue;
    try {
      const t = JSON.parse(await fs.readText(joinPath(root, e.name, 'tag.json'))) as Partial<PlaytestTag>;
      tags.push({ slug: e.name, name: typeof t.name === 'string' ? t.name : e.name, date: typeof t.date === 'string' ? t.date : '' });
    } catch {
    }
  }
  return tags.sort((a, b) => b.date.localeCompare(a.date));
}

/** Opens a snapshot as a Game (read-only). Its path is set to the live game's, so the same art is found. */
export async function loadTag(fs: FileStore, game: Game, slug: string): Promise<Game> {
  const ws = await loadWorkspace(new SubFs(fs, joinPath(game.path, TAGS_DIR, slug)));
  const old = ws.games[0];
  if (!old) throw new Error(`The snapshot "${slug}" has no game.json`);
  // Sets keep their folder names, so ids match the live game's sets.
  return { ...old, id: game.id, path: game.path };
}

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface CardChange {
  setId: string;
  setName: string;
  cardId: string;
  name: string;
  kind: 'added' | 'removed' | 'changed';
  fields: FieldChange[];
  looks?: boolean;
  now?: { set: CardSet; card: Card };
  then?: { set: CardSet; card: Card };
}

const nameOf = (game: Game, card: Card) => card.values[game.def.fields.find((f) => f.identifying)?.id ?? 'name'] || card.id;

/**
 * What changed in the card data since the snapshot. Cards are matched by set
 * folder and card id. Columns that only one side has count as changed when
 * the other side's value is not empty. Looks (template changes) are compared
 * separately, by drawing both versions.
 */
export function diffCards(then: Game, now: Game): CardChange[] {
  const out: CardChange[] = [];
  const thenSets = new Map(then.sets.map((s) => [s.id, s]));
  const nowIds = new Set<string>();
  for (const set of now.sets) {
    const old = thenSets.get(set.id);
    const oldCards = new Map((old?.cards ?? []).map((c) => [c.id, c]));
    for (const card of set.cards) {
      nowIds.add(`${set.id}/${card.id}`);
      const prev = oldCards.get(card.id);
      if (!prev || !old) {
        out.push({ setId: set.id, setName: set.def.name, cardId: card.id, name: nameOf(now, card), kind: 'added', fields: [], now: { set, card } });
        continue;
      }
      const fields: FieldChange[] = [];
      for (const k of new Set([...Object.keys(card.values), ...Object.keys(prev.values)])) {
        if (k === 'id') continue;
        const a = prev.values[k] ?? '';
        const b = card.values[k] ?? '';
        if (a !== b) fields.push({ field: k, from: a, to: b });
      }
      if (fields.length) out.push({ setId: set.id, setName: set.def.name, cardId: card.id, name: nameOf(now, card), kind: 'changed', fields, now: { set, card }, then: { set: old, card: prev } });
    }
  }
  for (const set of then.sets)
    for (const card of set.cards)
      if (!nowIds.has(`${set.id}/${card.id}`)) out.push({ setId: set.id, setName: set.def.name, cardId: card.id, name: nameOf(then, card), kind: 'removed', fields: [], then: { set, card } });
  return out;
}

function drawingSettings(game: Game): string {
  const d = game.def;
  return JSON.stringify([d.card, d.icons, d.keywords, d.fonts, d.variables, d.text, d.fields.map((f) => [f.id, f.computed, f.colors])]);
}

const templateId = (game: Game, card: Card) => {
  const tf = game.def.fields.find((f) => f.source === 'templates')?.id ?? 'template';
  const id = (card.values[tf] ?? '').trim();
  return Object.keys(game.templates).find((k) => k.toLowerCase() === id.toLowerCase()) ?? id;
};

function templateLook(game: Game, card: Card): string {
  const id = templateId(game, card);
  if (!game.templates[id]) return `missing:${id}`;
  return JSON.stringify(faceNames(game.templates, id).map((f) => [f, isFaceLandscape(game.templates, id, f), resolveFace(game.templates, id, f)?.layers]));
}

/**
 * Everything to reprint since the snapshot: cards whose data changed, plus
 * cards whose template (or the game's drawing settings) changed. Without
 * drawing anything, so it is quick enough for the Export tab's card filter.
 * Art files are not compared (snapshots don't copy them).
 */
export function changedSince(then: Game, now: Game): CardChange[] {
  const changes = diffCards(then, now);
  const known = new Set(changes.map((c) => `${c.setId}/${c.cardId}`));
  const allLook = drawingSettings(then) !== drawingSettings(now);
  for (const pair of sharedCards(then, now)) {
    const key = `${pair.now.set.id}/${pair.now.card.id}`;
    const looks = allLook || templateLook(then, pair.then.card) !== templateLook(now, pair.now.card);
    if (!looks) continue;
    const existing = changes.find((c) => `${c.setId}/${c.cardId}` === key);
    if (existing) existing.looks = true;
    else if (!known.has(key))
      changes.push({ setId: pair.now.set.id, setName: pair.now.set.def.name, cardId: pair.now.card.id, name: nameOf(now, pair.now.card), kind: 'changed', fields: [], looks: true, now: pair.now, then: pair.then });
  }
  return changes;
}

export function sharedCards(then: Game, now: Game): { now: { set: CardSet; card: Card }; then: { set: CardSet; card: Card } }[] {
  const thenSets = new Map(then.sets.map((s) => [s.id, s]));
  const out: { now: { set: CardSet; card: Card }; then: { set: CardSet; card: Card } }[] = [];
  for (const set of now.sets) {
    const old = thenSets.get(set.id);
    if (!old) continue;
    const oldCards = new Map(old.cards.map((c) => [c.id, c]));
    for (const card of set.cards) {
      const prev = oldCards.get(card.id);
      if (prev) out.push({ now: { set, card }, then: { set: old, card: prev } });
    }
  }
  return out;
}

export function errataText(game: Game, tag: PlaytestTag, changes: CardChange[], looksOnly: string[] = []): string {
  const label = (id: string) => game.def.fields.find((f) => f.id === id)?.label ?? id;
  const short = (v: string) => (v === '' ? '(empty)' : v.replace(/\s*\n\s*/g, ' / '));
  const lines = [`${game.def.name}: changes since "${tag.name}" (${tag.date.slice(0, 10)})`, ''];
  for (const c of changes) {
    if (c.kind === 'added') lines.push(`NEW  ${c.name}`);
    else if (c.kind === 'removed') lines.push(`GONE ${c.name}`);
    else {
      lines.push(`${c.name}`);
      for (const f of c.fields) if (!f.field.endsWith('.frame')) lines.push(`  ${label(f.field)}: ${short(f.from)} -> ${short(f.to)}`);
    }
  }
  for (const c of changes) if (c.kind === 'changed' && c.looks && !c.fields.length) looksOnly.push(c.name);
  for (const n of looksOnly) lines.push(`${n}  (new look, same text)`);
  if (lines.length === 2) lines.push('No changes.');
  return lines.join('\n') + '\n';
}
