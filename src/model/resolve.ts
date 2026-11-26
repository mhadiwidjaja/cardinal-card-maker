import type { Face, Layer, LayerPatch, TemplateDef } from './types';

/**
 * Template inheritance. A template that `extends` another starts from the
 * parent's layers; its own layer entries then:
 *  - override properties of the inherited layer with the same id
 *    (objects such as `font` are merged; lists such as `rect` are replaced),
 *  - add new layers (at the end, or `after` / `before` a given id),
 *  - drop an inherited layer with `remove: true`.
 * This also works for layers nested inside groups.
 */

export interface ResolvedFace {
  layers: Layer[];
  templateId: string;
}

export function faceNames(templates: Record<string, TemplateDef>, id: string): string[] {
  const names = new Set<string>();
  for (const t of chain(templates, id)) for (const f of Object.keys(t.faces)) names.add(f);
  return [...names].sort((a, b) => (a === 'front' ? -1 : b === 'front' ? 1 : a.localeCompare(b)));
}

export function resolveFace(templates: Record<string, TemplateDef>, id: string, face: string, depth = 0): ResolvedFace | null {
  if (depth > 10) return null;
  const list = chain(templates, id);
  if (list.length === 0) return null;

  // The nearest template that says anything about this face decides whether it delegates.
  for (let i = list.length - 1; i >= 0; i--) {
    const f: Face | undefined = list[i]!.faces[face];
    if (!f) continue;
    if (f.useTemplate) return resolveFace(templates, f.useTemplate, 'front', depth + 1);
    break;
  }

  let layers: Layer[] | null = null;
  for (const t of list) {
    const f = t.faces[face];
    if (!f || f.useTemplate) continue;
    layers = applyPatches(layers ?? [], f.layers ?? []);
  }
  return layers ? { layers, templateId: id } : null;
}

export function chain(templates: Record<string, TemplateDef>, id: string): TemplateDef[] {
  const out: TemplateDef[] = [];
  const seen = new Set<string>();
  let cur = templates[id];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.extends ? templates[cur.extends] : undefined;
  }
  return out;
}

export function applyPatches(base: Layer[], patches: LayerPatch[]): Layer[] {
  let layers = clone(base);
  for (const patch of patches) {
    const { after, before, remove, ...props } = patch;
    const found = findLayer(layers, patch.id);
    if (remove) {
      if (found) found.list.splice(found.index, 1);
      continue;
    }
    if (found) {
      const merged = mergeLayer(found.list[found.index]!, props as LayerPatch);
      found.list.splice(found.index, 1);
      insert(layers, merged, after, before, found.list, found.index);
    } else {
      insert(layers, clone(props) as Layer, after, before);
    }
  }
  return layers;

  function insert(root: Layer[], layer: Layer, after?: string, before?: string, fallbackList?: Layer[], fallbackIndex?: number) {
    const anchor = after ?? before;
    const target = anchor ? findLayer(root, anchor) : null;
    if (target) target.list.splice(target.index + (after ? 1 : 0), 0, layer);
    else if (fallbackList && fallbackIndex !== undefined) fallbackList.splice(fallbackIndex, 0, layer);
    else root.push(layer);
  }
}

export function findLayer(layers: Layer[], id: string): { list: Layer[]; index: number } | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!;
    if (l.id === id) return { list: layers, index: i };
    if (l.type === 'group') {
      const inner = findLayer(l.layers, id);
      if (inner) return inner;
    }
  }
  return null;
}

export function walkLayers(layers: Layer[], visit: (l: Layer) => void) {
  for (const l of layers) {
    visit(l);
    if (l.type === 'group') walkLayers(l.layers, visit);
  }
}

function mergeLayer(base: Layer, patch: LayerPatch): Layer {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (k === 'layers' && Array.isArray(v) && base.type === 'group') out[k] = applyPatches(base.layers, v as LayerPatch[]);
    else if (isPlainObject(v) && isPlainObject(out[k])) out[k] = { ...(out[k] as object), ...v };
    else out[k] = clone(v);
  }
  return out as unknown as Layer;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/** Is this template sideways? The nearest template in the `extends` chain that says so decides. */
export function isLandscape(templates: Record<string, TemplateDef>, id: string): boolean {
  const list = chain(templates, id);
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i]!.orientation;
    if (o) return o === 'landscape';
  }
  return false;
}

/**
 * Orientation of one face. A face that uses another template (e.g. a shared
 * card back) takes that template's orientation.
 */
export function isFaceLandscape(templates: Record<string, TemplateDef>, id: string, face: string): boolean {
  const resolved = resolveFace(templates, id, face);
  return isLandscape(templates, resolved?.templateId ?? id);
}
