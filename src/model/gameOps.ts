import { joinPath } from '../fs/types';
import type { CardSet, Field, Game, GameDef, Layer, LayerPatch, TemplateDef } from './types';

export const CARD_PRESETS: { name: string; w: number; h: number }[] = [
  { name: 'Poker / standard TCG (63 × 88)', w: 63, h: 88 },
  { name: 'Bridge (56 × 88)', w: 56, h: 88 },
  { name: 'Mini American (41 × 63)', w: 41, h: 63 },
  { name: 'Mini European (44 × 68)', w: 44, h: 68 },
  { name: 'Tarot (70 × 120)', w: 70, h: 120 },
  { name: 'Square (70 × 70)', w: 70, h: 70 },
  { name: 'Japanese small (59 × 86)', w: 59, h: 86 },
];

/**
 * Scales every length in a template by `f` (used when the design DPI changes,
 * so the card keeps looking the same).
 */
export function scaleTemplate(t: TemplateDef, f: number): TemplateDef {
  const s = (n: unknown) => (typeof n === 'number' ? Math.round(n * f * 100) / 100 : n);
  const pts = (p: unknown) => (Array.isArray(p) ? p.map((xy) => (Array.isArray(xy) ? xy.map(s) : xy)) : p);
  const layer = (l: LayerPatch): LayerPatch => {
    const o = JSON.parse(JSON.stringify(l)) as Record<string, unknown>;
    for (const k of ['rect', 'offset']) if (Array.isArray(o[k])) o[k] = (o[k] as unknown[]).map(s);
    for (const k of ['points', 'polygon']) if (o[k]) o[k] = pts(o[k]);
    for (const k of ['radius', 'letterSpacing', 'size', 'gap']) if (k in o) o[k] = s(o[k]);
    const obj = (k: string) => o[k] as Record<string, unknown> | undefined;
    if (obj('font')) obj('font')!.size = s(obj('font')!.size);
    if (obj('shrink')) obj('shrink')!.min = s(obj('shrink')!.min);
    if (obj('stroke')) obj('stroke')!.width = s(obj('stroke')!.width);
    if (obj('shadow')) for (const k of ['blur', 'dx', 'dy']) if (k in obj('shadow')!) obj('shadow')![k] = s(obj('shadow')![k]);
    const clip = obj('clip');
    if (clip) {
      if (Array.isArray(clip.rect)) clip.rect = (clip.rect as unknown[]).map(s);
      if (clip.points) clip.points = pts(clip.points);
      if ('radius' in clip) clip.radius = s(clip.radius);
    }
    if (Array.isArray(o.layers)) o.layers = (o.layers as LayerPatch[]).map(layer);
    return o as unknown as LayerPatch;
  };
  const faces: TemplateDef['faces'] = {};
  for (const [name, face] of Object.entries(t.faces)) faces[name] = face.layers ? { ...face, layers: face.layers.map(layer) } : { ...face };
  return { ...t, faces };
}

export function canvasPx(widthMm: number, heightMm: number, bleedMm: number, dpi: number) {
  const px = (mm: number) => Math.round((mm / 25.4) * dpi);
  return { w: px(widthMm + 2 * bleedMm), h: px(heightMm + 2 * bleedMm), bleed: px(bleedMm), safe: px(bleedMm + 3) };
}

export function newGame(name: string, id: string, gamePath: string, size: { w: number; h: number }, bleedMm = 3, dpi = 300): Game {
  const fields: Field[] = [
    { id: 'name', type: 'text', identifying: true },
    { id: 'template', type: 'choice', source: 'templates' },
    { id: 'cost', type: 'number', min: 0 },
    { id: 'type', type: 'text', label: 'Type' },
    { id: 'rarity', type: 'choice', choices: ['Common', 'Uncommon', 'Rare'] },
    { id: 'rules', type: 'richtext' },
    { id: 'art', type: 'image' },
    { id: 'count', type: 'number', default: 1, role: 'quantity', stats: { hidden: true } },
  ];
  const def: GameDef = {
    formatVersion: 1,
    name,
    card: { widthMm: size.w, heightMm: size.h, bleedMm, safeMm: 3, dpi, cornerRadiusMm: 3 },
    fields,
    icons: { aliases: {} },
    keywords: [],
    statistics: [{ field: 'cost', numeric: true, bin: 1 }, { field: 'rarity' }, { field: 'template' }],
    text: { smartPunctuation: true },
  };
  const { w, h, safe } = canvasPx(size.w, size.h, bleedMm, dpi);
  const inner = w - 2 * safe;
  const u = (n: number) => Math.round((n / 815) * w);
  const v = (n: number) => Math.round((n / 1110) * h);
  const baseLayers: Layer[] = [
    { id: 'background', type: 'shape', shape: 'rect', rect: [0, 0, w, h], fill: '#2b2b33' },
    { id: 'frame', type: 'shape', shape: 'roundrect', rect: [u(36), v(36), w - 2 * u(36), h - 2 * v(36)], radius: u(24), fill: '#efe9da', stroke: { color: '#1b1b22', width: u(6) } },
    { id: 'art', type: 'image', src: 'art/{art}', fit: 'cover', rect: [safe, v(140), inner, v(470)], radius: u(10) },
    { id: 'name', type: 'text', text: '{name}', rect: [safe, v(66), inner - u(100), v(64)], font: { family: 'serif', size: u(44), weight: 700 }, color: '#1b1b22', valign: 'middle', shrink: { min: u(26) } },
    { id: 'costBubble', type: 'shape', shape: 'ellipse', rect: [w - safe - u(82), v(58), u(82), u(82)], fill: '#1b1b22' },
    { id: 'costText', type: 'text', text: '{cost}', showIf: "cost != ''", rect: [w - safe - u(82), v(58), u(82), u(82)], font: { family: 'sans-serif', size: u(46), weight: 700 }, color: '#ffffff', align: 'center', valign: 'middle' },
    { id: 'typeLine', type: 'text', text: "{template.name}{if(type != '', ' — ' + type, '')}", rect: [safe, v(625), inner, v(50)], font: { family: 'serif', size: u(30), style: 'italic' }, color: '#1b1b22', valign: 'middle' },
    { id: 'rules', type: 'text', text: '{rules}', rect: [safe + u(8), v(690), inner - u(16), v(330)], font: { family: 'serif', size: u(34) }, color: '#1b1b22', lineHeight: 1.15, paragraphSpacing: 0.25, shrink: { min: u(20) } },
  ];
  const templates: Record<string, TemplateDef> = {
    _base: { formatVersion: 1, id: '_base', name: 'Base', abstract: true, faces: { front: { layers: baseLayers }, back: { useTemplate: 'back' } } },
    card: { formatVersion: 1, id: 'card', name: 'Card', extends: '_base', faces: { front: { layers: [] } } },
    back: {
      formatVersion: 1,
      id: 'back',
      name: 'Card back',
      abstract: true,
      faces: {
        front: {
          layers: [
            { id: 'background', type: 'shape', shape: 'rect', rect: [0, 0, w, h], fill: '#3b2a5c' },
            { id: 'title', type: 'text', text: '{game.name}', rect: [safe, Math.round(h / 2 - v(60)), inner, v(120)], font: { family: 'serif', size: u(64), weight: 700 }, color: '#e9c46a', align: 'center', valign: 'middle', shrink: { min: u(24) } },
          ],
        },
      },
    },
  };
  const set: CardSet = {
    id: 'core',
    path: joinPath(gamePath, 'sets', 'core'),
    def: { formatVersion: 1, name: 'Core Set', code: id.slice(0, 4).toUpperCase() },
    columns: ['id', ...fields.map((f) => f.id)],
    cards: [{ id: 'c001', row: 2, values: { id: 'c001', name: 'First Card', template: 'card', cost: '1', type: '', rarity: 'Common', rules: 'Write the rules text here. Use [[name] for icons, *bold* and _italic_.', art: '', count: '1' } }],
  };
  return { id, path: gamePath, def, templates, sets: [set] };
}
