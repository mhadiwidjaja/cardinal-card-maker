import { FileNotFoundError, joinPath, type FileStore } from '../fs/types';
import { valueProblem } from './cardOps';
import { parseCsv } from './csv';
import { migrate, type FileKind } from './migrations';
import type { Card, CardSet, Field, Game, Issue, TemplateDef, Workspace } from './types';
import { validateGame, validateSet, validateTemplate, validateWorkspace } from './validate';
import { isFramingColumn } from './framing';

/**
 * Loads a whole workspace. Two layouts are accepted:
 *  - a workspace folder with games/<game>/game.json (normal), or
 *  - a single game folder with game.json at the root.
 * Problems never throw; they are collected in `workspace.issues`.
 */
export async function loadWorkspace(fs: FileStore): Promise<Workspace> {
  const issues: Issue[] = [];
  const raw = await readJson(fs, 'workspace.json', 'workspace', issues, { optional: true });
  const def = validateWorkspace(raw ?? { formatVersion: 1 }, 'workspace.json', issues);

  const gamePaths: string[] = [];
  if (await fs.exists('game.json')) {
    gamePaths.push('');
  } else if (await fs.exists('games')) {
    for (const entry of await fs.list('games')) {
      if (entry.kind !== 'directory') continue;
      const path = joinPath('games', entry.name);
      if (await fs.exists(joinPath(path, 'game.json'))) gamePaths.push(path);
      else issues.push({ level: 'warning', file: path, message: 'Folder has no game.json, so it was skipped' });
    }
  }
  if (gamePaths.length === 0) {
    issues.push({ level: 'warning', file: '', message: 'No games found. Expected games/<name>/game.json or a game.json in this folder.' });
  }

  const games: Game[] = [];
  for (const path of gamePaths) {
    const game = await loadGame(fs, path, issues);
    if (game) games.push(game);
  }
  return { name: def.name ?? fs.name, def, games, issues };
}

async function loadGame(fs: FileStore, path: string, issues: Issue[]): Promise<Game | null> {
  const file = joinPath(path, 'game.json');
  const raw = await readJson(fs, file, 'game', issues);
  if (!raw) return null;
  const def = validateGame(raw, file, issues);
  if (!def) return null;

  const id = path === '' ? fs.name : path.split('/').pop()!;
  const templates = await loadTemplates(fs, path, issues);
  const sets: CardSet[] = [];
  const setsDir = joinPath(path, 'sets');
  if (await fs.exists(setsDir)) {
    for (const entry of await fs.list(setsDir)) {
      if (entry.kind !== 'directory') continue;
      const set = await loadSet(fs, joinPath(setsDir, entry.name), entry.name, def.fields, templates, issues);
      if (set) sets.push(set);
    }
  }
  return { id, path, def, templates, sets };
}

async function loadTemplates(fs: FileStore, gamePath: string, issues: Issue[]): Promise<Record<string, TemplateDef>> {
  const dir = joinPath(gamePath, 'templates');
  const templates: Record<string, TemplateDef> = {};
  if (!(await fs.exists(dir))) return templates;

  for (const entry of await fs.list(dir)) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
    const file = joinPath(dir, entry.name);
    const raw = await readJson(fs, file, 'template', issues);
    if (!raw) continue;
    const t = validateTemplate(raw, file, entry.name.slice(0, -'.json'.length), issues);
    if (!t) continue;
    if (templates[t.id]) issues.push({ level: 'error', file, message: `Template id "${t.id}" is used twice` });
    else templates[t.id] = t;
  }

  for (const t of Object.values(templates)) {
    const file = joinPath(dir, `${t.id}.json`);
    if (t.extends && !templates[t.extends]) {
      issues.push({ level: 'error', file, message: `extends "${t.extends}", which doesn't exist` });
    }
    for (const [face, def] of Object.entries(t.faces)) {
      if (def.useTemplate && !templates[def.useTemplate]) {
        issues.push({ level: 'error', file, message: `faces.${face} uses template "${def.useTemplate}", which doesn't exist` });
      }
    }
    const chain = new Set<string>();
    for (let cur: TemplateDef | undefined = t; cur; cur = cur.extends ? templates[cur.extends] : undefined) {
      if (chain.has(cur.id)) {
        issues.push({ level: 'error', file, message: `"extends" loops back to itself: ${[...chain, cur.id].join(' → ')}` });
        break;
      }
      chain.add(cur.id);
    }
  }
  return templates;
}

async function loadSet(
  fs: FileStore,
  path: string,
  folderName: string,
  fields: Field[],
  templates: Record<string, TemplateDef>,
  issues: Issue[],
): Promise<CardSet | null> {
  const setFile = joinPath(path, 'set.json');
  const raw = await readJson(fs, setFile, 'set', issues, { optional: true });
  const def = validateSet(raw ?? { formatVersion: 1 }, setFile, folderName, issues);

  const csvFile = joinPath(path, 'cards.csv');
  if (!(await fs.exists(csvFile))) {
    issues.push({ level: 'warning', file: path, message: 'Set has no cards.csv' });
    return { id: folderName, path, def, columns: [], cards: [] };
  }
  const text = await fs.readText(csvFile);
  const table = parseCsv(text);
  for (const e of table.errors) issues.push({ level: 'error', file: csvFile, message: `Row ${e.row}: ${e.message}` });

  const warn = (message: string) => issues.push({ level: 'warning', file: csvFile, message });
  // U+FFFD is what the browser puts in place of bytes that are not UTF-8.
  if (text.includes(REPLACEMENT_CHAR)) warn(NOT_UTF8_WARNING);

  // Headers match fields by id or label, ignoring case ("Name" → name). Saving writes the field ids.
  const byName = new Map<string, string>([['id', 'id']]);
  for (const f of fields) {
    byName.set(f.id.toLowerCase(), f.id);
    if (f.label && !byName.has(f.label.toLowerCase())) byName.set(f.label.toLowerCase(), f.id);
  }
  const rename = new Map<string, string>();
  for (const c of table.columns) {
    const target = byName.get(c.trim().toLowerCase());
    if (target && target !== c && !table.columns.includes(target)) rename.set(c, target);
  }
  const columns = table.columns.map((c) => rename.get(c) ?? c);
  const rows = rename.size
    ? table.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [rename.get(k) ?? k, v])))
    : table.rows;

  const fieldIds = new Set(fields.map((f) => f.id));
  // Framing columns (`art.frame`) belong to their image field, so they are not "extra".
  const extra = columns.filter((c) => c !== '' && c !== 'id' && !fieldIds.has(c) && !isFramingColumn(c, fields));
  if (extra.length) warn(`Columns not defined in game.json (kept, but not used): ${extra.join(', ')}`);

  const usable = Object.values(templates).filter((t) => !t.abstract);
  const ids = new Set<string>();
  const cards: Card[] = rows.map((values, i) => {
    const row = i + 2;
    let id = values.id?.trim() ?? '';
    if (id === '') id = `${folderName}-row${row}`;
    if (ids.has(id)) warn(`Row ${row}: id "${id}" is used by another card`);
    ids.add(id);
    checkValues(values, row, fields, usable, warn);
    return { id, values, row };
  });
  return { id: folderName, path, def, columns, cards };
}

function checkValues(
  values: Record<string, string>,
  row: number,
  fields: Field[],
  templates: TemplateDef[],
  warn: (m: string) => void,
) {
  for (const f of fields) {
    const v = values[f.id]?.trim();
    if (v === undefined || v === '' || f.computed) continue;
    const problem = valueProblem(f, v, templates.map((t) => t.id));
    if (problem) warn(`Row ${row}, ${f.id}: ${problem}`);
  }
}

const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
export const NOT_UTF8_WARNING =
  'This file is not UTF-8 text (it was probably saved from Excel as plain "CSV"), so some letters show as �. ' +
  'The file on disk stays untouched until you save. In Excel, save it again as "CSV UTF-8", or import the .xlsx instead.';

async function readJson(
  fs: FileStore,
  file: string,
  kind: FileKind,
  issues: Issue[],
  opts: { optional?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await fs.readText(file);
  } catch (e) {
    if (e instanceof FileNotFoundError) {
      if (!opts.optional) issues.push({ level: 'error', file, message: 'File is missing' });
      return null;
    }
    throw e;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    issues.push({ level: 'error', file, message: `Not valid JSON: ${(e as Error).message}` });
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    issues.push({ level: 'error', file, message: 'Expected a JSON object ({ ... })' });
    return null;
  }
  return migrate(kind, data as Record<string, unknown>, file, issues);
}
