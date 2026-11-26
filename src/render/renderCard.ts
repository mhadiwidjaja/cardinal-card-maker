import { interpolate, run, splitList, toBool, type Resolver } from '../expr/expr';
import { addReminders, compileKeywords, type ReminderMode } from '../markup/keywords';
import { iconLookup, parseMarkup, type IconLookup } from '../markup/markup';
import { smartPunctuation } from '../markup/typography';
import { cardResolver } from '../model/cardContext';
import { framedField, framingColumn, parseFraming } from '../model/framing';
import { isFaceLandscape, isLandscape, resolveFace } from '../model/resolve';
import type {
  Card,
  CardSet,
  Game,
  GroupLayer,
  IconDef,
  IconsLayer,
  ImageLayer,
  Layer,
  Paint,
  Pt,
  Rect,
  ShapeLayer,
  TextLayer,
} from '../model/types';
import type { AssetStore, LoadedImage } from './assets';
import { layoutText, type LayoutResult, type Measurer, type Region } from './textLayout';

/**
 * Draws one face of one card. Used by the editor preview and every export,
 * so what you see is what you get.
 *
 * Coordinates in templates are px at the game's design DPI, with the origin
 * at the top-left corner of the bleed area.
 */

export interface RenderRequest {
  game: Game;
  set?: CardSet;
  card: Card;
  face: string;
  dpi?: number;
  bleed: boolean;
  /** "preview" draws placeholders for missing art; "export" leaves them empty. */
  mode: 'preview' | 'export';
  templateId?: string;
}

export interface RenderWarning {
  layer?: string;
  message: string;
}

export interface LayerBox {
  id: string;
  rect: Rect;
  frame?: FrameBox;
  check?: LayerCheck;
}

export interface LayerCheck {
  type: Layer['type'];
  /** Where ink actually landed: the text and icons drawn, or the picture's box. */
  ink?: Rect;
  fontSize?: number;
  designSize?: number;
  overflow?: boolean;
  image?: { src: string; width: number; height: number; drawnW: number; drawnH: number };
  stroke?: number;
}

export interface FrameBox {
  field: string;
  zoom: number;
  fx: number;
  fy: number;
  /** Box size minus drawn picture size, in template px (negative when the picture is larger). */
  slackX: number;
  slackY: number;
}

export interface RenderResult {
  warnings: RenderWarning[];
  boxes: LayerBox[];
  templateId: string | null;
  landscape: boolean;
}

const MM_PER_INCH = 25.4;

export function cardMm(game: Game, landscape = false): { w: number; h: number } {
  const c = game.def.card;
  return landscape ? { w: c.heightMm, h: c.widthMm } : { w: c.widthMm, h: c.heightMm };
}

export function templateSize(game: Game, landscape = false): { width: number; height: number; bleed: number; safe: number } {
  const c = game.def.card;
  const { w, h } = cardMm(game, landscape);
  const px = (mm: number) => Math.round((mm / MM_PER_INCH) * c.dpi);
  return { width: px(w + 2 * c.bleedMm), height: px(h + 2 * c.bleedMm), bleed: px(c.bleedMm), safe: px(c.safeMm) };
}

export function outputSize(game: Game, dpi: number, bleed: boolean, landscape = false): { width: number; height: number } {
  const c = game.def.card;
  const mm = cardMm(game, landscape);
  const w = bleed ? mm.w + 2 * c.bleedMm : mm.w;
  const h = bleed ? mm.h + 2 * c.bleedMm : mm.h;
  return { width: Math.round((w / MM_PER_INCH) * dpi), height: Math.round((h / MM_PER_INCH) * dpi) };
}

export function faceLandscape(game: Game, card: Card, face: string, templateId?: string): boolean {
  const id = templateId ?? templateFor(game, card);
  return id ? isFaceLandscape(game.templates, id, face) : false;
}

export function templateFor(game: Game, card: Card): string | null {
  const id = card.values.template?.trim();
  if (id && game.templates[id]) return id;
  if (id) {
    const ci = Object.keys(game.templates).find((k) => k.toLowerCase() === id.toLowerCase());
    if (ci) return ci;
    return null;
  }
  const usable = Object.values(game.templates).filter((t) => !t.abstract);
  return usable.length === 1 ? usable[0]!.id : null;
}

type Prepared =
  | { kind: 'shape'; layer: ShapeLayer; fill?: string | CanvasGradientSpec; stroke?: { color: string; width: number } }
  | { kind: 'image'; layer: ImageLayer; image: LoadedImage | null; src: string; frame: { field: string; zoom: number; fx: number; fy: number } | null }
  | { kind: 'text'; layer: TextLayer; layout: LayoutResult; color: string; icons: Map<string, LoadedImage | null>; strokeColor?: string; shadowColor?: string; region: Region; ink: Rect | null }
  | { kind: 'icons'; layer: IconsLayer; images: (LoadedImage | null)[]; names: string[] }
  | { kind: 'group'; layer: GroupLayer; children: Prepared[] };

type CanvasGradientSpec = Exclude<Paint, string>;

interface Env {
  game: Game;
  card: Card;
  assets: AssetStore;
  resolve: Resolver;
  icons: IconLookup;
  iconDefs: Record<string, IconDef>;
  keywords: ReturnType<typeof compileKeywords>;
  measure: Measurer;
  warnings: RenderWarning[];
  mode: RenderRequest['mode'];
}

export function gameIcons(game: Game): { defs: Record<string, IconDef>; lookup: IconLookup } {
  const defs: Record<string, IconDef> = {};
  const raw = game.def.icons ?? {};
  for (const [name, v] of Object.entries(raw)) {
    if (name === 'aliases' || !v || typeof (v as IconDef).file !== 'string') continue;
    defs[name] = v as IconDef;
  }
  return { defs, lookup: iconLookup(Object.keys(defs), (raw.aliases as Record<string, string>) ?? {}) };
}

async function prepareLayers(layers: Layer[], env: Env): Promise<Prepared[]> {
  const out: Prepared[] = [];
  for (const layer of layers) {
    if (layer.hidden) continue;
    if (layer.showIf && layer.showIf.trim() !== '') {
      try {
        if (!toBool(run(layer.showIf, env.resolve))) continue;
      } catch (e) {
        env.warnings.push({ layer: layer.id, message: `showIf: ${(e as Error).message}` });
        continue;
      }
    }
    try {
      const p = await prepareLayer(layer, env);
      if (p) out.push(p);
    } catch (e) {
      env.warnings.push({ layer: layer.id, message: (e as Error).message });
    }
  }
  return out;
}

async function prepareLayer(layer: Layer, env: Env): Promise<Prepared | null> {
  switch (layer.type) {
    case 'shape': {
      const fill = layer.fill === undefined ? undefined : resolvePaint(layer.fill, env);
      const stroke = layer.stroke ? { color: interpolate(layer.stroke.color, env.resolve), width: layer.stroke.width } : undefined;
      return { kind: 'shape', layer, fill, stroke };
    }
    case 'image': {
      const src = interpolate(layer.src ?? '', env.resolve).trim();
      const empty = src === '' || src.endsWith('/');
      const image = empty ? null : await env.assets.image(src);
      if (!empty && !image) env.warnings.push({ layer: layer.id, message: `Image not found: ${src}` });
      // A picture chosen by an image field can be framed per card (zoom and focus).
      const field = layer.fit === 'stretch' ? null : framedField(layer.src ?? '', env.game.def.fields);
      const own = field ? parseFraming(env.card.values[framingColumn(field)]) : null;
      const [lfx, lfy] = layer.focus ?? [0.5, 0.5];
      const frame = field ? { field, zoom: own?.zoom ?? 1, fx: own?.fx ?? lfx, fy: own?.fy ?? lfy } : null;
      return { kind: 'image', layer, image, src: empty ? '' : src, frame };
    }
    case 'text': {
      let text = interpolate(layer.text ?? '', env.resolve);
      if (layer.transform === 'uppercase') text = text.toUpperCase();
      if (layer.transform === 'lowercase') text = text.toLowerCase();
      text = addReminders(text, env.keywords, (layer.reminders ?? 'auto') as ReminderMode);
      if (env.game.def.text?.smartPunctuation) text = smartPunctuation(text);
      const tokens = parseMarkup(text, env.icons);
      const icons = new Map<string, LoadedImage | null>();
      for (const t of tokens) {
        if (t.kind === 'icon' && !icons.has(t.name)) icons.set(t.name, await loadIcon(t.name, env));
        if (t.kind === 'unknown') env.warnings.push({ layer: layer.id, message: `Unknown icon ${t.text}` });
      }
      const font = { ...layer.font, family: env.assets.fontFamily(layer.font?.family ?? 'serif'), size: layer.font?.size ?? 24 };
      const region: Region = layer.polygon && layer.polygon.length >= 3
        ? { kind: 'polygon', points: layer.polygon }
        : { kind: 'rect', x: layer.rect?.[0] ?? 0, y: layer.rect?.[1] ?? 0, w: layer.rect?.[2] ?? 100, h: layer.rect?.[3] ?? 100 };
      const layout = layoutText(
        tokens,
        {
          region,
          font,
          lineHeight: layer.lineHeight,
          paragraphSpacing: layer.paragraphSpacing,
          align: layer.align,
          valign: layer.valign,
          shrink: layer.shrink,
          letterSpacing: layer.letterSpacing,
          iconScale: layer.iconScale,
          icon: (name) => {
            const img = icons.get(name);
            const def = env.iconDefs[name];
            return { aspect: img ? img.width / img.height : 1, scale: def?.scale, dx: def?.dx, dy: def?.dy };
          },
        },
        env.measure,
      );
      if (layout.overflow) env.warnings.push({ layer: layer.id, message: 'Text does not fit' });
      return {
        kind: 'text',
        layer,
        layout,
        icons,
        region,
        color: interpolate(layer.color ?? '#000000', env.resolve),
        strokeColor: layer.stroke ? interpolate(layer.stroke.color, env.resolve) : undefined,
        shadowColor: layer.shadow ? interpolate(layer.shadow.color, env.resolve) : undefined,
        ink: textInk(layout, env.measure),
      };
    }
    case 'icons': {
      let names: string[] = [];
      if (layer.repeat) {
        const n = Number(interpolate(layer.repeat.count, env.resolve));
        names = Number.isFinite(n) ? Array(Math.max(0, Math.min(50, Math.floor(n)))).fill(layer.repeat.icon) : [];
      } else if (layer.icons) {
        names = splitList(interpolate(layer.icons, env.resolve));
      }
      const resolved: string[] = [];
      for (const n of names) {
        const r = env.icons.resolve(n);
        if (r) resolved.push(r);
        else env.warnings.push({ layer: layer.id, message: `Unknown icon [${n}]` });
      }
      const images = await Promise.all(resolved.map((n) => loadIcon(n, env)));
      return { kind: 'icons', layer, images, names: resolved };
    }
    case 'group':
      return { kind: 'group', layer, children: await prepareLayers(layer.layers ?? [], env) };
  }
  return null;
}

async function loadIcon(name: string, env: Env): Promise<LoadedImage | null> {
  const def = env.iconDefs[name];
  if (!def) return null;
  const img = await env.assets.image(def.file);
  if (!img) env.warnings.push({ message: `Icon file not found: ${def.file}` });
  return img;
}

function resolvePaint(p: Paint, env: Env): string | CanvasGradientSpec {
  if (typeof p === 'string') return interpolate(p, env.resolve);
  return { ...p, stops: p.stops.map(([o, c]) => [o, interpolate(c, env.resolve)] as [number, string]) } as CanvasGradientSpec;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawAll(ctx: Ctx, items: Prepared[], env: Env, boxes: LayerBox[]) {
  for (const p of items) {
    ctx.save();
    const l = p.layer;
    if (l.opacity !== undefined) ctx.globalAlpha *= Math.max(0, Math.min(1, l.opacity));
    if (l.blend) ctx.globalCompositeOperation = l.blend;
    const box = layerBox(p);
    if (l.rotate && box) {
      const cx = box[0] + box[2] / 2;
      const cy = box[1] + box[3] / 2;
      ctx.translate(cx, cy);
      ctx.rotate((l.rotate * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    if (box) boxes.push({ id: l.id, rect: box, frame: p.kind === 'image' ? frameBox(p) : undefined, check: layerCheck(p, box) });
    switch (p.kind) {
      case 'shape':
        drawShape(ctx, p);
        break;
      case 'image':
        drawImage(ctx, p, env);
        break;
      case 'text':
        drawText(ctx, p, env);
        break;
      case 'icons':
        drawIcons(ctx, p);
        break;
      case 'group': {
        const g = p.layer;
        if (g.offset) ctx.translate(g.offset[0], g.offset[1]);
        if (g.clip) {
          shapePath(ctx, g.clip.shape, g.clip.rect, g.clip.points, g.clip.radius);
          ctx.clip();
        }
        const inner: LayerBox[] = [];
        drawAll(ctx, p.children, env, inner);
        const [ox, oy] = g.offset ?? [0, 0];
        const move = (r: Rect): Rect => [r[0] + ox, r[1] + oy, r[2], r[3]];
        for (const b of inner) boxes.push({ ...b, rect: move(b.rect), check: b.check && { ...b.check, ink: b.check.ink && move(b.check.ink) } });
        break;
      }
    }
    ctx.restore();
  }
}

function layerBox(p: Prepared): Rect | null {
  const l = p.layer;
  if (l.type === 'group') return l.clip?.rect ?? null;
  if (l.type === 'text' && l.polygon && l.polygon.length >= 3) return polyBounds(l.polygon);
  if (l.type === 'shape' && l.shape === 'polygon' && l.points?.length) return polyBounds(l.points);
  return (l as { rect?: Rect }).rect ?? null;
}

function polyBounds(points: Pt[]): Rect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

function shapePath(ctx: Ctx, shape: ShapeLayer['shape'], rect?: Rect, points?: Pt[], radius = 0) {
  ctx.beginPath();
  if (shape === 'polygon') {
    (points ?? []).forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    return;
  }
  const [x, y, w, h] = rect ?? [0, 0, 0, 0];
  if (shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  else if (shape === 'roundrect' && radius > 0) ctx.roundRect(x, y, w, h, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
  else ctx.rect(x, y, w, h);
}

function makeFill(ctx: Ctx, paint: string | CanvasGradientSpec, box: Rect): string | CanvasGradient {
  if (typeof paint === 'string') return paint;
  const [x, y, w, h] = box;
  let g: CanvasGradient;
  if (paint.type === 'radial') {
    g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) / 2);
  } else {
    const a = (((paint.angle ?? 90) - 90) * Math.PI) / 180; // 90° = top to bottom
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  for (const [o, c] of paint.stops) {
    try {
      g.addColorStop(Math.max(0, Math.min(1, o)), c);
    } catch {
      /* invalid colour: skip the stop */
    }
  }
  return g;
}

function drawShape(ctx: Ctx, p: Extract<Prepared, { kind: 'shape' }>) {
  const l = p.layer;
  shapePath(ctx, l.shape, l.rect, l.points, l.radius);
  const box = layerBox(p) ?? [0, 0, 0, 0];
  if (p.fill && p.fill !== 'none' && p.fill !== 'transparent' && p.fill !== '') {
    ctx.fillStyle = makeFill(ctx, p.fill, box);
    ctx.fill();
  }
  if (p.stroke && p.stroke.width > 0 && p.stroke.color !== 'none') {
    ctx.strokeStyle = p.stroke.color;
    ctx.lineWidth = p.stroke.width;
    ctx.stroke();
  }
}

function drawImage(ctx: Ctx, p: Extract<Prepared, { kind: 'image' }>, env: Env) {
  const [x, y, w, h] = p.layer.rect ?? [0, 0, 0, 0];
  ctx.save();
  if (p.layer.radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, p.layer.radius);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  }
  ctx.clip();
  if (!p.image) {
    if (env.mode === 'preview') drawPlaceholder(ctx, [x, y, w, h], p.src ? `missing: ${p.src}` : 'no image');
    ctx.restore();
    return;
  }
  const img = p.image;
  const place = placement(p);
  if (!place) ctx.drawImage(img.source, x, y, w, h);
  else ctx.drawImage(img.source, place.x, place.y, place.w, place.h);
  ctx.restore();
}

/** Where a fitted picture is drawn: scaled to cover or fit the box, times the card's zoom, at the focus point. Null for "stretch". */
function placement(p: Extract<Prepared, { kind: 'image' }>): { x: number; y: number; w: number; h: number } | null {
  const img = p.image;
  const fit = p.layer.fit ?? 'cover';
  if (!img || fit === 'stretch') return null;
  const [x, y, w, h] = p.layer.rect ?? [0, 0, 0, 0];
  const [fx, fy] = p.frame ? [p.frame.fx, p.frame.fy] : (p.layer.focus ?? [0.5, 0.5]);
  const s = (fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height)) * (p.frame?.zoom ?? 1);
  const dw = img.width * s;
  const dh = img.height * s;
  return { x: x + (w - dw) * fx, y: y + (h - dh) * fy, w: dw, h: dh };
}

function textInk(layout: LayoutResult, m: Measurer): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const size = layout.fontSize;
  for (const it of layout.items) {
    if (it.kind === 'icon') {
      x0 = Math.min(x0, it.x);
      y0 = Math.min(y0, it.y);
      x1 = Math.max(x1, it.x + it.w);
      y1 = Math.max(y1, it.y + it.h);
    } else if (it.text.trim()) {
      // Cap height above the baseline, descenders below: close enough for a safe-zone check.
      x0 = Math.min(x0, it.x);
      x1 = Math.max(x1, it.x + m.width(it.text, it.font));
      y0 = Math.min(y0, it.y - size * 0.75);
      y1 = Math.max(y1, it.y + size * 0.22);
    }
  }
  return x1 > x0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

function layerCheck(p: Prepared, box: Rect): LayerCheck {
  const check: LayerCheck = { type: p.layer.type };
  if (p.kind === 'text') {
    check.ink = p.ink ?? undefined;
    check.fontSize = p.layout.fontSize;
    check.designSize = p.layer.font?.size ?? 24;
    check.overflow = p.layout.overflow;
    if (p.layer.stroke && p.strokeColor !== 'none') check.stroke = p.layer.stroke.width;
  } else if (p.kind === 'image' && p.image) {
    const place = placement(p);
    check.ink = box;
    check.image = { src: p.src, width: p.image.width, height: p.image.height, drawnW: place?.w ?? box[2], drawnH: place?.h ?? box[3] };
  } else if (p.kind === 'shape') {
    if (p.stroke && p.stroke.width > 0 && p.stroke.color !== 'none') check.stroke = p.stroke.width;
  } else if (p.kind === 'icons' && p.images.some(Boolean)) {
    check.ink = box;
  }
  return check;
}

function frameBox(p: Extract<Prepared, { kind: 'image' }>): FrameBox | undefined {
  const place = placement(p);
  if (!p.frame || !place) return undefined;
  const [, , w, h] = p.layer.rect ?? [0, 0, 0, 0];
  return { ...p.frame, slackX: w - place.w, slackY: h - place.h };
}

function drawPlaceholder(ctx: Ctx, [x, y, w, h]: Rect, label: string) {
  ctx.fillStyle = 'rgba(128,128,140,0.18)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(128,128,140,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let d = -h; d < w; d += 24) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(70,70,80,0.8)';
  ctx.font = `600 ${Math.max(12, Math.min(28, w / 16))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2, w - 16);
}

function drawText(ctx: Ctx, p: Extract<Prepared, { kind: 'text' }>, env: Env) {
  const l = p.layer;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const setShadow = () => {
    if (l.shadow && p.shadowColor) {
      ctx.shadowColor = p.shadowColor;
      ctx.shadowBlur = l.shadow.blur ?? 0;
      ctx.shadowOffsetX = l.shadow.dx ?? 0;
      ctx.shadowOffsetY = l.shadow.dy ?? 0;
    }
  };
  // Canvas shadow offsets are in device pixels; scale them with the transform.
  const scale = ctx.getTransform().a;
  for (const it of p.layout.items) {
    ctx.save();
    if (l.shadow && p.shadowColor) {
      setShadow();
      ctx.shadowBlur *= scale;
      ctx.shadowOffsetX *= scale;
      ctx.shadowOffsetY *= scale;
    }
    if (it.kind === 'text') {
      ctx.font = it.font;
      if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D).letterSpacing = `${it.letterSpacing}px`;
      if (l.stroke && l.stroke.width > 0 && p.strokeColor) {
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeStyle = p.strokeColor;
        ctx.lineWidth = l.stroke.width * 2;
        ctx.strokeText(it.text, it.x, it.y);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = it.unknown ? '#e0201b' : p.color;
      ctx.fillText(it.text, it.x, it.y);
      if (it.unknown && env.mode === 'preview') {
        const w = ctx.measureText(it.text).width;
        ctx.fillRect(it.x, it.y + 3, w, 2);
      }
    } else {
      const img = p.icons.get(it.name);
      if (img) ctx.drawImage(img.source, it.x, it.y, it.w, it.h);
      else if (env.mode === 'preview') {
        ctx.strokeStyle = '#e0201b';
        ctx.strokeRect(it.x, it.y, it.w, it.h);
      }
    }
    ctx.restore();
  }
  if (env.mode === 'preview' && p.layout.overflow) {
    ctx.save();
    ctx.setLineDash([12, 8]);
    ctx.strokeStyle = '#e0201b';
    ctx.lineWidth = 3;
    if (p.region.kind === 'rect') ctx.strokeRect(p.region.x, p.region.y, p.region.w, p.region.h);
    else {
      shapePath(ctx, 'polygon', undefined, p.region.points);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawIcons(ctx: Ctx, p: Extract<Prepared, { kind: 'icons' }>) {
  const l = p.layer;
  const [x, y, w, h] = l.rect;
  const dir = l.direction ?? 'row';
  const size = l.size ?? Math.min(w, h);
  const gap = l.gap ?? size * 0.1;
  const n = p.images.length;
  const total = n * size + Math.max(0, n - 1) * gap;
  const avail = dir === 'row' ? w : h;
  const start = l.align === 'end' ? avail - total : l.align === 'start' ? 0 : (avail - total) / 2;
  p.images.forEach((img, i) => {
    const along = start + i * (size + gap);
    const ix = dir === 'row' ? x + along : x + (w - size) / 2;
    const iy = dir === 'row' ? y + (h - size) / 2 : y + along;
    if (img) {
      const s = Math.min(size / img.width, size / img.height);
      ctx.drawImage(img.source, ix + (size - img.width * s) / 2, iy + (size - img.height * s) / 2, img.width * s, img.height * s);
    }
  });
}

let measureCtx: Ctx | null = null;
const widthCache = new Map<string, number>();

function canvasMeasurer(): Measurer {
  if (!measureCtx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
    measureCtx = c.getContext('2d') as Ctx;
  }
  const ctx = measureCtx;
  return {
    width(text, font) {
      const key = font + '\u0000' + text;
      let w = widthCache.get(key);
      if (w === undefined) {
        ctx.font = font;
        w = ctx.measureText(text).width;
        if (widthCache.size > 20000) widthCache.clear();
        widthCache.set(key, w);
      }
      return w;
    },
  };
}

export function clearMeasureCache() {
  widthCache.clear();
}

/**
 * Renders a card face onto a canvas. The canvas is resized to fit.
 * Never throws for problems in the card or template; they become warnings.
 */
export async function renderCard(canvas: HTMLCanvasElement | OffscreenCanvas, req: RenderRequest, assets: AssetStore): Promise<RenderResult> {
  const { game, card } = req;
  const warnings: RenderWarning[] = [];
  const boxes: LayerBox[] = [];
  const fontProblems = await assets.loadFonts();
  for (const m of fontProblems) warnings.push({ message: m });

  const dpi = req.dpi ?? game.def.card.dpi;
  const scale = dpi / game.def.card.dpi;
  const templateId = req.templateId ?? templateFor(game, card);
  const face = templateId ? resolveFace(game.templates, templateId, req.face) : null;
  const landscape = face ? isLandscape(game.templates, face.templateId) : false;
  const size = outputSize(game, dpi, req.bleed, landscape);
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d') as Ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!templateId) {
    const id = card.values.template?.trim();
    warnings.push({ message: id ? `No template named "${id}"` : 'Card has no template' });
    drawErrorCard(ctx, size, id ? `No template "${id}"` : 'No template');
    return { warnings, boxes, templateId: null, landscape };
  }
  if (!face) {
    warnings.push({ message: `Template "${templateId}" has no "${req.face}" face` });
    drawErrorCard(ctx, size, `No ${req.face} face`);
    return { warnings, boxes, templateId, landscape };
  }

  const { defs, lookup } = gameIcons(game);
  const env: Env = {
    game,
    card,
    assets,
    resolve: cardResolver(game, card, req.set),
    icons: lookup,
    iconDefs: defs,
    keywords: compileKeywords(game.def.keywords ?? []),
    measure: canvasMeasurer(),
    warnings,
    mode: req.mode,
  };
  const prepared = await prepareLayers(face.layers, env);

  const bleedPx = templateSize(game).bleed;
  ctx.setTransform(scale, 0, 0, scale, req.bleed ? 0 : -bleedPx * scale, req.bleed ? 0 : -bleedPx * scale);
  ctx.imageSmoothingQuality = 'high';
  drawAll(ctx, prepared, env, boxes);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { warnings: dedupe(warnings), boxes, templateId, landscape };
}

function drawErrorCard(ctx: Ctx, size: { width: number; height: number }, label: string) {
  ctx.fillStyle = '#fbe9e7';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.strokeStyle = '#e0201b';
  ctx.lineWidth = Math.max(2, size.width / 150);
  ctx.strokeRect(0, 0, size.width, size.height);
  ctx.fillStyle = '#b3261e';
  ctx.font = `600 ${Math.round(size.width / 14)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size.width / 2, size.height / 2, size.width * 0.9);
}

function dedupe(ws: RenderWarning[]): RenderWarning[] {
  const seen = new Set<string>();
  return ws.filter((w) => {
    const k = `${w.layer}\u0000${w.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
