import { splitList, toNumber, toText } from '../expr/expr';
import { cardResolver } from './cardContext';
import type { Card, CardSet, Game } from './types';

export interface Dimension {
  id: string;
  label: string;
  numeric: boolean;
  bin: number;
  /** A card with "Fire, Water" counts under both. */
  split: boolean;
  order?: string[];
  colors?: Record<string, string>;
}

export interface Entry {
  card: Card;
  set: CardSet;
}

export interface Group {
  key: string;
  label: string;
  value: number;
}

export function dimensionsFor(game: Game): Dimension[] {
  const fields = new Map(game.def.fields.map((f) => [f.id, f]));
  const fromField = (id: string, over: Partial<Dimension> = {}): Dimension | null => {
    const f = fields.get(id);
    if (!f) return null;
    const numeric = over.numeric ?? f.type === 'number';
    return {
      id,
      label: f.label ?? id,
      numeric,
      bin: over.bin ?? f.stats?.bin ?? 1,
      split: over.split ?? f.type === 'multi',
      order: over.order ?? (f.source === 'templates' ? undefined : f.choices),
      colors: f.colors,
    };
  };
  const configured = (game.def.statistics ?? [])
    .map((s) => fromField(s.field, { numeric: s.numeric, bin: s.bin, split: s.splitList, order: s.order }))
    .filter((d): d is Dimension => d !== null);
  const seen = new Set(configured.map((d) => d.id));
  const auto = game.def.fields
    .filter((f) => !seen.has(f.id) && !f.stats?.hidden && f.role !== 'quantity')
    .filter((f) => ['number', 'choice', 'multi', 'boolean'].includes(f.type) || !!f.computed)
    .map((f) => fromField(f.id))
    .filter((d): d is Dimension => d !== null);
  return [...configured, ...auto];
}

export function valuesOf(game: Game, e: Entry, dim: Dimension): string[] {
  const v = toText(cardResolver(game, e.card, e.set)(dim.id) ?? '').trim();
  if (v === '') return [];
  if (dim.numeric) {
    const n = toNumber(v);
    if (n === null) return [v];
    return [String(Math.floor(n / dim.bin) * dim.bin)];
  }
  if (dim.split) return splitList(v);
  if (dim.id === 'template') return [game.templates[v]?.name ?? v];
  return [v];
}

export function binLabel(key: string, dim: Dimension): string {
  const n = toNumber(key);
  if (!dim.numeric || n === null || dim.bin === 1) return key;
  return `${n}–${n + dim.bin - (Number.isInteger(dim.bin) ? 1 : 0)}`;
}

export function weightFn(game: Game, copies: boolean): (e: Entry) => number {
  const q = game.def.fields.find((f) => f.role === 'quantity');
  if (!copies || !q) return () => 1;
  return (e) => {
    const n = toNumber(cardResolver(game, e.card, e.set)(q.id) ?? '');
    return n === null ? 1 : Math.max(0, n);
  };
}

export function orderKeys(keys: Map<string, number>, dim: Dimension): string[] {
  const all = [...keys.keys()];
  if (dim.numeric) {
    const nums = all.map((k) => toNumber(k)).filter((n): n is number => n !== null);
    const others = all.filter((k) => toNumber(k) === null).sort();
    if (!nums.length) return others;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const out: string[] = [];
    // Fill gaps so the curve shows missing costs (cap to keep it sane).
    if ((max - min) / dim.bin <= 60) for (let v = min; v <= max + 1e-9; v += dim.bin) out.push(String(Math.round(v * 1e6) / 1e6));
    else out.push(...[...new Set(nums)].sort((a, b) => a - b).map(String));
    return [...out, ...others];
  }
  if (dim.order) {
    const lower = new Map(all.map((k) => [k.toLowerCase(), k]));
    const ordered = dim.order.map((o) => lower.get(o.toLowerCase()) ?? o).filter((k) => keys.has(k) || dim.order!.includes(k));
    const rest = all.filter((k) => !ordered.includes(k)).sort((a, b) => keys.get(b)! - keys.get(a)! || a.localeCompare(b));
    return [...ordered, ...rest];
  }
  return all.sort((a, b) => keys.get(b)! - keys.get(a)! || a.localeCompare(b));
}

function canonical(dim: Dimension) {
  const known = new Map((dim.order ?? []).map((o) => [o.toLowerCase(), o]));
  const seen = new Map<string, string>();
  return (v: string) => {
    const k = v.toLowerCase();
    const hit = known.get(k) ?? seen.get(k);
    if (hit) return hit;
    seen.set(k, v);
    return v;
  };
}

export interface CountResult {
  groups: Group[];
  blank: number;
  total: number;
}

export function countBy(game: Game, entries: Entry[], dim: Dimension, weight: (e: Entry) => number): CountResult {
  const counts = new Map<string, number>();
  const canon = canonical(dim);
  let blank = 0;
  let total = 0;
  for (const e of entries) {
    const w = weight(e);
    total += w;
    const vals = valuesOf(game, e, dim);
    if (!vals.length) blank += w;
    for (const v of vals) {
      const k = canon(v);
      counts.set(k, (counts.get(k) ?? 0) + w);
    }
  }
  const groups = orderKeys(counts, dim).map((key) => ({ key, label: binLabel(key, dim), value: counts.get(key) ?? 0 }));
  return { groups, blank, total };
}

export interface CrossResult {
  rows: Group[];
  series: string[];
  /** cells[row][series] */
  cells: number[][];
}

export function crossCount(game: Game, entries: Entry[], dim: Dimension, by: Dimension, weight: (e: Entry) => number): CrossResult {
  const primary = countBy(game, entries, dim, weight);
  const secondary = countBy(game, entries, by, weight);
  const canonA = canonical(dim);
  const canonB = canonical(by);
  const rowIndex = new Map(primary.groups.map((g, i) => [g.key, i]));
  const series = secondary.groups.map((g) => g.label);
  const serIndex = new Map(secondary.groups.map((g, i) => [g.key, i]));
  const cells = primary.groups.map(() => series.map(() => 0));
  for (const e of entries) {
    const w = weight(e);
    const a = valuesOf(game, e, dim).map(canonA);
    const b = valuesOf(game, e, by).map(canonB);
    for (const x of a)
      for (const y of b) {
        const r = rowIndex.get(x);
        const s = serIndex.get(y);
        if (r !== undefined && s !== undefined) cells[r]![s]! += w;
      }
  }
  return { rows: primary.groups, series, cells };
}

export interface NumericSummary {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
}

export function numericSummary(game: Game, entries: Entry[], fieldId: string, weight: (e: Entry) => number): NumericSummary | null {
  const vals: { v: number; w: number }[] = [];
  for (const e of entries) {
    const n = toNumber(toText(cardResolver(game, e.card, e.set)(fieldId) ?? ''));
    const w = weight(e);
    if (n !== null && w > 0) vals.push({ v: n, w });
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a.v - b.v);
  const totalW = vals.reduce((s, x) => s + x.w, 0);
  const mean = vals.reduce((s, x) => s + x.v * x.w, 0) / totalW;
  let acc = 0;
  let median = vals[0]!.v;
  for (const x of vals) {
    acc += x.w;
    if (acc >= totalW / 2) {
      median = x.v;
      break;
    }
  }
  return { count: totalW, mean, median, min: vals[0]!.v, max: vals[vals.length - 1]!.v };
}
