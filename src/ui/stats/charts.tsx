import { useState, type ReactNode } from 'react';
import type { CountResult, CrossResult, Dimension } from '../../model/stats';

/**
 * Small SVG charts for the statistics view. Colors come from CSS custom
 * properties (--series-1 … --series-8) so light and dark mode each get their
 * own validated steps. A game's own field colors (game.json "colors") are used
 * as identity colors where defined.
 */

const MAX_SERIES = 8;
const seriesVar = (i: number) => `var(--series-${(i % MAX_SERIES) + 1})`;

function colorFor(label: string, colors: Record<string, string> | undefined, index: number): string {
  const hit = colors && Object.entries(colors).find(([k]) => k.toLowerCase() === label.toLowerCase());
  return hit ? hit[1] : seriesVar(index);
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.content}
    </div>
  );
}

export function BarList({ dim, counts, unit }: { dim: Dimension; counts: CountResult; unit: string }) {
  const max = Math.max(1, ...counts.groups.map((g) => g.value));
  const total = counts.total || 1;
  const single = !dim.colors;
  return (
    <div className="barlist" role="list">
      {counts.groups.map((g, i) => (
        <div className="barlist-row" role="listitem" key={g.key} title={`${g.label}: ${g.value} ${unit} (${Math.round((g.value / total) * 100)}%)`}>
          <span className="barlist-label">{g.label}</span>
          <span className="barlist-track">
            <span className="barlist-bar" style={{ width: `${(g.value / max) * 100}%`, background: single ? 'var(--series-solo)' : colorFor(g.label, dim.colors, i) }} />
          </span>
          <span className="barlist-value">{g.value}</span>
        </div>
      ))}
    </div>
  );
}

function niceScale(max: number): { top: number; step: number } {
  if (max <= 5) return { top: Math.max(1, max), step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { top: Math.ceil(max / step) * step, step };
}

export function ColumnChart({
  dim,
  counts,
  cross,
  seriesColors,
  unit,
}: {
  dim: Dimension;
  counts: CountResult;
  cross: CrossResult | null;
  seriesColors?: Record<string, string>;
  unit: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const W = 520;
  const H = 220;
  const m = { l: 34, r: 8, t: 10, b: 28 };
  const groups = counts.groups;
  const totals = cross ? cross.cells.map((row) => row.reduce((s, v) => s + v, 0)) : groups.map((g) => g.value);
  const { top, step } = niceScale(Math.max(1, ...totals));
  const plotW = W - m.l - m.r;
  const plotH = H - m.t - m.b;
  const band = plotW / Math.max(1, groups.length);
  const barW = Math.min(40, band * 0.55);
  const y = (v: number) => m.t + plotH - (v / top) * plotH;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);

  let series = cross?.series ?? [];
  let cells = cross?.cells ?? [];
  if (cross && series.length > MAX_SERIES) {
    series = [...series.slice(0, MAX_SERIES - 1), 'Other'];
    cells = cross.cells.map((row) => [...row.slice(0, MAX_SERIES - 1), row.slice(MAX_SERIES - 1).reduce((s, v) => s + v, 0)]);
  }

  return (
    <div className="chart-box" onMouseLeave={() => setTip(null)}>
      {cross && (
        <div className="legend">
          {series.map((s, i) => (
            <span key={s} className="legend-item">
              <span className="swatch" style={{ background: colorFor(s, seriesColors, i) }} />
              {s}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={`${dim.label} curve`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'gridline'} />
            <text x={m.l - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {groups.map((g, i) => {
          const cx = m.l + band * i + band / 2;
          const x0 = cx - barW / 2;
          const show = (e: React.MouseEvent) => {
            const box = (e.currentTarget.closest('.chart-box') as HTMLElement).getBoundingClientRect();
            setTip({
              x: e.clientX - box.left + 12,
              y: e.clientY - box.top - 10,
              content: (
                <>
                  <strong>
                    {dim.label} {g.label}
                  </strong>
                  : {totals[i]} {unit}
                  {cross &&
                    series.map((s, si) =>
                      cells[i]![si] ? (
                        <div key={s} className="tip-row">
                          <span className="swatch" style={{ background: colorFor(s, seriesColors, si) }} /> {s}: {cells[i]![si]}
                        </div>
                      ) : null,
                    )}
                </>
              ),
            });
          };
          let segments: { v: number; color: string }[];
          if (cross) segments = series.map((s, si) => ({ v: cells[i]![si]!, color: colorFor(s, seriesColors, si) })).filter((s) => s.v > 0);
          else segments = [{ v: g.value, color: 'var(--series-solo)' }];
          let acc = 0;
          return (
            <g key={g.key}>
              <rect x={m.l + band * i} y={m.t} width={band} height={plotH} fill="transparent" onMouseMove={show} />
              {segments.map((s, si) => {
                const yTop = y(acc + s.v);
                const yBot = y(acc);
                acc += s.v;
                const last = si === segments.length - 1;
                const h = Math.max(0, yBot - yTop - (last ? 0 : 2));
                return <path key={si} d={roundedTop(x0, yTop, barW, h, last ? Math.min(4, h) : 0)} fill={s.color} pointerEvents="none" />;
              })}
              <text x={cx} y={H - m.b + 16} className="tick" textAnchor="middle">
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export function DataTable({ dim, counts, cross, unit }: { dim: Dimension; counts: CountResult; cross: CrossResult | null; unit: string }) {
  return (
    <div className="table-wrap chart-table">
      <table>
        <thead>
          <tr>
            <th>{dim.label}</th>
            {cross && cross.series.map((s) => <th key={s}>{s}</th>)}
            <th>{unit}</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {counts.groups.map((g, i) => (
            <tr key={g.key}>
              <td>{g.label}</td>
              {cross && cross.cells[i]!.map((v, j) => <td key={j}>{v || ''}</td>)}
              <td>{g.value}</td>
              <td className="muted">{counts.total ? Math.round((g.value / counts.total) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
