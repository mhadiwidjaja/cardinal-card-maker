import type { PDFDocument, PDFPage } from 'pdf-lib';
import type { CmykConverter } from './cmyk';
import { interpolate, toNumber, toText } from '../expr/expr';
import { cardResolver } from '../model/cardContext';
import { faceNames } from '../model/resolve';
import type { Card, CardSet, Game } from '../model/types';
import type { AssetStore } from '../render/assets';
import { outputSize, renderCard, templateFor, type RenderWarning } from '../render/renderCard';
import { cardPage, cardPageOrder, cropMarks, mirroredSlot, pageLayout, safeFileName, ttsCardPx, ttsGrid, TTS_PER_SHEET, type BacksMode, type PrintOptions } from './layout';

export interface ExportItem {
  set: CardSet;
  card: Card;
}

export interface Progress {
  done: number;
  total: number;
  label: string;
}

export interface ExportWarning extends RenderWarning {
  card: string;
}

export interface ExportFile {
  path: string;
  data: Uint8Array;
}

export type ImageFormat = 'png' | 'jpeg';

const MM_PER_PT = 25.4 / 72;
const pt = (mm: number) => mm / MM_PER_PT;

export function cardLabel(game: Game, item: ExportItem): string {
  const nameField = game.def.fields.find((f) => f.identifying)?.id ?? 'name';
  return item.card.values[nameField] || item.card.id;
}

export function quantityOf(game: Game, item: ExportItem): number {
  const q = game.def.fields.find((f) => f.role === 'quantity');
  if (!q) return 1;
  const n = toNumber(toText(cardResolver(game, item.card, item.set)(q.id) ?? ''));
  return n === null ? 1 : Math.max(0, Math.min(999, Math.floor(n)));
}

export function hasFace(game: Game, card: Card, face: string): boolean {
  const t = templateFor(game, card);
  return !!t && faceNames(game.templates, t).includes(face);
}

/** JPEG has no transparency: empty areas would turn black, so put the card on white paper first. */
export function onWhite(src: HTMLCanvasElement | OffscreenCanvas): HTMLCanvasElement | OffscreenCanvas {
  const out = makeCanvas();
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  return out;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

function makeCanvas(): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
}

export async function canvasBytes(canvas: HTMLCanvasElement | OffscreenCanvas, format: ImageFormat, quality = 0.92): Promise<Uint8Array> {
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  if (format === 'jpeg') canvas = onWhite(canvas);
  const blob =
    // Checked by method: `instanceof OffscreenCanvas` throws in browsers without OffscreenCanvas (Safari before 16.4).
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type, quality })
      : await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

export function quarterTurn(src: HTMLCanvasElement | OffscreenCanvas, dir: 1 | -1): HTMLCanvasElement | OffscreenCanvas {
  const out = makeCanvas();
  out.width = src.height;
  out.height = src.width;
  const ctx = out.getContext('2d') as CanvasRenderingContext2D;
  if (dir === 1) ctx.translate(out.width, 0);
  else ctx.translate(0, out.height);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  return out;
}

/**
 * Renders one face. With `upright`, a sideways (landscape) card is turned a
 * quarter turn that way so it fits the same upright slot as every other card
 * (print sheets and deck sheets use one grid for the whole set).
 */
export async function renderFace(
  game: Game,
  item: ExportItem,
  face: string,
  dpi: number,
  bleed: boolean,
  assets: AssetStore,
  warnings: ExportWarning[],
  upright?: 1 | -1,
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const canvas = makeCanvas();
  const res = await renderCard(canvas, { game, set: item.set, card: item.card, face, dpi, bleed, mode: 'export' }, assets);
  const label = cardLabel(game, item);
  for (const w of res.warnings) warnings.push({ ...w, card: face === 'front' ? label : `${label} (${face})` });
  return upright && res.landscape ? quarterTurn(canvas, upright) : canvas;
}

export interface PngOptions {
  faces: string[];
  dpi: number;
  bleed: boolean;
  pattern: string;
}

export async function exportPngs(
  game: Game,
  items: ExportItem[],
  o: PngOptions,
  assets: AssetStore,
  write: (f: ExportFile) => Promise<void>,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<{ files: number; warnings: ExportWarning[] }> {
  const warnings: ExportWarning[] = [];
  const jobs = items.flatMap((item) => o.faces.filter((f) => hasFace(game, item.card, f)).map((face) => ({ item, face })));
  const used = new Set<string>();
  let n = 0;
  for (const { item, face } of jobs) {
    checkAbort(signal);
    onProgress({ done: n, total: jobs.length, label: cardLabel(game, item) });
    const canvas = await renderFace(game, item, face, o.dpi, o.bleed, assets, warnings);
    let base: string;
    try {
      base = safeFileName(interpolate(o.pattern, cardResolver(game, item.card, item.set)));
    } catch {
      base = safeFileName(item.card.id);
    }
    if (o.faces.length > 1) base += face === 'front' ? '' : ` (${face})`;
    let name = `${base}.png`;
    for (let k = 2; used.has(`${item.set.id}/${name}`); k++) name = `${base} ${k}.png`;
    used.add(`${item.set.id}/${name}`);
    await write({ path: `${safeFileName(item.set.def.name)}/${name}`, data: await canvasBytes(canvas, 'png') });
    n++;
    await tick();
  }
  onProgress({ done: n, total: jobs.length, label: 'Done' });
  return { files: n, warnings };
}

export interface PdfOptions extends PrintOptions {
  dpi: number;
  /**
   * sheets: many cards per page, with margins and crop marks (home printing).
   * perCard: every page is exactly one card plus bleed, for print shops that
   * arrange the sheets themselves. Margins, gap and crop marks are not used.
   */
  layout?: 'sheets' | 'perCard';
  /**
   * none: fronts only · duplex: a back page after each front page (on sheets,
   * mirrored for long-edge flipping) · separate: the backs go into a second
   * PDF (`backData`), in the same order as the fronts.
   */
  backs: BacksMode;
  backOffsetMm: [number, number];
  useQuantity: boolean;
  imageFormat: ImageFormat;
  cmyk?: CmykConverter | null;
}

export async function exportPdf(
  game: Game,
  items: ExportItem[],
  o: PdfOptions,
  assets: AssetStore,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<{ data: Uint8Array; backData?: Uint8Array; pages: number; cards: number; warnings: ExportWarning[] }> {
  const warnings: ExportWarning[] = [];
  const c = game.def.card;
  const perCard = o.layout === 'perCard';
  const layout = pageLayout(c.widthMm, c.heightMm, c.bleedMm, o);
  if (!perCard && layout.perPage === 0) throw new Error('No card fits on the page with these settings. Use a bigger page or smaller margins.');

  const copies: ExportItem[] = [];
  for (const item of items) {
    const n = o.useQuantity ? quantityOf(game, item) : 1;
    for (let i = 0; i < n; i++) copies.push(item);
  }
  // pdf-lib is large, so it is loaded only when a PDF is made.
  const lib = await import('pdf-lib');
  const { PDFDocument, rgb, cmyk: cmykColor, PDFName, PDFString } = lib;
  const conv = o.cmyk ?? null;
  const newDoc = async (title: string) => {
    const doc = await PDFDocument.create();
    doc.setTitle(`${game.def.name} – ${title}`);
    doc.setCreator('Cardinal');
    if (conv?.profile) {
      const icc = doc.context.register(doc.context.flateStream(conv.profile, { N: 4 }));
      const intent = doc.context.obj({
        Type: 'OutputIntent',
        S: 'GTS_PDFX',
        OutputConditionIdentifier: PDFString.of(conv.name),
        Info: PDFString.of(conv.name),
        DestOutputProfile: icc,
      });
      doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([doc.context.register(intent)]));
    }
    return doc;
  };
  const pdf = await newDoc(perCard ? 'cards' : 'print sheet');
  // With "separate", the backs go into their own document (images can't be shared between documents).
  const backPdf = o.backs === 'separate' ? await newDoc(perCard ? 'card backs' : 'print sheet backs') : null;
  const docFor = (face: string) => (face === 'back' && backPdf) || pdf;
  const images = new Map<string, Draw | null>();
  const unique = new Map<string, ExportItem>();
  for (const it of copies) unique.set(`${it.set.id}/${it.card.id}`, it);
  const faces = o.backs === 'none' ? ['front'] : ['front', 'back'];
  const totalRenders = unique.size * faces.length;
  let done = 0;

  const imageFor = async (it: ExportItem, face: string): Promise<Draw | null> => {
    const key = `${it.set.id}/${it.card.id}/${face}`;
    if (images.has(key)) return images.get(key)!;
    checkAbort(signal);
    onProgress({ done, total: totalRenders, label: cardLabel(game, it) });
    let img: Draw | null = null;
    const doc = docFor(face);
    if (face === 'front' || hasFace(game, it.card, face)) {
      // Sideways cards are turned clockwise on front pages. Backs turn the other
      // way, so after a long-edge flip the top of the back lines up with the top of the front.
      const canvas = await renderFace(game, it, face, o.dpi, o.bleed, assets, warnings, face === 'back' ? -1 : 1);
      img = await embedCanvas(lib, doc, canvas, conv, o.imageFormat);
    }
    images.set(key, img);
    done++;
    await tick();
    return img;
  };

  let pages = 0;
  if (perCard) {
    // One card per page: the page is the card plus bleed, with TrimBox and
    // BleedBox set so the shop's prepress software finds the cut line.
    const cp = cardPage(c.widthMm, c.heightMm, c.bleedMm, o.bleed);
    for (const p of cardPageOrder(copies.length, o.backs)) {
      const page = (p.file === 'backs' ? backPdf! : pdf).addPage([pt(cp.pageW), pt(cp.pageH)]);
      page.setBleedBox(pt(cp.bleed.x), pt(cp.bleed.y), pt(cp.bleed.w), pt(cp.bleed.h));
      page.setTrimBox(pt(cp.trim.x), pt(cp.trim.y), pt(cp.trim.w), pt(cp.trim.h));
      pages++;
      // A card without a back still gets its (blank) back page, so pages stay in pairs.
      const img = await imageFor(copies[p.copy]!, p.face);
      if (img) img(page, 0, 0, pt(cp.pageW), pt(cp.pageH));
    }
  }
  const pageW = pt(o.pageWidthMm);
  const pageH = pt(o.pageHeightMm);
  for (let start = 0; !perCard && start < copies.length; start += layout.perPage) {
    const batch = copies.slice(start, start + layout.perPage);
    for (const face of faces) {
      const page = docFor(face).addPage([pageW, pageH]);
      pages++;
      const [ox, oy] = face === 'back' ? o.backOffsetMm : [0, 0];
      for (let i = 0; i < batch.length; i++) {
        const img = await imageFor(batch[i]!, face);
        if (!img) continue;
        const slot = layout.slots[face === 'back' ? mirroredSlot(layout, i) : i]!;
        const x = slot.x + layout.drawOffset + ox;
        const y = slot.y + layout.drawOffset + oy;
        img(page, pt(x), pageH - pt(y + layout.drawH), pt(layout.drawW), pt(layout.drawH));
      }
      if (o.cropMarks && face === 'front') {
        for (const [x1, y1, x2, y2] of cropMarks(layout, c.widthMm, c.heightMm, batch.length)) {
          page.drawLine({ start: { x: pt(x1), y: pageH - pt(y1) }, end: { x: pt(x2), y: pageH - pt(y2) }, thickness: 0.4, color: conv ? cmykColor(0, 0, 0, 1) : rgb(0, 0, 0) });
        }
      }
    }
  }
  onProgress({ done: totalRenders, total: totalRenders, label: 'Writing PDF' });
  const data = await pdf.save();
  const backData = backPdf ? await backPdf.save() : undefined;
  return { data, backData, pages, cards: copies.length, warnings };
}

export type Draw = (page: PDFPage, x: number, y: number, w: number, h: number) => void;

/** Puts a rendered card into a PDF: as lossless DeviceCMYK when converting, else as PNG or JPEG. */
export async function embedCanvas(
  lib: typeof import('pdf-lib'),
  doc: PDFDocument,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  conv: CmykConverter | null,
  format: ImageFormat,
): Promise<Draw> {
  if (conv) {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const stream = doc.context.flateStream(conv.convert(pixels), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: canvas.width,
      Height: canvas.height,
      ColorSpace: 'DeviceCMYK',
      BitsPerComponent: 8,
    });
    const ref = doc.context.register(stream);
    return (page, x, y, w, h) => {
      const name = page.node.newXObject('CardImage', ref);
      page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(w, 0, 0, h, x, y), lib.drawObject(name), lib.popGraphicsState());
    };
  }
  const bytes = await canvasBytes(canvas, format, 0.95);
  const embedded = format === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  return (page, x, y, width, height) => page.drawImage(embedded, { x, y, width, height });
}

export interface TtsOptions {
  useQuantity: boolean;
  maxSheetPx: number;
}

export async function exportTts(
  game: Game,
  items: ExportItem[],
  o: TtsOptions,
  assets: AssetStore,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<{ files: ExportFile[]; sheets: { name: string; cols: number; rows: number; count: number }[]; warnings: ExportWarning[] }> {
  const warnings: ExportWarning[] = [];
  const c = game.def.card;
  const copies: ExportItem[] = [];
  for (const item of items) {
    const n = o.useQuantity ? quantityOf(game, item) : 1;
    for (let i = 0; i < n; i++) copies.push(item);
  }
  const files: ExportFile[] = [];
  const sheets: { name: string; cols: number; rows: number; count: number }[] = [];
  const rendered = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
  const unique = new Set(copies.map((it) => `${it.set.id}/${it.card.id}`)).size;
  let done = 0;

  for (let start = 0, sheetNo = 1; start < copies.length; start += TTS_PER_SHEET, sheetNo++) {
    const batch = copies.slice(start, start + TTS_PER_SHEET);
    const { cols, rows } = ttsGrid(batch.length);
    const { w, h } = ttsCardPx(c.widthMm, c.heightMm, cols, rows, o.maxSheetPx);
    const dpi = (w / c.widthMm) * 25.4;
    const sheet = makeCanvas();
    sheet.width = cols * w;
    sheet.height = rows * h;
    const ctx = sheet.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (let i = 0; i < batch.length; i++) {
      const it = batch[i]!;
      const key = `${it.set.id}/${it.card.id}`;
      let canvas = rendered.get(key);
      if (!canvas) {
        checkAbort(signal);
        onProgress({ done, total: unique, label: cardLabel(game, it) });
        canvas = await renderFace(game, it, 'front', dpi, false, assets, warnings, 1);
        rendered.set(key, canvas);
        done++;
        await tick();
      }
      ctx.drawImage(canvas as CanvasImageSource, (i % cols) * w, Math.floor(i / cols) * h, w, h);
    }
    const name = `deck-${sheetNo}.png`;
    files.push({ path: name, data: await canvasBytes(sheet, 'png') });
    sheets.push({ name, cols, rows, count: batch.length });
  }

  const withBack = items.find((it) => hasFace(game, it.card, 'back'));
  if (withBack) {
    const size = outputSize(game, 300, false);
    const s = Math.min(1, 1024 / size.height);
    const canvas = await renderFace(game, withBack, 'back', 300 * s, false, assets, warnings, 1);
    files.push({ path: 'back.png', data: await canvasBytes(canvas, 'png') });
  }
  const readme = [
    `Tabletop Simulator deck for ${game.def.name}`,
    '',
    'In Tabletop Simulator: Objects → Components → Custom → Deck.',
    ...sheets.map((s) => `  ${s.name}: Width ${s.cols}, Height ${s.rows}, Number ${s.count}`),
    withBack ? '  Back: back.png ("Back is hidden" unchecked)' : '  Back: choose any image',
    '',
    'Upload the images (e.g. Steam Cloud in TTS) or use local file paths.',
    'Sideways (landscape) cards are turned upright on the sheets; turn them in the game.',
  ].join('\r\n');
  files.push({ path: 'README.txt', data: new TextEncoder().encode(readme) });
  onProgress({ done: unique, total: unique, label: 'Done' });
  return { files, sheets, warnings };
}
