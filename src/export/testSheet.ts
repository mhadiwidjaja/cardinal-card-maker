import type { PDFFont } from 'pdf-lib';
import type { CmykConverter } from './cmyk';
import { embedCanvas, renderFace, type ExportItem, type ExportWarning, type ImageFormat } from './exporters';
import { parseHex } from '../model/colourVision';
import type { Game } from '../model/types';
import type { AssetStore } from '../render/assets';
import { printRules } from '../render/preflight';

/**
 * A one-page test print to send to the shop before a large order: a ruler to
 * check the scale, one card at real size with its cut and safe lines, colour
 * swatches (the game's own colours and process inks) and the smallest text and
 * line sizes. All lengths in mm from the page's top-left corner.
 */
export interface TestSheetLayout {
  margin: number;
  card: { x: number; y: number; w: number; h: number };
  ruler: { x: number; y: number; length: number };
  vRuler: { x: number; y: number; length: number };
  samples: { x: number; y: number };
  swatches: { x: number; y: number; size: number; gap: number; perRow: number };
}

export const SWATCH_MM = 14;

export function testSheetLayout(pageW: number, cardW: number, cardH: number, bleed: number): TestSheetLayout {
  const margin = 12;
  const top = margin + 20;
  const card = { x: margin + 6, y: top + 7, w: cardW + 2 * bleed, h: cardH + 2 * bleed };
  const colX = card.x + card.w + 10;
  const colW = pageW - margin - colX;
  const length = Math.max(10, Math.min(100, Math.floor(colW / 10) * 10));
  const vLength = Math.max(10, Math.min(100, Math.floor((card.h - 14) / 10) * 10));
  const gap = 5;
  const perRow = Math.max(1, Math.floor((pageW - 2 * margin + gap) / (SWATCH_MM + gap)));
  return {
    margin,
    card,
    ruler: { x: colX, y: top + 6, length },
    vRuler: { x: colX, y: top + 18, length: vLength },
    samples: { x: colX + 14, y: top + 20 },
    swatches: { x: margin, y: card.y + card.h + 28, size: SWATCH_MM, gap, perRow },
  };
}

export interface Swatch {
  label: string;
  rgb?: [number, number, number];
  cmyk?: [number, number, number, number];
}

/** The game's own field colours, then the process inks at 100 / 50 / 20 %, rich black and a grey ramp. */
export function testSwatches(game: Game): Swatch[] {
  const out: Swatch[] = [];
  const seen = new Set<string>();
  for (const f of game.def.fields) {
    for (const [name, hex] of Object.entries(f.colors ?? {})) {
      const rgb = parseHex(hex);
      if (!rgb || seen.has(hex.toLowerCase())) continue;
      seen.add(hex.toLowerCase());
      out.push({ label: `${name} ${hex}`, rgb });
    }
  }
  const inks = ['C', 'M', 'Y', 'K'];
  for (const [i, ink] of inks.entries()) {
    for (const v of [100, 50, 20]) {
      const cmyk: [number, number, number, number] = [0, 0, 0, 0];
      cmyk[i] = v / 100;
      out.push({ label: `${ink} ${v}%`, cmyk });
    }
  }
  out.push({ label: 'Rich black', cmyk: [0.6, 0.4, 0.4, 1] });
  for (const k of [80, 60, 40, 10]) out.push({ label: `Grey K ${k}%`, cmyk: [0, 0, 0, k / 100] });
  return out;
}

export interface TestSheetOptions {
  pageWidthMm: number;
  pageHeightMm: number;
  pageName: string;
  dpi: number;
  imageFormat: ImageFormat;
  cmyk: CmykConverter | null;
}

const PT_PER_MM = 72 / 25.4;
const pt = (mm: number) => mm * PT_PER_MM;

export async function exportTestSheet(game: Game, item: ExportItem, o: TestSheetOptions, assets: AssetStore): Promise<{ data: Uint8Array; warnings: ExportWarning[] }> {
  const warnings: ExportWarning[] = [];
  const c = game.def.card;
  const L = testSheetLayout(o.pageWidthMm, c.widthMm, c.heightMm, c.bleedMm);
  const lib = await import('pdf-lib');
  const { PDFDocument, StandardFonts, rgb, cmyk } = lib;
  const doc = await PDFDocument.create();
  doc.setTitle(`${game.def.name} – test print`);
  doc.setCreator('Card Maker');
  const page = doc.addPage([pt(o.pageWidthMm), pt(o.pageHeightMm)]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const H = pt(o.pageHeightMm);
  const black = o.cmyk ? cmyk(0, 0, 0, 1) : rgb(0, 0, 0);
  const grey = o.cmyk ? cmyk(0, 0, 0, 0.6) : rgb(0.4, 0.4, 0.4);
  const cut = cmyk(0, 1, 0, 0);
  const safe = cmyk(1, 0, 0, 0);

  const line = (x1: number, y1: number, x2: number, y2: number, thickness = 0.25, color = black, dash?: number[]) =>
    page.drawLine({ start: { x: pt(x1), y: H - pt(y1) }, end: { x: pt(x2), y: H - pt(y2) }, thickness, color, dashArray: dash });
  const text = (s: string, x: number, y: number, size = 7, f: PDFFont = font, color = black) => page.drawText(s, { x: pt(x), y: H - pt(y), size, font: f, color });
  const rect = (x: number, y: number, w: number, h: number, stroke: ReturnType<typeof cmyk>, dash?: number[]) =>
    page.drawRectangle({ x: pt(x), y: H - pt(y + h), width: pt(w), height: pt(h), borderColor: stroke, borderWidth: 0.5, borderDashArray: dash });

  const colour = o.cmyk ? `CMYK, ${o.cmyk.name}` : 'RGB';
  text(`Test print · ${game.def.name}`, L.margin, L.margin + 5, 13, bold);
  text(`${o.pageName} at 100% / actual size · ${o.dpi} DPI · ${colour} · ${new Date().toISOString().slice(0, 10)}`, L.margin, L.margin + 11, 8, font, grey);

  // Card at real size, with bleed, cut line, safe zone and crop marks.
  const k = L.card;
  const canvas = await renderFace(game, item, 'front', o.dpi, true, assets, warnings, 1);
  const draw = await embedCanvas(lib, doc, canvas, o.cmyk, o.imageFormat);
  draw(page, pt(k.x), H - pt(k.y + k.h), pt(k.w), pt(k.h));
  const b = c.bleedMm;
  rect(k.x + b, k.y + b, c.widthMm, c.heightMm, cut);
  rect(k.x + b + c.safeMm, k.y + b + c.safeMm, c.widthMm - 2 * c.safeMm, c.heightMm - 2 * c.safeMm, safe, [3, 2]);
  const tx = [k.x + b, k.x + b + c.widthMm];
  const ty = [k.y + b, k.y + b + c.heightMm];
  for (const x of tx) {
    line(x, k.y - 6, x, k.y - 1);
    line(x, k.y + k.h + 1, x, k.y + k.h + 6);
  }
  for (const y of ty) {
    line(k.x - 6, y, k.x - 1, y);
    line(k.x + k.w + 1, y, k.x + k.w + 6, y);
  }
  text(`${c.widthMm} × ${c.heightMm} mm, ${b} mm bleed`, k.x, k.y + k.h + 10, 7);
  line(k.x, k.y + k.h + 12.5, k.x + 6, k.y + k.h + 12.5, 1, cut);
  text('cut line', k.x + 8, k.y + k.h + 13.2, 6.5);
  line(k.x + 24, k.y + k.h + 12.5, k.x + 30, k.y + k.h + 12.5, 1, safe, [3, 2]);
  text(`safe zone (${c.safeMm} mm)`, k.x + 32, k.y + k.h + 13.2, 6.5);

  // Rulers: they must measure exactly their length on paper.
  const r = L.ruler;
  line(r.x, r.y, r.x + r.length, r.y, 0.4);
  for (let mm = 0; mm <= r.length; mm++) {
    const len = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.5;
    line(r.x + mm, r.y, r.x + mm, r.y + len, 0.25);
    if (mm % 10 === 0) text(String(mm), r.x + mm - (mm >= 10 ? 1.3 : 0.6), r.y + 7, 5.5);
  }
  text(`Must measure ${r.length} mm`, r.x, r.y - 2, 7, bold);
  const v = L.vRuler;
  line(v.x, v.y, v.x, v.y + v.length, 0.4);
  for (let mm = 0; mm <= v.length; mm++) {
    const len = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.5;
    line(v.x, v.y + mm, v.x + len, v.y + mm, 0.25);
    if (mm % 10 === 0) text(String(mm), v.x + 5, v.y + mm + 1, 5.5);
  }

  // Smallest text and lines.
  const rules = printRules(game);
  let y = L.samples.y;
  text('Text sizes', L.samples.x, y, 7, bold);
  y += 5;
  for (const size of [5, 6, 7, 8, 10]) {
    const mark = size === rules.minTextPt ? '  (print check minimum)' : '';
    text(`${size} pt  Deal 2 damage to a unit.${mark}`, L.samples.x, y, size);
    y += size * 0.3528 + 3;
  }
  y += 3;
  text('Line widths', L.samples.x, y, 7, bold);
  y += 4;
  for (const w of [0.1, 0.25, 0.5, 1]) {
    line(L.samples.x, y, L.samples.x + 30, y, w);
    const mark = w === rules.minLinePt ? '  (print check minimum)' : '';
    text(`${w} pt${mark}`, L.samples.x + 33, y + 1, 6);
    y += 5;
  }

  // Colour swatches.
  const s = L.swatches;
  text('Colours: compare with the screen; the inks show how the press lays them down', s.x, s.y - 3, 7, bold);
  testSwatches(game).forEach((sw, i) => {
    const x = s.x + (i % s.perRow) * (s.size + s.gap);
    const top = s.y + Math.floor(i / s.perRow) * (s.size + 9);
    const fill = sw.cmyk
      ? cmyk(...sw.cmyk)
      : o.cmyk
        ? cmyk(...o.cmyk.convertOne(...sw.rgb!))
        : rgb(...sw.rgb!);
    page.drawRectangle({ x: pt(x), y: H - pt(top + s.size), width: pt(s.size), height: pt(s.size), color: fill, borderColor: grey, borderWidth: 0.25 });
    text(sw.label, x, top + s.size + 3, 5);
  });
  const rows = Math.ceil(testSwatches(game).length / s.perRow);
  let fy = s.y + rows * (s.size + 9) + 6;
  text('Check before ordering', L.margin, fy, 8, bold);
  for (const tip of [
    `1. The ruler measures exactly ${r.length} mm. If not, print at 100% / "actual size", not "fit to page".`,
    '2. The cut lands on the magenta line; nothing important crosses the dashed cyan line.',
    '3. The colours look right next to the screen; dark colours often print darker.',
    '4. The smallest text and thinnest line you need are still clear.',
  ]) {
    fy += 5;
    text(tip, L.margin, fy, 7);
  }

  return { data: await doc.save(), warnings };
}
