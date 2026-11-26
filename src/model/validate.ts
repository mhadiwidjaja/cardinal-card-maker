import type { CardSize, Field, FieldType, GameDef, Issue, SetDef, TemplateDef, WorkspaceDef } from './types';

/**
 * Checks parsed JSON against the expected shape. Problems are reported as
 * issues rather than thrown, so one bad file never stops the rest of the
 * workspace from loading. Returns null when the file can't be used at all.
 */

const FIELD_TYPES: FieldType[] = ['text', 'richtext', 'number', 'boolean', 'choice', 'multi', 'image', 'color'];
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function validateWorkspace(data: Obj, file: string, issues: Issue[]): WorkspaceDef {
  if (data.name !== undefined && typeof data.name !== 'string') {
    issues.push({ level: 'warning', file, message: '"name" should be text' });
  }
  return { formatVersion: data.formatVersion as number, name: typeof data.name === 'string' ? data.name : undefined };
}

export function validateGame(data: Obj, file: string, issues: Issue[]): GameDef | null {
  const err = (message: string) => issues.push({ level: 'error', file, message });
  const warn = (message: string) => issues.push({ level: 'warning', file, message });

  if (typeof data.name !== 'string' || data.name.trim() === '') err('"name" is required');

  const card = data.card;
  if (!isObj(card)) {
    err('"card" (card size settings) is required');
  } else {
    for (const key of ['widthMm', 'heightMm', 'dpi'] as const) {
      if (!isPositive(card[key])) err(`card.${key} must be a number greater than 0`);
    }
    for (const key of ['bleedMm', 'safeMm'] as const) {
      if (card[key] !== undefined && !isNonNegative(card[key])) err(`card.${key} must be 0 or more`);
    }
  }

  if (!Array.isArray(data.fields)) {
    err('"fields" must be a list');
  } else {
    const seen = new Set<string>();
    data.fields.forEach((f, i) => {
      const where = `fields[${i}]`;
      if (!isObj(f)) return err(`${where} must be an object`);
      if (typeof f.id !== 'string' || !ID_PATTERN.test(f.id)) {
        return err(`${where}: "id" must start with a letter and use only letters, digits, _ or -`);
      }
      if (seen.has(f.id.toLowerCase())) err(`Field "${f.id}" is defined twice`);
      seen.add(f.id.toLowerCase());
      if (!FIELD_TYPES.includes(f.type as FieldType)) {
        err(`Field "${f.id}": type must be one of ${FIELD_TYPES.join(', ')}`);
      }
      if ((f.type === 'choice' || f.type === 'multi') && f.source === undefined) {
        if (!Array.isArray(f.choices) || f.choices.length === 0) warn(`Field "${f.id}" has no "choices"`);
      }
    });
  }

  if (issues.some((i) => i.file === file && i.level === 'error')) return null;

  const c = card as Obj;
  const size: CardSize = {
    widthMm: c.widthMm as number,
    heightMm: c.heightMm as number,
    bleedMm: (c.bleedMm as number | undefined) ?? 0,
    safeMm: (c.safeMm as number | undefined) ?? 0,
    dpi: c.dpi as number,
    cornerRadiusMm: c.cornerRadiusMm as number | undefined,
  };
  return { ...(data as unknown as GameDef), card: size, fields: data.fields as Field[] };
}

export function validateTemplate(data: Obj, file: string, fallbackId: string, issues: Issue[]): TemplateDef | null {
  const err = (message: string) => issues.push({ level: 'error', file, message });
  const id = data.id ?? fallbackId;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    err('"id" must start with a letter or _ and use only letters, digits, _ or -');
    return null;
  }
  if (id !== fallbackId) {
    issues.push({ level: 'warning', file, message: `"id" is "${id}" but the file is named "${fallbackId}.json"` });
  }
  if (data.extends !== undefined && typeof data.extends !== 'string') err('"extends" must be a template id');
  if (data.orientation !== undefined && data.orientation !== 'portrait' && data.orientation !== 'landscape') {
    issues.push({ level: 'warning', file, message: '"orientation" should be "portrait" or "landscape"; using portrait' });
    delete data.orientation;
  }
  if (!isObj(data.faces)) {
    err('"faces" is required, e.g. { "front": { "layers": [] } }');
    return null;
  }
  for (const [name, face] of Object.entries(data.faces)) {
    if (!isObj(face)) err(`faces.${name} must be an object`);
    else if (face.layers !== undefined && !Array.isArray(face.layers)) err(`faces.${name}.layers must be a list`);
  }
  if (issues.some((i) => i.file === file && i.level === 'error')) return null;
  return { ...(data as unknown as TemplateDef), id };
}

export function validateSet(data: Obj, file: string, fallbackName: string, issues: Issue[]): SetDef {
  if (data.name !== undefined && typeof data.name !== 'string') {
    issues.push({ level: 'warning', file, message: '"name" should be text' });
  }
  return {
    ...(data as unknown as SetDef),
    name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name : fallbackName,
  };
}
