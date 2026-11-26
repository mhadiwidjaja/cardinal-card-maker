import type { CardSet, Game } from './types';

export interface LintCardRef {
  setId: string;
  cardId: string;
  name: string;
  field: string;
}

export interface LintFinding {
  kind: 'keyword-typo' | 'keyword-case' | 'two-wordings' | 'style' | 'spacing';
  message: string;
  suggestion?: string;
  cards: LintCardRef[];
}

export interface StyleRule {
  find: string;
  use: string;
}

const WORD = /[\p{L}\p{N}']+/gu;

export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

export function wordingOf(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/[*_]/g, '')
    .replace(/[^\p{L}\p{N}#[\]' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function similarity(a: string, b: string): number {
  const wa = a.split(' ');
  const wb = b.split(' ');
  const n = wa.length;
  const m = wb.length;
  const d = Array.from({ length: n + 1 }, (_, i) => [i, ...Array<number>(m).fill(0)]);
  for (let j = 1; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      // Words that differ only by an s, like deal/deals or unit/units, count as half a change.
      const x = wa[i - 1]!;
      const y = wb[j - 1]!;
      const cost = x === y ? 0 : x.replace(/s$/, '') === y.replace(/s$/, '') ? 0.5 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  return 1 - d[n]![m]! / Math.max(n, m, 1);
}

interface TextPiece extends LintCardRef {
  text: string;
}

function pieces(game: Game, sets: CardSet[]): TextPiece[] {
  const nameField = game.def.fields.find((f) => f.identifying)?.id ?? 'name';
  const fields = game.def.fields.filter((f) => f.type === 'richtext' && !f.computed).map((f) => f.id);
  const out: TextPiece[] = [];
  for (const set of sets)
    for (const card of set.cards)
      for (const field of fields) {
        const text = card.values[field] ?? '';
        if (text.trim()) out.push({ setId: set.id, cardId: card.id, name: card.values[nameField] || card.id, field, text });
      }
  return out;
}

const ref = (p: TextPiece): LintCardRef => ({ setId: p.setId, cardId: p.cardId, name: p.name, field: p.field });

export function lintWording(game: Game, sets: CardSet[] = game.sets, style: StyleRule[] = game.def.style ?? []): LintFinding[] {
  const found: LintFinding[] = [];
  const all = pieces(game, sets);
  const add = (key: string, f: Omit<LintFinding, 'cards'>, p: TextPiece, map: Map<string, LintFinding>) => {
    let e = map.get(key);
    if (!e) {
      e = { ...f, cards: [] };
      map.set(key, e);
      found.push(e);
    }
    if (!e.cards.some((c) => c.cardId === p.cardId && c.setId === p.setId && c.field === p.field)) e.cards.push(ref(p));
  };

  const keywords = (game.def.keywords ?? []).map((k) => k.name).filter(Boolean);
  const kwMap = new Map<string, LintFinding>();
  for (const p of all) {
    for (const m of p.text.replace(/\[[^\]]*\]/g, ' ').matchAll(WORD)) {
      const w = m[0];
      for (const k of keywords) {
        if (w === k) continue;
        if (w.toLowerCase() === k.toLowerCase()) {
          // Lower case in the middle of a sentence can be ordinary English ("a swift unit"); only flag at a line or sentence start.
          const before = p.text.slice(0, m.index).trimEnd();
          if (before === '' || /[.!?\n:]$/.test(before) || /,$/.test(before)) add(`case:${k}`, { kind: 'keyword-case', message: `“${w}” is written differently from the keyword “${k}”`, suggestion: k }, p, kwMap);
        } else if (k.length >= 5 && Math.abs(w.length - k.length) <= 2 && editDistance(w.toLowerCase(), k.toLowerCase()) <= (k.length >= 8 ? 2 : 1)) {
          add(`typo:${w}:${k}`, { kind: 'keyword-typo', message: `“${w}” looks like a misspelling of the keyword “${k}” (it gets no reminder text)`, suggestion: k }, p, kwMap);
        }
      }
    }
  }

  const byWording = new Map<string, TextPiece[]>();
  for (const p of all)
    for (const s of p.text.split(/(?<=[.!?])\s+|\n+/)) {
      const w = wordingOf(s);
      if (w.split(' ').length < 4) continue;
      const list = byWording.get(w) ?? [];
      if (!list.some((x) => x.cardId === p.cardId && x.setId === p.setId)) list.push(p);
      byWording.set(w, list);
    }
  const wordings = [...byWording.keys()];
  const pairMap = new Map<string, LintFinding>();
  for (let i = 0; i < wordings.length; i++)
    for (let j = i + 1; j < wordings.length; j++) {
      const a = wordings[i]!;
      const b = wordings[j]!;
      if (similarity(a, b) < 0.75) continue;
      const [common, rare] = byWording.get(a)!.length >= byWording.get(b)!.length ? [a, b] : [b, a];
      const f: LintFinding = {
        kind: 'two-wordings',
        message: `Two wordings for what may be the same effect: “${rare}” (${byWording.get(rare)!.length}) and “${common}” (${byWording.get(common)!.length})`,
        suggestion: common,
        cards: [...byWording.get(rare)!, ...byWording.get(common)!].map(ref),
      };
      pairMap.set(`${a}|${b}`, f);
      found.push(f);
    }

  const styleMap = new Map<string, LintFinding>();
  for (const r of style) {
    if (!r.find?.trim()) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${r.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
    for (const p of all) if (re.test(p.text)) add(`style:${r.find}`, { kind: 'style', message: `House style: write “${r.use}” instead of “${r.find}”`, suggestion: r.use }, p, styleMap);
  }

  const spaceMap = new Map<string, LintFinding>();
  for (const p of all) {
    if (/ {2,}/.test(p.text)) add('double', { kind: 'spacing', message: 'Two spaces in a row' }, p, spaceMap);
    if (/ [.,;:!?]/.test(p.text)) add('before', { kind: 'spacing', message: 'A space before a punctuation mark' }, p, spaceMap);
  }
  return found;
}
