import { run, splitList, toText, type Resolver, type Value } from '../expr/expr';
import type { Card, CardSet, Field, Game } from './types';

/**
 * Builds the name lookup used by template expressions for one card:
 *   <field id>        the card's value (or the field's default when empty)
 *   template.name     display name of the card's template
 *   card.number       position in the set (1-based), card.total = set size
 *   card.id
 *   set.name, set.code, game.name
 *   var.<name>        game variables from game.json
 *   color.<field>     the color game.json assigns to the field's (first) value
 */
export function cardResolver(game: Game, card: Card, set?: CardSet): Resolver {
  const fields = new Map<string, Field>(game.def.fields.map((f) => [f.id, f]));
  const computing = new Set<string>();
  const number = set ? set.cards.indexOf(card) + 1 : 0;

  const resolve: Resolver = (name: string): Value | undefined => {
    const field = fields.get(name);
    if (field) return fieldValue(field);
    if (name in card.values) return card.values[name];

    const dot = name.indexOf('.');
    if (dot === -1) return undefined;
    const scope = name.slice(0, dot);
    const key = name.slice(dot + 1);
    switch (scope) {
      case 'template': {
        const id = card.values.template ?? '';
        const t = game.templates[id];
        if (key === 'name') return t?.name ?? id;
        if (key === 'id') return id;
        return undefined;
      }
      case 'card':
        if (key === 'number') return number;
        if (key === 'total') return set?.cards.length ?? 0;
        if (key === 'id') return card.id;
        return undefined;
      case 'set':
        if (key === 'name') return set?.def.name ?? '';
        if (key === 'code') return set?.def.code ?? '';
        return undefined;
      case 'game':
        if (key === 'name') return game.def.name;
        return undefined;
      case 'var':
        return game.def.variables?.[key];
      case 'color': {
        const f = fields.get(key);
        if (!f?.colors) return undefined;
        const first = splitList(f ? (fieldValue(f) ?? '') : '')[0];
        if (first === undefined) return undefined;
        const hit = Object.entries(f.colors).find(([k]) => k.toLowerCase() === first.toLowerCase());
        return hit?.[1];
      }
    }
    return undefined;
  };

  function fieldValue(f: Field): Value | undefined {
    if (f.computed) {
      if (computing.has(f.id)) return '';
      computing.add(f.id);
      try {
        return run(f.computed, resolve);
      } catch {
        return '';
      } finally {
        computing.delete(f.id);
      }
    }
    const v = card.values[f.id];
    if ((v === undefined || v.trim() === '') && f.default !== undefined) return toText(f.default as Value);
    return v;
  }

  return resolve;
}
