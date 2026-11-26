import { run, toNumber, toText } from '../expr/expr';
import { cardResolver } from './cardContext';
import type { Entry } from './stats';
import type { Game } from './types';

/**
 * Balance lens: how well a card's cost matches what it does. Fits
 * cost ≈ intercept + Σ worth × term by least squares (with a little ridge
 * regularisation so small sets still give sensible numbers) and lists the
 * cards furthest off the line. Game-agnostic: the terms are the game's own
 * number fields, keywords and templates, or the owner's value formula.
 */

export interface BalanceTerm {
  id: string;
  label: string;
  value: (e: Entry) => number;
}

export interface BalanceRow {
  entry: Entry;
  cost: number;
  predicted: number;
  /** cost − predicted: below 0 the card is cheap for what it does (maybe too strong). */
  residual: number;
}

export interface BalanceFit {
  intercept: number;
  worth: { term: BalanceTerm; worth: number }[];
  rows: BalanceRow[];
  r2: number;
}

/** The field that holds the cost: game.json "balance.cost", else a field named cost, else the first number field. */
export function costField(game: Game): string | null {
  const nums = game.def.fields.filter((f) => f.type === 'number' && f.role !== 'quantity');
  const wanted = game.def.balance?.cost;
  if (wanted && nums.some((f) => f.id === wanted)) return wanted;
  return nums.find((f) => f.id.toLowerCase() === 'cost')?.id ?? nums[0]?.id ?? null;
}

const num = (game: Game, e: Entry, field: string): number | null => {
  try {
    return toNumber(toText(cardResolver(game, e.card, e.set)(field) ?? ''));
  } catch {
    return null;
  }
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Terms learned from the cards themselves: every other number field, every
 * keyword (its number when it has one, e.g. "Shield 2" counts 2), and every
 * template but the most common one (cards of different kinds cost differently).
 * Terms that are the same on every card are left out; they can't be told apart from the base cost.
 */
export function learnedTerms(game: Game, entries: Entry[]): BalanceTerm[] {
  const cost = costField(game);
  const terms: BalanceTerm[] = [];
  for (const f of game.def.fields) {
    if (f.type !== 'number' || f.id === cost || f.role === 'quantity') continue;
    terms.push({ id: `field:${f.id}`, label: f.label ?? f.id, value: (e) => num(game, e, f.id) ?? 0 });
  }
  const textFields = game.def.fields.filter((f) => f.type === 'richtext' || f.type === 'text').map((f) => f.id);
  for (const k of game.def.keywords ?? []) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(k.name)}(?![\\p{L}\\p{N}])(?:\\s+(\\d+))?`, 'iu');
    terms.push({
      id: `keyword:${k.name}`,
      label: k.name,
      value: (e) => {
        for (const id of textFields) {
          const m = re.exec(e.card.values[id] ?? '');
          if (m) return m[1] ? Number(m[1]) : 1;
        }
        return 0;
      },
    });
  }
  const tf = game.def.fields.find((f) => f.source === 'templates')?.id;
  if (tf) {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const t = (e.card.values[tf] ?? '').toLowerCase();
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [t] of sorted.slice(1)) if (t) terms.push({ id: `template:${t}`, label: `is ${t}`, value: (e) => ((e.card.values[tf] ?? '').toLowerCase() === t ? 1 : 0) });
  }
  return terms.filter((t) => new Set(entries.map((e) => t.value(e))).size > 1);
}

export function formulaTerm(game: Game, formula: string): BalanceTerm {
  return {
    id: 'formula',
    label: 'value',
    value: (e) => {
      try {
        return toNumber(toText(run(formula, cardResolver(game, e.card, e.set)))) ?? 0;
      } catch {
        return 0;
      }
    },
  };
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

export function fitBalance(game: Game, entries: Entry[], terms: BalanceTerm[], ridge = 0.1): BalanceFit | { error: string } {
  const cost = costField(game);
  if (!cost) return { error: 'The game has no number field for the cost.' };
  const data = entries.map((e) => ({ e, y: num(game, e, cost) })).filter((d): d is { e: Entry; y: number } => d.y !== null);
  if (data.length < terms.length + 3) return { error: `Needs at least ${terms.length + 3} cards with a cost (has ${data.length}). Add cards or use fewer terms.` };
  const X = data.map((d) => [1, ...terms.map((t) => t.value(d.e))]);
  const k = terms.length + 1;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, row) => s + row[i]! * row[j]!, 0) + (i === j && i > 0 ? ridge : 0)));
  const Xty = Array.from({ length: k }, (_, i) => X.reduce((s, row, r) => s + row[i]! * data[r]!.y, 0));
  const beta = solve(XtX, Xty);
  const rows = data.map((d, r) => {
    const predicted = X[r]!.reduce((s, x, i) => s + x * beta[i]!, 0);
    return { entry: d.e, cost: d.y, predicted, residual: d.y - predicted };
  });
  const mean = data.reduce((s, d) => s + d.y, 0) / data.length;
  const ssTot = data.reduce((s, d) => s + (d.y - mean) ** 2, 0);
  const ssRes = rows.reduce((s, r) => s + r.residual ** 2, 0);
  return {
    intercept: beta[0]!,
    worth: terms.map((term, i) => ({ term, worth: beta[i + 1]! })),
    rows,
    r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1,
  };
}
