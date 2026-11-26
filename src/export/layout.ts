
export const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [210, 297],
  Letter: [215.9, 279.4],
  A3: [297, 420],
  Legal: [215.9, 355.6],
};

/** Page orientation for print sheets. "auto" picks whichever fits more cards. */
export type PageOrientation = 'portrait' | 'landscape' | 'auto';

export function orientPage(
  size: [number, number],
  orientation: PageOrientation,
  perPage: (pageW: number, pageH: number) => number,
): { pageW: number; pageH: number; landscape: boolean } {
  const short = Math.min(size[0], size[1]);
  const long = Math.max(size[0], size[1]);
  const portrait = { pageW: short, pageH: long, landscape: false };
  const landscape = { pageW: long, pageH: short, landscape: true };
  if (orientation === 'portrait') return portrait;
  if (orientation === 'landscape') return landscape;
  return perPage(long, short) > perPage(short, long) ? landscape : portrait;
}

export interface PrintOptions {
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: number;
  gapMm: number;
  /** Print the bleed area around each card (needs gap ≥ 2×bleed, or 0 gap with bleed overlap off). */
  bleed: boolean;
  cropMarks: boolean;
}

export interface Slot {
  x: number;
  y: number;
}

export interface PageLayout {
  cols: number;
  rows: number;
  perPage: number;
  slots: Slot[];
  drawW: number;
  drawH: number;
  /** Offset from the trim box to where the image is drawn (negative when bleed is printed). */
  drawOffset: number;
}

export function pageLayout(cardW: number, cardH: number, bleedMm: number, o: PrintOptions): PageLayout {
  // With bleed, each card needs room for its bleed on every side unless cards touch.
  const extra = o.bleed ? bleedMm : 0;
  const pitchX = cardW + Math.max(o.gapMm, 2 * extra);
  const pitchY = cardH + Math.max(o.gapMm, 2 * extra);
  const usableW = o.pageWidthMm - 2 * o.marginMm - 2 * extra;
  const usableH = o.pageHeightMm - 2 * o.marginMm - 2 * extra;
  const cols = Math.max(0, Math.floor((usableW + (pitchX - cardW)) / pitchX));
  const rows = Math.max(0, Math.floor((usableH + (pitchY - cardH)) / pitchY));
  const gridW = cols * cardW + Math.max(0, cols - 1) * (pitchX - cardW);
  const gridH = rows * cardH + Math.max(0, rows - 1) * (pitchY - cardH);
  const x0 = (o.pageWidthMm - gridW) / 2;
  const y0 = (o.pageHeightMm - gridH) / 2;
  const slots: Slot[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push({ x: x0 + c * pitchX, y: y0 + r * pitchY });
  return {
    cols,
    rows,
    perPage: cols * rows,
    slots,
    drawW: cardW + 2 * extra,
    drawH: cardH + 2 * extra,
    drawOffset: -extra,
  };
}

/**
 * Slot used for the back of the card in `slot` when printing double-sided and
 * flipping on the long edge (portrait pages): columns are mirrored.
 */
export function mirroredSlot(layout: PageLayout, index: number): number {
  const r = Math.floor(index / layout.cols);
  const c = index % layout.cols;
  return r * layout.cols + (layout.cols - 1 - c);
}

export function cropMarks(layout: PageLayout, cardW: number, cardH: number, used: number, lengthMm = 4, offsetMm = 1): [number, number, number, number][] {
  const lines: [number, number, number, number][] = [];
  const slots = layout.slots.slice(0, used);
  if (!slots.length) return lines;
  const xs = [...new Set(slots.flatMap((s) => [round(s.x), round(s.x + cardW)]))];
  const ys = [...new Set(slots.flatMap((s) => [round(s.y), round(s.y + cardH)]))];
  const minX = Math.min(...slots.map((s) => s.x));
  const maxX = Math.max(...slots.map((s) => s.x + cardW));
  const minY = Math.min(...slots.map((s) => s.y));
  const maxY = Math.max(...slots.map((s) => s.y + cardH));
  const ext = -layout.drawOffset;
  for (const x of xs) {
    lines.push([x, minY - ext - offsetMm - lengthMm, x, minY - ext - offsetMm]);
    lines.push([x, maxY + ext + offsetMm, x, maxY + ext + offsetMm + lengthMm]);
  }
  for (const y of ys) {
    lines.push([minX - ext - offsetMm - lengthMm, y, minX - ext - offsetMm, y]);
    lines.push([maxX + ext + offsetMm, y, maxX + ext + offsetMm + lengthMm, y]);
  }
  return lines;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** A box on a page in mm, measured from the page's bottom-left corner (as PDF does). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardPage {
  pageW: number;
  pageH: number;
  trim: Box;
  bleed: Box;
}

export function cardPage(cardW: number, cardH: number, bleedMm: number, withBleed: boolean): CardPage {
  const b = withBleed ? bleedMm : 0;
  const pageW = cardW + 2 * b;
  const pageH = cardH + 2 * b;
  return { pageW, pageH, trim: { x: b, y: b, w: cardW, h: cardH }, bleed: { x: 0, y: 0, w: pageW, h: pageH } };
}

export type BacksMode = 'none' | 'duplex' | 'separate';

export function cardPageOrder(count: number, backs: BacksMode): { copy: number; face: 'front' | 'back'; file: 'main' | 'backs' }[] {
  const out: { copy: number; face: 'front' | 'back'; file: 'main' | 'backs' }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ copy: i, face: 'front', file: 'main' });
    if (backs === 'duplex') out.push({ copy: i, face: 'back', file: 'main' });
  }
  if (backs === 'separate') for (let i = 0; i < count; i++) out.push({ copy: i, face: 'back', file: 'backs' });
  return out;
}

/** Tabletop Simulator deck sheets: at most 10 × 7 slots, the 70th is reserved, so 69 cards per sheet. */
export const TTS_MAX_COLS = 10;
export const TTS_MAX_ROWS = 7;
export const TTS_PER_SHEET = 69;

export function ttsGrid(count: number): { cols: number; rows: number } {
  const n = Math.min(count, TTS_PER_SHEET);
  // TTS needs at least 2 columns and 2 rows.
  const cols = Math.max(2, Math.min(TTS_MAX_COLS, n));
  const rows = Math.max(2, Math.min(TTS_MAX_ROWS, Math.ceil(n / cols)));
  return { cols, rows };
}

export function ttsCardPx(cardW: number, cardH: number, cols: number, rows: number, maxSheetPx = 4096): { w: number; h: number } {
  const s = Math.min(maxSheetPx / (cols * cardW), maxSheetPx / (rows * cardH));
  return { w: Math.floor(cardW * s), h: Math.floor(cardH * s) };
}

export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  return (reserved.test(cleaned) ? `_${cleaned}` : cleaned).slice(0, 120) || 'card';
}
