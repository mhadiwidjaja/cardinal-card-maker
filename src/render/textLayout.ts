import type { TextStyle, Token } from '../markup/markup';

/**
 * Lays out marked-up text inside a rectangle or a polygon.
 * Pure logic: text widths come from a Measurer, so this runs (and is tested)
 * without a canvas.
 */

export interface Measurer {
  /** Width in px of `text` drawn with the CSS `font` string. */
  width(text: string, font: string): number;
}

export interface FontSpec {
  family: string;
  size: number;
  weight?: number;
  style?: 'normal' | 'italic';
}

export type Point = [number, number];
export type Region = { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'polygon'; points: Point[] };

export interface IconMetrics {
  aspect: number;
  scale?: number;
  dx?: number;
  dy?: number;
}

export interface LayoutOptions {
  region: Region;
  font: FontSpec;
  /** Line height as a multiple of the font size. Default 1.2. */
  lineHeight?: number;
  /** Extra space after a paragraph, as a multiple of the font size. Default 0. */
  paragraphSpacing?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  valign?: 'top' | 'middle' | 'bottom';
  shrink?: { min: number };
  letterSpacing?: number;
  iconScale?: number;
  icon?: (name: string) => IconMetrics;
}

export type Placed =
  | { kind: 'text'; text: string; x: number; y: number; font: string; style: TextStyle; unknown?: boolean; letterSpacing: number }
  | { kind: 'icon'; name: string; x: number; y: number; w: number; h: number };

export interface LayoutResult {
  items: Placed[];
  fontSize: number;
  overflow: boolean;
  lineCount: number;
}

export function cssFont(font: FontSpec, style: TextStyle, size = font.size): string {
  const baseWeight = font.weight ?? 400;
  const weight = style.bold ? Math.min(900, Math.max(700, baseWeight + 300)) : baseWeight;
  const italic = style.italic !== (font.style === 'italic') ? 'italic ' : '';
  return `${italic}${weight} ${round(size)}px ${quoteFamily(font.family)}`;
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
function quoteFamily(family: string): string {
  return family
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => (GENERIC.has(f) || f.startsWith('"') ? f : `"${f}"`))
    .join(', ');
}

const round = (n: number) => Math.round(n * 100) / 100;

type Piece =
  | { kind: 'text'; text: string; style: TextStyle; unknown?: boolean }
  | { kind: 'icon'; name: string };

type Atom = { kind: 'word'; pieces: Piece[] } | { kind: 'space'; style: TextStyle } | { kind: 'break' };

export function toAtoms(tokens: Token[]): Atom[] {
  const atoms: Atom[] = [];
  let word: Piece[] = [];
  const endWord = () => {
    if (word.length) atoms.push({ kind: 'word', pieces: word });
    word = [];
  };
  for (const t of tokens) {
    if (t.kind === 'break') {
      endWord();
      atoms.push({ kind: 'break' });
    } else if (t.kind === 'icon') {
      word.push({ kind: 'icon', name: t.name });
    } else {
      for (const part of t.text.split(/( +|\t)/)) {
        if (part === '') continue;
        if (/^[ \t]+$/.test(part)) {
          endWord();
          atoms.push({ kind: 'space', style: t.style });
        } else {
          word.push({ kind: 'text', text: part, style: t.style, unknown: t.kind === 'unknown' || undefined });
        }
      }
    }
  }
  endWord();
  return glueNumbersToIcons(atoms);
}

const NUMBER_WORD = /^[+\-−]?\d+([.,]\d+)?[x×]?$/;

/**
 * Keeps a number with the icon after it: in "2 [fire]" the line can't break
 * between "2" and the icon. The three atoms become one word; the space stays a
 * normal-width text piece inside it, so justified text doesn't stretch it.
 * A line too narrow for the whole word still splits it like any long word.
 */
function glueNumbersToIcons(atoms: Atom[]): Atom[] {
  const out: Atom[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]!;
    const space = atoms[i + 1];
    const next = atoms[i + 2];
    if (a.kind === 'word' && isNumberWord(a) && space?.kind === 'space' && next?.kind === 'word' && next.pieces[0]?.kind === 'icon') {
      out.push({ kind: 'word', pieces: [...a.pieces, { kind: 'text', text: ' ', style: space.style }, ...next.pieces] });
      i += 2;
    } else {
      out.push(a);
    }
  }
  return out;
}

function isNumberWord(a: Extract<Atom, { kind: 'word' }>): boolean {
  if (!a.pieces.every((p) => p.kind === 'text' && !p.unknown)) return false;
  return NUMBER_WORD.test(a.pieces.map((p) => (p.kind === 'text' ? p.text : '')).join(''));
}

type Interval = [number, number];

/** Inside spans of a polygon on the horizontal line y (even-odd rule). */
export function scanline(points: Point[], y: number): Interval[] {
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    if (y1 === y2) continue;
    if ((y >= Math.min(y1, y2) && y < Math.max(y1, y2))) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
  }
  xs.sort((a, b) => a - b);
  const out: Interval[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i]!, xs[i + 1]!]);
  return out;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [a0, a1] of a)
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi > lo) out.push([lo, hi]);
    }
  return out;
}

export function regionBounds(r: Region): { top: number; bottom: number; left: number; right: number } {
  if (r.kind === 'rect') return { top: r.y, bottom: r.y + r.h, left: r.x, right: r.x + r.w };
  const ys = r.points.map((p) => p[1]);
  const xs = r.points.map((p) => p[0]);
  return { top: Math.min(...ys), bottom: Math.max(...ys), left: Math.min(...xs), right: Math.max(...xs) };
}

/** The widest horizontal span that is inside the region for the whole band [top, bottom]. */
function spanForBand(r: Region, top: number, bottom: number): Interval | null {
  if (r.kind === 'rect') return top >= r.y - 0.01 && bottom <= r.y + r.h + 0.01 ? [r.x, r.x + r.w] : null;
  const samples = 5;
  let spans: Interval[] | null = null;
  for (let i = 0; i < samples; i++) {
    const y = top + ((bottom - top) * (i + 0.5)) / samples;
    const s = scanline(r.points, y);
    spans = spans === null ? s : intersect(spans, s);
    if (spans.length === 0) return null;
  }
  let best: Interval | null = null;
  for (const s of spans!) if (!best || s[1] - s[0] > best[1] - best[0]) best = s;
  return best;
}

interface Line {
  top: number;
  span: Interval;
  atoms: Atom[];
  last: boolean;
}

interface Attempt {
  lines: Line[];
  ok: boolean;
  brokeWords: boolean;
  bottom: number;
}

export function layoutText(tokens: Token[], opts: LayoutOptions, measure: Measurer): LayoutResult {
  const atoms = toAtoms(tokens);
  const max = opts.font.size;
  const min = Math.min(opts.shrink?.min ?? max, max);

  let size = max;
  let attempt = attemptAt(atoms, size, opts, measure);
  if (!(attempt.ok && !attempt.brokeWords) && min < max) {
    // Binary search for the largest size that fits (to 0.25 px).
    let lo = min;
    let hi = max;
    let best: { size: number; attempt: Attempt } | null = null;
    const atMin = attemptAt(atoms, min, opts, measure);
    if (atMin.ok && !atMin.brokeWords) {
      best = { size: min, attempt: atMin };
      while (hi - lo > 0.25) {
        const mid = (lo + hi) / 2;
        const a = attemptAt(atoms, mid, opts, measure);
        if (a.ok && !a.brokeWords) {
          best = { size: mid, attempt: a };
          lo = mid;
        } else hi = mid;
      }
    }
    if (best) {
      size = Math.floor(best.size * 4) / 4;
      attempt = size === best.size ? best.attempt : attemptAt(atoms, size, opts, measure);
    } else {
      size = min;
      attempt = atMin;
    }
  }

  const factor = opts.valign === 'middle' ? 0.5 : opts.valign === 'bottom' ? 1 : 0;
  if (factor > 0 && attempt.ok) {
    const { bottom } = regionBounds(opts.region);
    let offset = 0;
    for (let i = 0; i < 3; i++) {
      const free = bottom - attempt.bottom;
      if (free < 0.5) break;
      const next = offset + free * factor;
      const shifted = attemptAt(atoms, size, opts, measure, next);
      if (!shifted.ok || shifted.lines.length !== attempt.lines.length) break;
      offset = next;
      attempt = shifted;
      if (opts.region.kind === 'rect') break;
    }
  }

  return {
    items: place(attempt.lines, size, opts, measure),
    fontSize: size,
    overflow: !attempt.ok,
    lineCount: attempt.lines.length,
  };
}

function attemptAt(atoms: Atom[], size: number, opts: LayoutOptions, m: Measurer, offset = 0): Attempt {
  const lineH = size * (opts.lineHeight ?? 1.2);
  const paraGap = size * (opts.paragraphSpacing ?? 0);
  const { top, bottom } = regionBounds(opts.region);
  const widthOf = (a: Atom) => atomWidth(a, size, opts, m);

  const lines: Line[] = [];
  let y = top + offset;
  let ok = true;
  let brokeWords = false;
  let i = 0;

  const nextSpan = (): Interval | null => {
    while (y + lineH <= bottom + 0.01) {
      const span = spanForBand(opts.region, y, y + lineH);
      if (span && span[1] - span[0] >= size) return span;
      y += lineH / 4;
    }
    return null;
  };

  const queue = atoms.slice();
  while (i < queue.length) {
    const span = nextSpan();
    if (!span) {
      ok = false;
      // Still lay out the rest on virtual lines below, so overflow is visible.
      const rest = queue.slice(i);
      const r = opts.region;
      const virt: Interval = r.kind === 'rect' ? [r.x, r.x + r.w] : (lines[lines.length - 1]?.span ?? [regionBounds(r).left, regionBounds(r).right]);
      lines.push(...greedyLines(rest, virt, y, lineH, paraGap, widthOf));
      break;
    }
    const avail = span[1] - span[0];
    const line: Line = { top: y, span, atoms: [], last: false };
    let used = 0;
    while (i < queue.length && queue[i]!.kind === 'space') i++;
    while (i < queue.length) {
      const a = queue[i]!;
      if (a.kind === 'break') {
        line.last = true;
        i++;
        break;
      }
      const w = widthOf(a);
      if (a.kind === 'space') {
        line.atoms.push(a);
        used += w;
        i++;
        continue;
      }
      if (used + w <= avail + 0.01) {
        line.atoms.push(a);
        used += w;
        i++;
        continue;
      }
      if (!line.atoms.some((x) => x.kind !== 'space')) {
        const [head, tail] = splitWord(a, avail - used, size, opts, m);
        brokeWords = true;
        line.atoms.push(head);
        if (tail) queue.splice(i, 1, tail);
        else i++;
      }
      break;
    }
    if (i >= queue.length) line.last = true;
    trimTrailingSpaces(line);
    lines.push(line);
    y += lineH + (line.last ? paraGap : 0);
  }
  const lastLine = lines[lines.length - 1];
  const textBottom = lastLine ? lastLine.top + lineH : top + offset;
  if (textBottom > bottom + 0.01) ok = false;
  return { lines, ok, brokeWords, bottom: textBottom };
}

function greedyLines(atoms: Atom[], span: Interval, y: number, lineH: number, paraGap: number, widthOf: (a: Atom) => number): Line[] {
  const lines: Line[] = [];
  let line: Line = { top: y, span, atoms: [], last: false };
  let used = 0;
  const push = (last: boolean) => {
    line.last = last;
    trimTrailingSpaces(line);
    lines.push(line);
    y += lineH + (last ? paraGap : 0);
    line = { top: y, span, atoms: [], last: false };
    used = 0;
  };
  for (const a of atoms) {
    if (a.kind === 'break') {
      push(true);
      continue;
    }
    const w = widthOf(a);
    if (a.kind === 'word' && used + w > span[1] - span[0] && line.atoms.some((x) => x.kind === 'word')) push(false);
    if (a.kind === 'space' && line.atoms.length === 0) continue;
    line.atoms.push(a);
    used += w;
  }
  if (line.atoms.length) push(true);
  return lines;
}

function trimTrailingSpaces(line: Line) {
  while (line.atoms.length && line.atoms[line.atoms.length - 1]!.kind === 'space') line.atoms.pop();
}

function iconBox(name: string, size: number, opts: LayoutOptions) {
  const metrics = opts.icon?.(name) ?? { aspect: 1 };
  const h = size * (opts.iconScale ?? 1) * (metrics.scale ?? 1);
  return { w: h * metrics.aspect, h, dx: (metrics.dx ?? 0) * size, dy: (metrics.dy ?? 0) * size };
}

const ICON_GAP = 0.06;

function pieceWidth(p: Piece, size: number, opts: LayoutOptions, m: Measurer): number {
  if (p.kind === 'icon') return iconBox(p.name, size, opts).w + 2 * ICON_GAP * size;
  const ls = opts.letterSpacing ?? 0;
  return m.width(p.text, cssFont(opts.font, p.style, size)) + ls * [...p.text].length;
}

function atomWidth(a: Atom, size: number, opts: LayoutOptions, m: Measurer): number {
  if (a.kind === 'break') return 0;
  if (a.kind === 'space') return pieceWidth({ kind: 'text', text: ' ', style: a.style }, size, opts, m);
  return a.pieces.reduce((sum, p) => sum + pieceWidth(p, size, opts, m), 0);
}

function splitWord(a: Extract<Atom, { kind: 'word' }>, room: number, size: number, opts: LayoutOptions, m: Measurer): [Atom, Atom | null] {
  const head: Piece[] = [];
  let used = 0;
  const pieces = a.pieces.slice();
  while (pieces.length) {
    const p = pieces[0]!;
    const w = pieceWidth(p, size, opts, m);
    if (used + w <= room || head.length === 0 && p.kind === 'icon') {
      head.push(p);
      used += w;
      pieces.shift();
      if (used > room) break;
      continue;
    }
    if (p.kind === 'text') {
      const chars = [...p.text];
      let n = 0;
      while (n < chars.length) {
        const w2 = pieceWidth({ ...p, text: chars.slice(0, n + 1).join('') }, size, opts, m);
        if (used + w2 > room && (n > 0 || head.length > 0)) break;
        n++;
      }
      if (n > 0) {
        head.push({ ...p, text: chars.slice(0, n).join('') });
        if (n < chars.length) pieces[0] = { ...p, text: chars.slice(n).join('') };
        else pieces.shift();
      }
    }
    break;
  }
  return [{ kind: 'word', pieces: head }, pieces.length ? { kind: 'word', pieces } : null];
}

function place(lines: Line[], size: number, opts: LayoutOptions, m: Measurer): Placed[] {
  const lineH = size * (opts.lineHeight ?? 1.2);
  const items: Placed[] = [];
  const ls = opts.letterSpacing ?? 0;
  for (const line of lines) {
    const widths = line.atoms.map((a) => atomWidth(a, size, opts, m));
    const total = widths.reduce((s, w) => s + w, 0);
    const avail = line.span[1] - line.span[0];
    const spaces = line.atoms.filter((a) => a.kind === 'space').length;
    let x = line.span[0];
    let extraPerSpace = 0;
    const align = opts.align ?? 'left';
    if (align === 'center') x += (avail - total) / 2;
    else if (align === 'right') x += avail - total;
    else if (align === 'justify' && !line.last && spaces > 0 && total < avail) extraPerSpace = (avail - total) / spaces;

    // Baseline sits so that capitals look centred in the line box.
    const baseline = line.top + lineH / 2 + size * 0.35;
    const mid = line.top + lineH / 2;
    line.atoms.forEach((a, idx) => {
      if (a.kind === 'space') {
        x += widths[idx]! + extraPerSpace;
        return;
      }
      if (a.kind !== 'word') return;
      for (const p of a.pieces) {
        if (p.kind === 'icon') {
          const box = iconBox(p.name, size, opts);
          items.push({ kind: 'icon', name: p.name, x: x + ICON_GAP * size + box.dx, y: mid - box.h / 2 + box.dy, w: box.w, h: box.h });
        } else {
          items.push({ kind: 'text', text: p.text, x, y: baseline, font: cssFont(opts.font, p.style, size), style: p.style, unknown: p.unknown, letterSpacing: ls });
        }
        x += pieceWidth(p, size, opts, m);
      }
    });
  }
  return items;
}
