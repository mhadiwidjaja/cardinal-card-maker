import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Card, CardSet, Game, Layer, Pt, Rect } from '../../model/types';
import type { AssetStore } from '../../render/assets';
import { renderCard, templateSize, type RenderWarning } from '../../render/renderCard';
import {
  contains,
  geoBounds,
  HANDLES,
  handlePos,
  layerGeometry,
  nearestEdge,
  resizeRect,
  roundPts,
  roundRect,
  snap,
  type Geo,
  type Handle,
} from './geometry';

export type GeoChange = { prop: 'rect' | 'points' | 'polygon' | 'offset'; value: Rect | Pt[] | Pt };

interface Props {
  game: Game;
  set?: CardSet;
  card: Card;
  assets: AssetStore;
  version: number;
  templateId: string;
  face: string;
  layers: Layer[];
  selected: string | null;
  zoom: number | 'fit';
  onSelect: (id: string | null) => void;
  /** phase "start" lets the editor record an undo step before the change. */
  onGeometry: (layerId: string, change: GeoChange, phase: 'start' | 'move' | 'end') => void;
  onWarnings?: (w: RenderWarning[]) => void;
  landscape?: boolean;
}

interface Item {
  layer: Layer;
  geo: Geo;
}

type Drag =
  | { mode: 'move'; id: string; start: Pt; geo: Geo; moved: boolean }
  | { mode: 'resize'; id: string; start: Pt; geo: Extract<Geo, { kind: 'rect' }>; handle: Handle }
  | { mode: 'point'; id: string; start: Pt; geo: Extract<Geo, { kind: 'poly' }>; index: number };

function flatten(layers: Layer[], offset: Pt = [0, 0], out: Item[] = []): Item[] {
  for (const l of layers) {
    const geo = layerGeometry(l, offset);
    if (geo) out.push({ layer: l, geo });
    if (l.type === 'group') {
      const o = l.offset ?? [0, 0];
      flatten(l.layers, [offset[0] + o[0], offset[1] + o[1]], out);
    }
  }
  return out;
}

export function TemplateCanvas(props: Props) {
  const { game, set, card, assets, version, templateId, face, layers, selected, zoom, onSelect, onGeometry, onWarnings, landscape } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Set at once, unlike `drag.moved`: several pointer moves can arrive before React re-renders, and each would start a new undo step.
  const moveStarted = useRef(false);
  // The last geometry sent, which the end of a drag repeats; what is on screen may still be a few moves behind.
  const lastSent = useRef<GeoChange | null>(null);
  const send = (id: string, change: GeoChange, phase: 'start' | 'move' | 'end') => {
    lastSent.current = change;
    onGeometry(id, change, phase);
  };
  const size = templateSize(game, landscape);
  const items = useMemo(() => flatten(layers), [layers]);
  const sel = items.find((i) => i.layer.id === selected) ?? null;
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || typeof ResizeObserver === 'undefined') return;
    const c = game.def.card;
    const widthMm = (landscape ? c.heightMm : c.widthMm) + 2 * c.bleedMm;
    const update = () => canvas.clientWidth > 0 && stage.style.setProperty('--mm', `${canvas.clientWidth / widthMm}px`);
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    update();
    return () => ro.disconnect();
  }, [game, landscape]);

  // Render the card whenever anything changes; the latest request wins.
  const token = useRef(0);
  useEffect(() => {
    const my = ++token.current;
    const off = document.createElement('canvas');
    renderCard(off, { game, set, card, face, bleed: true, mode: 'preview', templateId }, assets).then((res) => {
      if (my !== token.current || !canvasRef.current) return;
      const c = canvasRef.current;
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d')!.drawImage(off, 0, 0);
      onWarnings?.(res.warnings);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, set, card, face, templateId, assets, version]);

  const guidesX = [0, size.bleed, size.bleed + size.safe, size.width / 2, size.width - size.bleed - size.safe, size.width - size.bleed, size.width];
  const guidesY = [0, size.bleed, size.bleed + size.safe, size.height / 2, size.height - size.bleed - size.safe, size.height - size.bleed, size.height];

  const toTemplate = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = pt.matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const tolerance = () => {
    const m = svgRef.current?.getScreenCTM();
    return m ? 6 / m.a : 6;
  };

  function hitTest(p: Pt): Item | null {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.layer.locked || it.layer.hidden) continue;
      if (it.geo.kind === 'group') continue;
      if (contains(it.geo, p)) return it;
    }
    return null;
  }

  function onPointerDown(e: RPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const p = toTemplate(e);
    const target = e.target as SVGElement;
    const handle = target.dataset.handle as Handle | undefined;
    const pointIndex = target.dataset.point !== undefined ? Number(target.dataset.point) : undefined;

    if (sel && handle && sel.geo.kind === 'rect') {
      send(sel.layer.id, { prop: 'rect', value: sel.geo.rect }, 'start');
      setDrag({ mode: 'resize', id: sel.layer.id, start: p, geo: sel.geo, handle });
    } else if (sel && pointIndex !== undefined && sel.geo.kind === 'poly') {
      const geo = sel.geo;
      if (e.altKey && geo.points.length > 3) {
        send(sel.layer.id, { prop: geo.prop, value: geo.points }, 'start');
        send(sel.layer.id, { prop: geo.prop, value: geo.points.filter((_, i) => i !== pointIndex) }, 'end');
        return;
      }
      send(sel.layer.id, { prop: geo.prop, value: geo.points }, 'start');
      setDrag({ mode: 'point', id: sel.layer.id, start: p, geo, index: pointIndex });
    } else {
      const keep = sel && !sel.layer.locked && contains(sel.geo, p, 4) ? sel : null;
      const hit = keep ?? hitTest(p);
      onSelect(hit ? hit.layer.id : null);
      if (hit && !hit.layer.locked) {
        moveStarted.current = false;
        setDrag({ mode: 'move', id: hit.layer.id, start: p, geo: hit.geo, moved: false });
      }
    }
    svgRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: RPointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const p = toTemplate(e);
    let dx = p[0] - drag.start[0];
    let dy = p[1] - drag.start[1];
    const tol = tolerance();
    if (drag.mode === 'move') {
      if (!drag.moved && !moveStarted.current) {
        if (Math.hypot(dx, dy) < tol / 2) return;
        moveStarted.current = true;
        const g = drag.geo;
        send(drag.id, g.kind === 'rect' ? { prop: 'rect', value: g.rect } : g.kind === 'poly' ? { prop: g.prop, value: g.points } : { prop: 'offset', value: g.own }, 'start');
        setDrag({ ...drag, moved: true });
      }
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const b = geoBounds(drag.geo);
      const snapAxis = (start: number, len: number, d: number, guides: number[]) => {
        const a = snap(start + d, guides, tol);
        if (a !== start + d) return a - start;
        const z = snap(start + len + d, guides, tol);
        if (z !== start + len + d) return z - start - len;
        const c = snap(start + len / 2 + d, guides, tol);
        return c - start - len / 2;
      };
      if (!e.altKey) {
        dx = snapAxis(b[0], b[2], dx, guidesX);
        dy = snapAxis(b[1], b[3], dy, guidesY);
      }
      const g = drag.geo;
      if (g.kind === 'rect') send(drag.id, { prop: 'rect', value: roundRect([g.rect[0] + dx, g.rect[1] + dy, g.rect[2], g.rect[3]]) }, 'move');
      else if (g.kind === 'poly') send(drag.id, { prop: g.prop, value: roundPts(g.points.map(([x, y]) => [x + dx, y + dy])) }, 'move');
      else send(drag.id, { prop: 'offset', value: [Math.round(g.own[0] + dx), Math.round(g.own[1] + dy)] }, 'move');
    } else if (drag.mode === 'resize') {
      const g = drag.geo;
      let r = resizeRect(g.rect, drag.handle, dx, dy, e.shiftKey);
      if (!e.altKey) {
        const [ox, oy] = g.offset;
        let [x, y, w, h] = r;
        if (drag.handle.includes('w')) {
          const nx = snap(x + ox, guidesX, tol) - ox;
          w += x - nx;
          x = nx;
        }
        if (drag.handle.includes('e')) w = snap(x + w + ox, guidesX, tol) - ox - x;
        if (drag.handle.includes('n')) {
          const ny = snap(y + oy, guidesY, tol) - oy;
          h += y - ny;
          y = ny;
        }
        if (drag.handle.includes('s')) h = snap(y + h + oy, guidesY, tol) - oy - y;
        r = [x, y, w, h];
      }
      send(drag.id, { prop: 'rect', value: roundRect(r) }, 'move');
    } else {
      const g = drag.geo;
      const [ox, oy] = g.offset;
      const orig = g.points[drag.index]!;
      let nx = orig[0] + dx;
      let ny = orig[1] + dy;
      if (!e.altKey) {
        nx = snap(nx + ox, guidesX, tol) - ox;
        ny = snap(ny + oy, guidesY, tol) - oy;
      }
      const pts = g.points.map((pt, i) => (i === drag.index ? ([nx, ny] as Pt) : pt));
      send(drag.id, { prop: g.prop, value: roundPts(pts) }, 'move');
    }
  }

  function onPointerUp() {
    if (drag && (drag.mode !== 'move' || moveStarted.current) && lastSent.current) send(drag.id, lastSent.current, 'end');
    setDrag(null);
  }

  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!sel || sel.geo.kind !== 'poly') return;
    const p = toTemplate(e);
    const g = sel.geo;
    const local: Pt = [p[0] - g.offset[0], p[1] - g.offset[1]];
    const edge = nearestEdge(g.points, local);
    if (edge.dist > tolerance() * 3) return;
    const pts = [...g.points];
    pts.splice(edge.index + 1, 0, [Math.round(edge.point[0]), Math.round(edge.point[1])]);
    send(sel.layer.id, { prop: g.prop, value: g.points }, 'start');
    send(sel.layer.id, { prop: g.prop, value: pts }, 'end');
  }

  const scaleStyle = (zoom === 'fit' ? { '--ar': size.width / size.height } : { width: `${size.width * zoom}px` }) as React.CSSProperties;
  const hs = (m: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    return ctm ? m / ctm.a : m;
  };

  return (
    <div className={'editor-stage' + (zoom === 'fit' ? ' fit' : '')} ref={stageRef}>
      <div className="editor-card" style={scaleStyle}>
        <canvas ref={canvasRef} />
        <svg
          ref={svgRef}
          className="editor-overlay"
          viewBox={`0 0 ${size.width} ${size.height}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <rect x={size.bleed} y={size.bleed} width={size.width - 2 * size.bleed} height={size.height - 2 * size.bleed} className="g-trim" />
          <rect
            x={size.bleed + size.safe}
            y={size.bleed + size.safe}
            width={size.width - 2 * (size.bleed + size.safe)}
            height={size.height - 2 * (size.bleed + size.safe)}
            className="g-safe"
          />
          {items.map((it) => {
            const [x, y, w, h] = geoBounds(it.geo);
            return <rect key={it.layer.id} x={x} y={y} width={w} height={h} className={'g-box' + (it.layer.id === selected ? ' sel' : '')} />;
          })}
          {sel && sel.geo.kind === 'poly' && (
            <>
              <polygon points={sel.geo.points.map(([x, y]) => `${x + sel.geo.offset[0]},${y + sel.geo.offset[1]}`).join(' ')} className="g-poly" />
              {sel.geo.points.map(([x, y], i) => (
                <circle key={i} cx={x + sel.geo.offset[0]} cy={y + sel.geo.offset[1]} r={hs(6)} data-point={i} className="g-point" />
              ))}
            </>
          )}
          {sel && sel.geo.kind === 'rect' && !sel.layer.locked &&
            HANDLES.map((hd) => {
              const [cx, cy] = handlePos(geoBounds(sel.geo), hd);
              const s = hs(9);
              return <rect key={hd} x={cx - s / 2} y={cy - s / 2} width={s} height={s} data-handle={hd} className={`g-handle h-${hd}`} />;
            })}
        </svg>
      </div>
    </div>
  );
}
