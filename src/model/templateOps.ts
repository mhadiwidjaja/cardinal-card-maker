import { findLayer, resolveFace } from './resolve';
import type { Layer, LayerPatch, LayerType, Rect, TemplateDef } from './types';

/**
 * Editing operations on a template face. They work on the *resolved* view
 * (what the user sees) and write the minimal change into the template's own
 * layer list: new layers are stored in full, inherited layers as patches.
 * All functions return a new TemplateDef and never modify their input.
 */

type Templates = Record<string, TemplateDef>;

function cloneT(t: TemplateDef): TemplateDef {
  return JSON.parse(JSON.stringify(t)) as TemplateDef;
}

function ownLayers(t: TemplateDef, face: string): LayerPatch[] {
  if (!t.faces[face]) t.faces[face] = { layers: [] };
  const f = t.faces[face]!;
  if (f.useTemplate) delete f.useTemplate;
  if (!f.layers) f.layers = [];
  return f.layers;
}

export function inheritedIds(templates: Templates, id: string, face: string): Set<string> {
  const ids = new Set<string>();
  const t = templates[id];
  if (!t?.extends) return ids;
  const parent = resolveFace(templates, t.extends, face);
  const visit = (layers: Layer[]) => {
    for (const l of layers) {
      ids.add(l.id);
      if (l.type === 'group') visit(l.layers);
    }
  };
  if (parent) visit(parent.layers);
  return ids;
}

function findOwn(list: LayerPatch[], id: string): { list: LayerPatch[]; index: number } | null {
  return findLayer(list as Layer[], id) as { list: LayerPatch[]; index: number } | null;
}

/**
 * Sets a property of a layer. `path` is the property path, e.g. ["font", "size"]
 * or ["rect"]. A value of undefined removes the property (for inherited layers
 * it is reset to the inherited value).
 */
export function setLayerProp(templates: Templates, id: string, face: string, layerId: string, path: string[], value: unknown): TemplateDef {
  const t = cloneT(templates[id]!);
  const list = ownLayers(t, face);
  const inherited = inheritedIds(templates, id, face).has(layerId);
  let found = findOwn(list, layerId);
  if (!found) {
    if (!inherited) return t;
    list.push({ id: layerId });
    found = { list, index: list.length - 1 };
  }
  const entry = found.list[found.index] as Record<string, unknown>;
  setPath(entry, path, value, inherited && !('type' in entry));
  // An inherited-layer patch with nothing left in it can go.
  if (inherited && Object.keys(entry).length === 1) found.list.splice(found.index, 1);
  return t;
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown, isPatch: boolean) {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    if (value === undefined) delete obj[head];
    else obj[head] = JSON.parse(JSON.stringify(value));
    return;
  }
  let child = obj[head];
  if (typeof child !== 'object' || child === null || Array.isArray(child)) {
    child = {};
    obj[head] = child;
  }
  setPath(child as Record<string, unknown>, rest, value, isPatch);
  if (isPatch && Object.keys(child as object).length === 0) delete obj[head];
}

export function replaceOwnEntry(templates: Templates, id: string, face: string, layerId: string, entry: LayerPatch | null): TemplateDef {
  const t = cloneT(templates[id]!);
  const list = ownLayers(t, face);
  const found = findOwn(list, layerId);
  if (found) {
    if (entry) found.list[found.index] = entry;
    else found.list.splice(found.index, 1);
  } else if (entry) list.push(entry);
  return t;
}

export function ownEntry(t: TemplateDef, face: string, layerId: string): LayerPatch | null {
  const list = t.faces[face]?.layers ?? [];
  const found = findOwn(list, layerId);
  return found ? found.list[found.index]! : null;
}

export function uniqueLayerId(templates: Templates, base: string): string {
  const used = new Set<string>();
  for (const t of Object.values(templates))
    for (const f of Object.values(t.faces))
      for (const l of f.layers ?? []) {
        used.add(l.id);
        if ((l as Layer).type === 'group') for (const c of (l as { layers?: LayerPatch[] }).layers ?? []) used.add(c.id);
      }
  let n = 1;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function defaultLayer(type: LayerType, id: string, at: Rect): Layer {
  switch (type) {
    case 'shape':
      return { id, type, shape: 'roundrect', rect: at, radius: 12, fill: '#cccccc' };
    case 'image':
      return { id, type, src: '', rect: at, fit: 'cover' };
    case 'text':
      return { id, type, text: 'Text', rect: at, font: { family: 'serif', size: 36 }, color: '#000000', valign: 'middle' };
    case 'icons':
      return { id, type, icons: '', rect: at, align: 'center' };
    case 'group':
      return { id, type, layers: [] };
  }
}

export function addLayer(templates: Templates, id: string, face: string, layer: Layer, afterId?: string, intoGroup?: string): TemplateDef {
  const t = cloneT(templates[id]!);
  const list = ownLayers(t, face);
  if (intoGroup) {
    const own = findOwn(list, intoGroup);
    if (own && (own.list[own.index] as Layer).type === 'group') {
      const g = own.list[own.index] as { layers?: LayerPatch[] };
      (g.layers ??= []).push(layer);
    } else {
      const patch = own ? (own.list[own.index] as { layers?: LayerPatch[] }) : (list.push({ id: intoGroup }), list[list.length - 1] as { layers?: LayerPatch[] });
      (patch.layers ??= []).push(layer);
    }
    return t;
  }
  const entry: LayerPatch = { ...layer };
  if (afterId) {
    const own = findOwn(list, afterId);
    if (own && own.list === list) {
      list.splice(own.index + 1, 0, entry);
      return t;
    }
    if (t.extends) entry.after = afterId;
  }
  list.push(entry);
  return t;
}

export function deleteLayer(templates: Templates, id: string, face: string, layerId: string): TemplateDef {
  const t = cloneT(templates[id]!);
  const list = ownLayers(t, face);
  const inherited = inheritedIds(templates, id, face).has(layerId);
  const found = findOwn(list, layerId);
  if (found) found.list.splice(found.index, 1);
  if (inherited) list.push({ id: layerId, remove: true });
  return t;
}

export function moveLayer(templates: Templates, id: string, face: string, layerId: string, direction: 1 | -1): TemplateDef {
  const resolved = resolveFace(templates, id, face);
  if (!resolved) return templates[id]!;
  const where = findLayer(resolved.layers, layerId);
  if (!where) return templates[id]!;
  const siblings = where.list.map((l) => l.id);
  const from = where.index;
  const to = from + direction;
  if (to < 0 || to >= siblings.length) return templates[id]!;
  siblings.splice(from, 1);
  siblings.splice(to, 0, layerId);
  return reorder(templates, id, face, siblings, where.list === resolved.layers ? null : parentGroupId(resolved.layers, layerId));
}

function parentGroupId(layers: Layer[], childId: string): string | null {
  for (const l of layers) {
    if (l.type !== 'group') continue;
    if (l.layers.some((c) => c.id === childId)) return l.id;
    const inner = parentGroupId(l.layers, childId);
    if (inner) return inner;
  }
  return null;
}

function reorder(templates: Templates, id: string, face: string, order: string[], groupId: string | null): TemplateDef {
  const t = cloneT(templates[id]!);
  const root = ownLayers(t, face);
  const inherited = inheritedIds(templates, id, face);

  let list = root;
  if (groupId) {
    const g = findOwn(root, groupId);
    if (g && !inherited.has(groupId)) list = ((g.list[g.index] as { layers?: LayerPatch[] }).layers ??= []);
    else {
      // Children of an inherited group: patch the group's `layers`.
      const patch = g ? g.list[g.index]! : (root.push({ id: groupId }), root[root.length - 1]!);
      list = ((patch as { layers?: LayerPatch[] }).layers ??= []);
    }
  }

  const anyInherited = order.some((o) => inherited.has(o));
  for (const [i, layerId] of order.entries()) {
    let entry = list.find((e) => e.id === layerId);
    if (!entry && !anyInherited) continue;
    if (!entry) {
      entry = { id: layerId };
      list.push(entry);
    }
    delete entry.after;
    delete entry.before;
    if (anyInherited) {
      if (i > 0) entry.after = order[i - 1];
      else if (order.length > 1) entry.before = order[1];
    }
  }
  // Keep own entries in the target order so anchors always exist when applied.
  const rank = new Map(order.map((o, i) => [o, i]));
  const inOrder = list.filter((e) => rank.has(e.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  let k = 0;
  for (let i = 0; i < list.length; i++) if (rank.has(list[i]!.id)) list[i] = inOrder[k++]!;
  return t;
}
