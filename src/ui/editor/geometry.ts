import type { Layer, Pt, Rect } from '../../model/types';

export type Geo =
  | { kind: 'rect'; rect: Rect; offset: Pt; prop: 'rect' }
  | { kind: 'poly'; points: Pt[]; offset: Pt; prop: 'points' | 'polygon' }
  | { kind: 'group'; rect: Rect; offset: Pt; own: Pt };

export function layerGeometry(layer: Layer, offset: Pt = [0, 0]): Geo | null {
  if (layer.type === 'group') {
    const own = layer.offset ?? [0, 0];
    const inner: Pt = [offset[0] + own[0], offset[1] + own[1]];
    const boxes = layer.layers.map((c) => layerGeometry(c, inner)).filter((g): g is Geo => g !== null).map(geoBounds);
    const rect = layer.clip?.rect ? shift(layer.clip.rect, inner) : boxes.length ? union(boxes) : null;
    return rect ? { kind: 'group', rect, offset, own } : null;
  }
  if (layer.type === 'text' && layer.polygon && layer.polygon.length >= 3) return { kind: 'poly', points: layer.polygon, offset, prop: 'polygon' };
  if (layer.type === 'shape' && layer.shape === 'polygon') return { kind: 'poly', points: layer.points ?? [], offset, prop: 'points' };
  const rect = (layer as { rect?: Rect }).rect;
  return rect ? { kind: 'rect', rect, offset, prop: 'rect' } : null;
}

export function shift(r: Rect, [dx, dy]: Pt): Rect {
  return [r[0] + dx, r[1] + dy, r[2], r[3]];
}

export function geoBounds(g: Geo): Rect {
  if (g.kind === 'group') return g.rect;
  if (g.kind === 'rect') return shift(normalize(g.rect), g.offset);
  const xs = g.points.map((p) => p[0] + g.offset[0]);
  const ys = g.points.map((p) => p[1] + g.offset[1]);
  if (xs.length === 0) return [g.offset[0], g.offset[1], 0, 0];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

export function normalize([x, y, w, h]: Rect): Rect {
  return [w < 0 ? x + w : x, h < 0 ? y + h : y, Math.abs(w), Math.abs(h)];
}

export function union(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r[0]));
  const y0 = Math.min(...rects.map((r) => r[1]));
  const x1 = Math.max(...rects.map((r) => r[0] + r[2]));
  const y1 = Math.max(...rects.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

export function contains(g: Geo, [px, py]: Pt, slop = 0): boolean {
  if (g.kind === 'poly') {
    const pts = g.points.map(([x, y]) => [x + g.offset[0], y + g.offset[1]] as Pt);
    if (pointInPolygon(pts, [px, py])) return true;
  }
  const [x, y, w, h] = geoBounds(g);
  return px >= x - slop && px <= x + w + slop && py >= y - slop && py <= y + h + slop;
}

export function pointInPolygon(pts: Pt[], [px, py]: Pt): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function nearestEdge(pts: Pt[], p: Pt): { index: number; point: Pt; dist: number } {
  let best = { index: 0, point: p, dist: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    const q: Pt = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.dist) best = { index: i, point: q, dist: d };
  }
  return best;
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handlePos([x, y, w, h]: Rect, hd: Handle): Pt {
  const cx = hd.includes('w') ? x : hd.includes('e') ? x + w : x + w / 2;
  const cy = hd.includes('n') ? y : hd.includes('s') ? y + h : y + h / 2;
  return [cx, cy];
}

export function resizeRect(r: Rect, hd: Handle, dx: number, dy: number, keepAspect: boolean): Rect {
  let [x, y, w, h] = r;
  if (hd.includes('w')) {
    x += dx;
    w -= dx;
  }
  if (hd.includes('e')) w += dx;
  if (hd.includes('n')) {
    y += dy;
    h -= dy;
  }
  if (hd.includes('s')) h += dy;
  if (keepAspect && r[2] !== 0 && r[3] !== 0 && hd.length === 2) {
    const ratio = r[2] / r[3];
    if (Math.abs(w / ratio) > Math.abs(h)) {
      const nh = w / ratio;
      if (hd.includes('n')) y -= nh - h;
      h = nh;
    } else {
      const nw = h * ratio;
      if (hd.includes('w')) x -= nw - w;
      w = nw;
    }
  }
  return normalize([x, y, w, h]);
}

export function snap(v: number, guides: number[], tolerance: number): number {
  let best = v;
  let bestD = tolerance;
  for (const g of guides) {
    const d = Math.abs(g - v);
    if (d <= bestD) {
      best = g;
      bestD = d;
    }
  }
  return best;
}

export const roundRect = (r: Rect): Rect => r.map((v) => Math.round(v)) as Rect;
export const roundPts = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
