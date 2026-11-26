import Papa from 'papaparse';
import { run, toBool, toNumber } from '../expr/expr';
import { cardResolver } from './cardContext';
import type { Card, CardSet, Field, Game } from './types';

export function cardProblems(game: Game, card: Card): Map<string, string> {
  const out = new Map<string, string>();
  const usable = Object.values(game.templates).filter((t) => !t.abstract);
  for (const f of game.def.fields) {
    const v = card.values[f.id]?.trim();
    if (v === undefined || v === '' || f.computed) continue;
    const p = valueProblem(f, v, usable.map((t) => t.id));
    if (p) out.set(f.id, p);
  }
  return out;
}

export function valueProblem(f: Field, v: string, templateIds: string[]): string | null {
  if (f.type === 'number') {
    const n = toNumber(v);
    if (n === null && !/^x$/i.test(v)) return `"${v}" is not a number`;
    if (n !== null && f.min !== undefined && n < f.min) return `${n} is below the minimum ${f.min}`;
    if (n !== null && f.max !== undefined && n > f.max) return `${n} is above the maximum ${f.max}`;
  }
  if (f.type === 'boolean' && !/^(true|false|yes|no|1|0|y|n|x)$/i.test(v)) return `"${v}" is not yes/no`;
  if (f.source === 'templates') {
    if (!templateIds.some((t) => t.toLowerCase() === v.toLowerCase())) return `no template named "${v}"`;
  } else if (f.choices && (f.type === 'choice' || f.type === 'multi')) {
    const picked = f.type === 'multi' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [v];
    const bad = picked.filter((p) => !f.choices!.some((c) => c.toLowerCase() === p.toLowerCase()));
    if (bad.length) return `${bad.map((b) => `"${b}"`).join(', ')} ${bad.length > 1 ? 'are' : 'is'} not one of ${f.choices.join(', ')}`;
  }
  return null;
}

export function newCardId(set: CardSet, taken: Set<string> = new Set()): string {
  const ids = new Set([...set.cards.map((c) => c.id), ...taken]);
  let prefix = 'c';
  let width = 3;
  let max = 0;
  for (const id of ids) {
    const m = /^(.*?)(\d+)$/.exec(id);
    if (!m) continue;
    const n = Number(m[2]);
    if (n >= max) {
      max = n;
      prefix = m[1]!;
      width = m[2]!.length;
    }
  }
  let n = max + 1;
  while (ids.has(prefix + String(n).padStart(width, '0'))) n++;
  return prefix + String(n).padStart(width, '0');
}

export function blankCard(game: Game, set: CardSet, taken?: Set<string>): Card {
  const values: Record<string, string> = {};
  for (const c of set.columns) values[c] = '';
  for (const f of game.def.fields) if (!f.computed) values[f.id] = '';
  const id = newCardId(set, taken);
  values.id = id;
  const usable = Object.values(game.templates).filter((t) => !t.abstract);
  const tf = game.def.fields.find((f) => f.source === 'templates');
  if (tf && usable.length) values[tf.id] = usable[0]!.id;
  return { id, values, row: 0 };
}

export function setColumns(game: Game, set: CardSet): string[] {
  const cols = ['id', ...game.def.fields.filter((f) => !f.computed).map((f) => f.id)];
  for (const c of set.columns) if (c && !cols.includes(c)) cols.push(c);
  return cols;
}

export function withCards(set: CardSet, cards: Card[], game?: Game): CardSet {
  const renumbered = cards.map((c, i) => ({ ...c, row: i + 2 }));
  return { ...set, cards: renumbered, columns: game ? setColumns(game, set) : set.columns };
}

export type ImportMode = 'replace' | 'append' | 'merge';

export interface ImportReport {
  added: number;
  updated: number;
  removed: number;
  unknownColumns: string[];
  matchedColumns: string[];
  changes: ImportChange[];
}

export type ImportChange =
  | { kind: 'changed'; card: string; field: string; from: string; to: string }
  | { kind: 'added'; card: string }
  | { kind: 'removed'; card: string };

function cardName(game: Game, values: Record<string, string>, id: string): string {
  const nameField = game.def.fields.find((f) => f.identifying)?.id ?? 'name';
  return values[nameField]?.trim() || id;
}

/**
 * Brings rows from a spreadsheet into a set. Columns are matched to fields by
 * id or label, ignoring case. In "merge" mode rows with a known id update that
 * card (only the columns present), others are added.
 */
export function importRows(game: Game, set: CardSet, rows: string[][], mode: ImportMode): { set: CardSet; report: ImportReport } {
  const [header = [], ...data] = rows;
  const byName = new Map<string, string>();
  for (const f of game.def.fields) {
    byName.set(f.id.toLowerCase(), f.id);
    if (f.label) byName.set(f.label.toLowerCase(), f.id);
  }
  byName.set('id', 'id');
  for (const c of set.columns) if (c) byName.set(c.toLowerCase(), c);
  const cols = header.map((h) => byName.get(h.trim().toLowerCase()) ?? (h.trim() || null));
  const unknownColumns = header.filter((h, i) => h.trim() && !byName.has(h.trim().toLowerCase()) && cols[i]);
  const matchedColumns = cols.filter((c): c is string => !!c && byName.has(c.toLowerCase()));

  const report: ImportReport = { added: 0, updated: 0, removed: 0, unknownColumns, matchedColumns, changes: [] };
  const existing = mode === 'replace' ? [] : set.cards.map((c) => ({ ...c, values: { ...c.values } }));
  if (mode === 'replace') {
    report.removed = set.cards.length;
    for (const c of set.cards) report.changes.push({ kind: 'removed', card: cardName(game, c.values, c.id) });
  }
  const byId = new Map(existing.map((c) => [c.id, c]));
  const taken = new Set<string>(existing.map((c) => c.id));
  const tmpSet = { ...set, cards: existing };

  for (const r of data) {
    if (r.every((c) => (c ?? '').trim() === '')) continue;
    const values: Record<string, string> = {};
    cols.forEach((c, i) => {
      if (c) values[c] = r[i] ?? '';
    });
    const id = values.id?.trim();
    const target = mode === 'merge' && id ? byId.get(id) : undefined;
    if (target) {
      const name = cardName(game, target.values, target.id);
      for (const [field, to] of Object.entries(values)) {
        const from = target.values[field] ?? '';
        if (field !== 'id' && from !== to) report.changes.push({ kind: 'changed', card: name, field, from, to });
      }
      Object.assign(target.values, values);
      report.updated++;
    } else {
      const card = blankCard(game, tmpSet, taken);
      const finalId = id && !taken.has(id) ? id : card.id;
      taken.add(finalId);
      const c = { id: finalId, row: 0, values: { ...card.values, ...values, id: finalId } };
      existing.push(c);
      byId.set(finalId, c);
      report.added++;
      report.changes.push({ kind: 'added', card: cardName(game, c.values, finalId) });
    }
  }
  const columns = [...setColumns(game, set)];
  for (const c of cols) if (c && !columns.includes(c)) columns.push(c);
  return { set: withCards({ ...set, columns }, existing), report };
}

/**
 * Filters cards. Plain text matches any cell (all words must match).
 * Text starting with "=" is an expression, e.g. "= cost > 3 and rarity == 'Rare'".
 */
export function filterCards(game: Game, set: CardSet, query: string): { indices: number[]; error: string | null } {
  const q = query.trim();
  const all = set.cards.map((_, i) => i);
  if (!q) return { indices: all, error: null };
  if (q.startsWith('=')) {
    const expr = q.slice(1);
    try {
      const out = all.filter((i) => toBool(run(expr, cardResolver(game, set.cards[i]!, set))));
      return { indices: out, error: null };
    } catch (e) {
      return { indices: all, error: (e as Error).message };
    }
  }
  const words = q.toLowerCase().split(/\s+/);
  return {
    indices: all.filter((i) => {
      const text = Object.values(set.cards[i]!.values).join('\u0000').toLowerCase();
      return words.every((w) => text.includes(w));
    }),
    error: null,
  };
}

export function sortIndices(game: Game, set: CardSet, indices: number[], column: string, dir: 1 | -1): number[] {
  const field = game.def.fields.find((f) => f.id === column);
  const key = (i: number): [number, number | string] => {
    const v = (set.cards[i]!.values[column] ?? '').trim();
    if (v === '') return [2, 0];
    if (field?.choices) {
      const first = v.split(',')[0]!.trim().toLowerCase();
      const idx = field.choices.findIndex((c) => c.toLowerCase() === first);
      if (idx >= 0) return [0, idx];
    }
    const n = toNumber(v);
    if (n !== null && (field?.type === 'number' || field === undefined || column === 'id')) return [0, n];
    // In number columns, text (e.g. a typo or "X") sorts after the numbers.
    return [field?.type === 'number' ? 1 : 0, v.toLowerCase()];
  };
  return [...indices].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    const x = ka[1];
    const y = kb[1];
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return c * dir || a - b;
  });
}

export function toTsv(rows: string[][]): string {
  return Papa.unparse(rows, { delimiter: '\t', newline: '\r\n', quotes: false });
}

export function fromTsv(text: string): string[][] {
  const clean = text.replace(/\r?\n$/, '');
  if (!clean.includes('\t') && !clean.includes('\n') && !clean.startsWith('"')) return [[clean]];
  const res = Papa.parse<string[]>(clean, { delimiter: '\t', newline: clean.includes('\r\n') ? '\r\n' : '\n' });
  return res.data;
}
