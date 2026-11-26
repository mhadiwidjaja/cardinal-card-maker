import type { Field } from './types';

/**
 * Per-card art framing: how far a card's picture is zoomed and which part of
 * it shows inside the template's image box. Stored in an extra cards.csv
 * column next to the image field, e.g. `art.frame` = `1.4 0.3 0.6`
 * (zoom, then the focus point across and down, each 0..1). An empty cell
 * means "as the template says".
 */
export interface Framing {
  zoom: number;
  fx: number;
  fy: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 10;

export function framingColumn(fieldId: string): string {
  return `${fieldId}.frame`;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function parseFraming(text: string | undefined): Framing | null {
  const parts = (text ?? '').trim().split(/[\s,;]+/).filter(Boolean).map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite)) return null;
  const [zoom, fx, fy] = parts as [number, number, number];
  return { zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM), fx: clamp(fx, 0, 1), fy: clamp(fy, 0, 1) };
}

export function formatFraming(f: Framing): string {
  const r = (n: number) => String(Math.round(n * 1000) / 1000);
  return `${r(clamp(f.zoom, MIN_ZOOM, MAX_ZOOM))} ${r(clamp(f.fx, 0, 1))} ${r(clamp(f.fy, 0, 1))}`;
}

/**
 * The image field an image layer shows, found from its `src`: the layer's
 * expressions must reference exactly one field of type "image"
 * (e.g. `art/{art}`). Otherwise the layer has no per-card framing.
 */
export function framedField(src: string, fields: Field[]): string | null {
  const images = new Map(fields.filter((f) => f.type === 'image').map((f) => [f.id.toLowerCase(), f.id]));
  const found = new Set<string>();
  for (const m of src.matchAll(/\{([^{}]*)\}/g)) {
    for (const word of m[1]!.match(/[A-Za-z_][\w]*/g) ?? []) {
      const id = images.get(word.toLowerCase());
      if (id) found.add(id);
    }
  }
  return found.size === 1 ? [...found][0]! : null;
}

export function isFramingColumn(column: string, fields: Field[]): boolean {
  return fields.some((f) => f.type === 'image' && framingColumn(f.id) === column);
}
