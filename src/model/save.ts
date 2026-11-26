import { joinPath } from '../fs/types';
import { toCsv } from './csv';
import type { CardSet, Game, GameDef, SetDef, TemplateDef } from './types';

/**
 * Serialization for saving. JSON is pretty-printed with short arrays and
 * objects kept on one line, so files stay readable and diff well.
 */
export function prettyJson(value: unknown, indent = 0, width = 100): string {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  const flat = JSON.stringify(value);
  if (flat === undefined) return 'null';
  if (typeof value !== 'object' || value === null) return flat;
  if (flat.length + pad.length <= width && !containsLongNested(value)) return spaced(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => inner + prettyJson(v, indent + 1, width)).join(',\n')}\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${prettyJson(v, indent + 1, width)}`).join(',\n')}\n${pad}}`;
}

/** Objects containing lists of objects (e.g. a group's layers) always get expanded. */
function containsLongNested(value: object): boolean {
  const isObj = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (Array.isArray(value)) return value.some(isObj);
  return Object.values(value).some((v) => Array.isArray(v) && v.some(isObj));
}

function spaced(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(spaced).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${spaced(v)}`).join(', ')} }`;
  }
  return JSON.stringify(value);
}

export function templatePath(game: Game, id: string): string {
  return joinPath(game.path, 'templates', `${id}.json`);
}

export function templateText(t: TemplateDef): string {
  const { formatVersion, id, name, extends: ext, abstract, faces, ...rest } = t;
  return prettyJson({ formatVersion, id, name, extends: ext, abstract, ...rest, faces }) + '\n';
}

export function gameText(def: GameDef): string {
  const { formatVersion, name, card, fields, ...rest } = def;
  return prettyJson({ formatVersion, name, card, ...rest, fields }) + '\n';
}

export function setText(def: SetDef): string {
  return prettyJson(def) + '\n';
}

export function cardsText(set: CardSet): string {
  const columns = set.columns.length ? [...set.columns] : ['id'];
  if (!columns.includes('id')) columns.unshift('id');
  for (const c of set.cards) for (const k of Object.keys(c.values)) if (!columns.includes(k)) columns.push(k);
  return toCsv(
    columns,
    set.cards.map((c) => ({ ...c.values, id: c.id })),
  );
}
