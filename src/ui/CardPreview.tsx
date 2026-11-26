import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { formatFraming, framingColumn, MAX_ZOOM, MIN_ZOOM } from '../model/framing';
import { faceNames } from '../model/resolve';
import type { Card, CardSet, Game } from '../model/types';
import type { AssetStore } from '../render/assets';
import { faceLandscape, renderCard, templateFor, templateSize, type LayerBox, type RenderWarning } from '../render/renderCard';
import { VISION_FILTERS, VisionFilterDefs, type Vision } from './vision';
import { checkFace, type PrintIssue } from '../render/preflight';
import { RegMark } from './RegMark';

interface Props {
  game: Game;
  set?: CardSet;
  card: Card;
  assets: AssetStore;
  version: number;
  /** Saves a card's own art framing (`<field>.frame`); '' resets it. Leave out to make the preview read-only. */
  onFrame?: (field: string, value: string) => void;
}

/** How long a run of scroll-wheel zooms waits before it is saved as one undo step. */
const WHEEL_SAVE_MS = 400;

export function CardPreview({ game, set, card, assets, version, onFrame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [face, setFace] = useState('front');
  const [showBleed, setShowBleed] = useState(true);
  const [guides, setGuides] = useState(true);
  const [vision, setVision] = useState<Vision>('normal');
  const [warnings, setWarnings] = useState<RenderWarning[]>([]);
  const [boxes, setBoxes] = useState<LayerBox[]>([]);
  const [checking, setChecking] = useState(false);
  const [issues, setIssues] = useState<PrintIssue[]>([]);
  const [draft, setDraft] = useState<{ field: string; value: string } | null>(null);
  const drag = useRef<{ x: number; y: number; box: LayerBox } | null>(null);
  const wheelTimer = useRef<number | undefined>(undefined);
  const templateId = templateFor(game, card);
  const faces = templateId ? faceNames(game.templates, templateId) : ['front'];
  const activeFace = faces.includes(face) ? face : 'front';

  const shown = useMemo(
    () => (draft ? { ...card, values: { ...card.values, [framingColumn(draft.field)]: draft.value } } : card),
    [card, draft],
  );

  useEffect(() => {
    let cancelled = false;
    const off = document.createElement('canvas');
    renderCard(off, { game, set, card: shown, face: activeFace, bleed: showBleed, mode: 'preview' }, assets).then((res) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext('2d')!.drawImage(off, 0, 0);
      setWarnings(res.warnings);
      setBoxes(res.boxes);
      setIssues(checkFace(game, res.boxes, res.landscape));
    });
    return () => {
      cancelled = true;
    };
  }, [game, set, shown, activeFace, showBleed, assets, version]);

  // The cutting mat's grid at the card's true scale: one fine line per millimetre × 10.
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || typeof ResizeObserver === 'undefined') return;
    const c = game.def.card;
    const landscape = faceLandscape(game, card, activeFace);
    const widthMm = (landscape ? c.heightMm : c.widthMm) + (showBleed ? 2 * c.bleedMm : 0);
    const update = () => canvas.clientWidth > 0 && stage.style.setProperty('--mm', `${canvas.clientWidth / widthMm}px`);
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    update();
    return () => ro.disconnect();
  }, [game, card, activeFace, showBleed]);

  useEffect(() => {
    setDraft(null);
    drag.current = null;
  }, [card.id]);

  const size = templateSize(game, faceLandscape(game, card, activeFace));
  const vb = showBleed ? `0 0 ${size.width} ${size.height}` : `${size.bleed} ${size.bleed} ${size.width - 2 * size.bleed} ${size.height - 2 * size.bleed}`;
  const radius = ((game.def.card.cornerRadiusMm ?? 0) / 25.4) * game.def.card.dpi;
  const frames = onFrame ? boxes.filter((b) => b.frame) : [];

  const toTemplate = (clientX: number, clientY: number): { x: number; y: number; scale: number } | null => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return null;
    const viewW = showBleed ? size.width : size.width - 2 * size.bleed;
    const offset = showBleed ? 0 : size.bleed;
    const scale = viewW / r.width;
    return { x: (clientX - r.left) * scale + offset, y: (clientY - r.top) * scale + offset, scale };
  };
  const frameAt = (clientX: number, clientY: number): LayerBox | null => {
    const p = toTemplate(clientX, clientY);
    if (!p) return null;
    for (let i = frames.length - 1; i >= 0; i--) {
      const [x, y, w, h] = frames[i]!.rect;
      if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return frames[i]!;
    }
    return null;
  };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const box = e.button === 0 ? frameAt(e.clientX, e.clientY) : null;
    if (!box) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, box };
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) {
      e.currentTarget.style.cursor = frameAt(e.clientX, e.clientY) ? 'grab' : '';
      return;
    }
    const p = toTemplate(e.clientX, e.clientY);
    const f = d.box.frame!;
    if (!p) return;
    // Moving the picture by dx changes the focus by dx / slack (the room it can move in).
    const fx = Math.abs(f.slackX) > 0.5 ? f.fx + ((e.clientX - d.x) * p.scale) / f.slackX : f.fx;
    const fy = Math.abs(f.slackY) > 0.5 ? f.fy + ((e.clientY - d.y) * p.scale) / f.slackY : f.fy;
    e.currentTarget.style.cursor = 'grabbing';
    setDraft({ field: f.field, value: formatFraming({ zoom: f.zoom, fx, fy }) });
  };
  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.style.cursor = 'grab';
    if (draft && onFrame) onFrame(draft.field, draft.value);
    setDraft(null);
  };

  // Scroll to zoom. A non-passive listener, so the page doesn't scroll at the same time.
  const wheelState = useRef({ frameAt, draft, onFrame });
  wheelState.current = { frameAt, draft, onFrame };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (e: WheelEvent) => {
      const { frameAt: at, draft: current, onFrame: save } = wheelState.current;
      const box = at(e.clientX, e.clientY);
      if (!box || !save) return;
      e.preventDefault();
      const f = box.frame!;
      const base = current && current.field === f.field ? parseDraft(current.value) ?? f : f;
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, base.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const value = formatFraming({ zoom, fx: base.fx, fy: base.fy });
      setDraft({ field: f.field, value });
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => {
        save(f.field, value);
        setDraft(null);
      }, WHEEL_SAVE_MS);
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => () => window.clearTimeout(wheelTimer.current), []);

  return (
    <div className="preview">
      <div className="preview-toolbar">
        {faces.length > 1 ? (
          <div className="segmented" role="group" aria-label="Side">
            {faces.map((f) => (
              <button key={f} className={f === activeFace ? 'active' : ''} aria-pressed={f === activeFace} onClick={() => setFace(f)}>
                {f}
              </button>
            ))}
          </div>
        ) : (
          <span className="slug muted">{activeFace}</span>
        )}
        <span className="spacer" />
        <label className="chip" title="Show the bleed: the edge that gets cut off">
          <input type="checkbox" checked={showBleed} onChange={(e) => setShowBleed(e.target.checked)} /> bleed
        </label>
        <label className="chip" title="Crop marks at the cut line, and the safe zone (dotted)">
          <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> guides
        </label>
        <label className="chip" title="Mark print problems: art with too few pixels, tiny text, text past the safe zone, very thin lines">
          <input type="checkbox" checked={checking} onChange={(e) => setChecking(e.target.checked)} />
          <RegMark className="chip-icon" /> print check
          {issues.length > 0 && <span className="badge attn">{issues.length}</span>}
        </label>
        <select
          className="vision-select"
          value={vision}
          onChange={(e) => setVision(e.target.value as Vision)}
          aria-label="Colour vision"
          title="See the card as people with colour-blindness do (preview only; exports are unchanged)"
        >
          {Object.entries(VISION_FILTERS).map(([id, v]) => (
            <option key={id} value={id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <div className="preview-stage" ref={stageRef}>
        <div
          className="preview-card"
          style={{ '--ar': showBleed ? size.width / size.height : (size.width - 2 * size.bleed) / (size.height - 2 * size.bleed) } as React.CSSProperties}
        >
          <VisionFilterDefs />
          <canvas
            ref={canvasRef}
            style={{ filter: VISION_FILTERS[vision].css }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onDoubleClick={(e) => {
              const box = frameAt(e.clientX, e.clientY);
              if (box && onFrame) onFrame(box.frame!.field, '');
            }}
          />
          {checking && issues.length > 0 && (
            <svg className="guides issue-marks" viewBox={vb} preserveAspectRatio="none" aria-hidden>
              {issues
                .filter((i) => i.rect)
                .map((i, k) => (
                  <rect key={k} x={i.rect![0]} y={i.rect![1]} width={i.rect![2]} height={i.rect![3]} className={i.level} />
                ))}
            </svg>
          )}
          {guides && (
            <svg className="guides" viewBox={vb} preserveAspectRatio="none">
              {showBleed && size.bleed > 0 && (
                <>
                  <path
                    className="bleed-shade"
                    fillRule="evenodd"
                    d={`M0 0H${size.width}V${size.height}H0Z M${size.bleed} ${size.bleed}V${size.height - size.bleed}H${size.width - size.bleed}V${size.bleed}Z`}
                  />
                  {cropMarks(size.width, size.height, size.bleed).map((d, i) => (
                    <path key={i} className="crop" d={d} />
                  ))}
                </>
              )}
              {!showBleed && radius > 0 && <rect x={size.bleed} y={size.bleed} width={size.width - 2 * size.bleed} height={size.height - 2 * size.bleed} rx={radius} className="trim-round" />}
              <rect
                x={size.bleed + size.safe}
                y={size.bleed + size.safe}
                width={size.width - 2 * (size.bleed + size.safe)}
                height={size.height - 2 * (size.bleed + size.safe)}
                className="safe"
              />
            </svg>
          )}
        </div>
      </div>
      {checking && (
        <ul className="warnings print-issues">
          {issues.length === 0 ? (
            <li className="ok">✓ No print problems on this side.</li>
          ) : (
            issues.map((i, k) => (
              <li key={k} className={i.level}>
                {i.layer && <code>{i.layer}</code>} {i.message}
              </li>
            ))
          )}
        </ul>
      )}
      {frames.length > 0 && <p className="muted small">Art: drag to move it · scroll to zoom · double-click to reset</p>}
      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w, i) => (
            <li key={i}>
              {w.layer && <code>{w.layer}</code>} {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function cropMarks(w: number, h: number, bleed: number): string[] {
  const gap = bleed * 0.25;
  const len = bleed * 0.75;
  const out: string[] = [];
  for (const [x, sx] of [
    [bleed, -1],
    [w - bleed, 1],
  ] as const)
    for (const [y, sy] of [
      [bleed, -1],
      [h - bleed, 1],
    ] as const) {
      out.push(`M${x + sx * gap} ${y}h${sx * len}`);
      out.push(`M${x} ${y + sy * gap}v${sy * len}`);
    }
  return out;
}

function parseDraft(value: string): { zoom: number; fx: number; fy: number } | null {
  const [zoom, fx, fy] = value.split(' ').map(Number);
  return zoom !== undefined && fx !== undefined && fy !== undefined ? { zoom, fx, fy } : null;
}
