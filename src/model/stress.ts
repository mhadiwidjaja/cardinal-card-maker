import { run, toBool } from '../expr/expr';
import { cardResolver } from './cardContext';
import { resolveFace } from './resolve';
import type { Card, CardSet, Field, Game, Layer } from './types';

export interface StressCard {
  label: string;
  card: Card;
}

export interface NeverShown {
  layer: string;
  showIf: string;
}

export const MAX_COMBOS = 36;

const isText = (f: Field) => (f.type === 'text' || f.type === 'richtext') && !f.computed;

function cardsFor(game: Game, templateId: string): { card: Card; set: CardSet }[] {
  const all = game.sets.flatMap((set) => set.cards.map((card) => ({ card, set })));
  const tf = game.def.fields.find((f) => f.source === 'templates')?.id ?? 'template';
  const own = all.filter((x) => (x.card.values[tf] ?? '').trim().toLowerCase() === templateId.toLowerCase());
  return own.length ? own : all;
}

function allLayers(game: Game, templateId: string): Layer[] {
  const out: Layer[] = [];
  const walk = (ls: Layer[]) => {
    for (const l of ls) {
      out.push(l);
      if (l.type === 'group') walk(l.layers ?? []);
    }
  };
  for (const face of Object.keys(game.templates[templateId]?.faces ?? { front: {} })) {
    const f = resolveFace(game.templates, templateId, face);
    if (f) walk(f.layers);
  }
  return out;
}

/**
 * Choice, multi-choice and yes/no fields the template looks at anywhere: show-if
 * rules, picture paths (`frames/{element}.png`), colours (`{color.element}`), text.
 */
export function switchFields(game: Game, templateId: string): Field[] {
  const rules = allLayers(game, templateId)
    .map((l) => JSON.stringify({ ...l, layers: undefined }))
    .join(' ')
    .toLowerCase();
  return game.def.fields.filter((f) => (f.type === 'choice' || f.type === 'multi' || f.type === 'boolean') && f.source !== 'templates' && new RegExp(`\\b${f.id.toLowerCase()}\\b`).test(rules));
}

function valuesOf(f: Field): string[] {
  if (f.type === 'boolean') return ['true', 'false'];
  return [...(f.choices ?? [])];
}

export function stressCards(game: Game, templateId: string): StressCard[] {
  const pool = cardsFor(game, templateId);
  const base: Card = pool[0]?.card ?? { id: 'stress', row: 0, values: {} };
  const tf = game.def.fields.find((f) => f.source === 'templates')?.id ?? 'template';
  const make = (id: string, label: string, values: Record<string, string>): StressCard => ({
    label,
    card: { id: `stress-${id}`, row: base.row, values: { ...base.values, ...values, [tf]: templateId } },
  });
  const out: StressCard[] = [];

  const longest: Record<string, string> = {};
  for (const f of game.def.fields) {
    if (f.computed || f.source === 'templates' || f.type === 'image') continue;
    const vals = pool.map((x) => x.card.values[f.id] ?? '').filter((v) => v.trim() !== '');
    if (!vals.length) continue;
    longest[f.id] = vals.reduce((a, b) => (b.length > a.length ? b : a));
  }
  out.push(make('longest', 'Every field at its longest', longest));

  for (const f of game.def.fields.filter(isText)) {
    if (!longest[f.id]) continue;
    out.push(make(`long-${f.id}`, `Longest ${f.label ?? f.id}`, { [f.id]: longest[f.id]! }));
  }

  const empty: Record<string, string> = {};
  for (const f of game.def.fields) if (!f.computed && !f.identifying && f.source !== 'templates') empty[f.id] = '';
  out.push(make('empty', 'Optional fields empty', empty));

  const fields = switchFields(game, templateId);
  let combos: Record<string, string>[] = [{}];
  for (const f of fields) {
    const next: Record<string, string>[] = [];
    for (const c of combos) for (const v of valuesOf(f)) next.push({ ...c, [f.id]: v });
    combos = next;
    if (combos.length > MAX_COMBOS) break;
  }
  if (fields.length) {
    for (const c of combos.slice(0, MAX_COMBOS)) {
      const label = Object.entries(c)
        .map(([k, v]) => `${k} = ${v}`)
        .join(', ');
      out.push(make(`combo-${label}`, label, c));
    }
  }
  return out;
}

export function neverShown(game: Game, templateId: string): NeverShown[] {
  const pool = cardsFor(game, templateId);
  const out: NeverShown[] = [];
  for (const l of allLayers(game, templateId)) {
    const rule = l.showIf?.trim();
    if (!rule) continue;
    const shown = pool.some(({ card, set }) => {
      try {
        return toBool(run(rule, cardResolver(game, card, set)));
      } catch {
        return false;
      }
    });
    if (!shown && !out.some((o) => o.layer === l.id)) out.push({ layer: l.id, showIf: rule });
  }
  return out;
}
