import { demoWorkspaceFs } from '../model/demo';
import { loadWorkspace } from '../model/load';
import { faceNames, resolveFace } from '../model/resolve';
import type { Card } from '../model/types';
import { AssetStore } from '../render/assets';
import { renderCard, templateFor } from '../render/renderCard';

/**
 * Development only: the hook the golden-image browser test uses
 * (http://localhost:5173/?sheet&golden, see e2e/run.mjs). It renders demo card
 * faces with the shared renderer and compares them with reference pictures
 * inside the page (canvas getImageData), so no image library is needed.
 *
 * Every card's front is checked. Backs are checked once per back template,
 * because every card that uses a back template gets the same back.
 */

export const CHANNEL_TOLERANCE = 16;
/**
 * A face fails when more than this share of its pixels differ: 0.05%, about
 * 450 pixels of a poker-size card at 300 DPI. One word moving to the next line
 * changed 0.3–0.5% of the pixels when measured, and the same browser on the same
 * machine draws identical pixels each run, so this catches line-break and icon
 * moves while leaving room for tiny anti-aliasing noise. (See docs/decisions.md.)
 */
export const MAX_DIFF_RATIO = 0.0005;

export interface GoldenHook {
  list(): string[];
  render(name: string): Promise<{ png: string; warnings: string[] }>;
  compare(name: string, referencePng: string): Promise<GoldenResult>;
}

export interface GoldenResult {
  ok: boolean;
  ratio: number;
  message: string;
  actual?: string;
  diff?: string;
}

declare global {
  interface Window {
    cmGolden?: GoldenHook;
  }
}

export async function installGoldenHook(): Promise<void> {
  const ws = await loadWorkspace(demoWorkspaceFs());
  const game = ws.games[0]!;
  const set = game.sets[0]!;
  const assets = new AssetStore(demoWorkspaceFs(), game);

  const faces = new Map<string, { card: Card; face: string }>();
  for (const card of set.cards) {
    faces.set(`${card.id} front`, { card, face: 'front' });
    const t = templateFor(game, card);
    if (!t) continue;
    for (const face of faceNames(game.templates, t)) {
      if (face === 'front') continue;
      const resolved = resolveFace(game.templates, t, face);
      const name = `${face}:${resolved?.templateId ?? t}`;
      if (!faces.has(name)) faces.set(name, { card, face });
    }
  }

  const draw = async (name: string) => {
    const job = faces.get(name);
    if (!job) throw new Error(`No face called "${name}"`);
    const canvas = document.createElement('canvas');
    const r = await renderCard(canvas, { game, set, card: job.card, face: job.face, bleed: true, mode: 'export', dpi: game.def.card.dpi }, assets);
    return { canvas, warnings: r.warnings.map((w) => (w.layer ? `${w.layer}: ${w.message}` : w.message)) };
  };

  window.cmGolden = {
    list: () => [...faces.keys()],
    async render(name) {
      const { canvas, warnings } = await draw(name);
      return { png: canvas.toDataURL('image/png'), warnings };
    },
    async compare(name, referencePng) {
      const { canvas } = await draw(name);
      const ref = await loadImage(referencePng);
      if (ref.width !== canvas.width || ref.height !== canvas.height) {
        return {
          ok: false,
          ratio: 1,
          message: `size changed from ${ref.width}×${ref.height} to ${canvas.width}×${canvas.height}`,
          actual: canvas.toDataURL('image/png'),
        };
      }
      return comparePixels(canvas, ref);
    },
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the reference picture'));
    img.src = src;
  });
}

function comparePixels(actual: HTMLCanvasElement, reference: HTMLImageElement): GoldenResult {
  const { width, height } = actual;
  const refCanvas = document.createElement('canvas');
  refCanvas.width = width;
  refCanvas.height = height;
  const refCtx = refCanvas.getContext('2d')!;
  refCtx.drawImage(reference, 0, 0);
  const a = actual.getContext('2d')!.getImageData(0, 0, width, height).data;
  const b = refCtx.getImageData(0, 0, width, height).data;

  const diff = refCtx.createImageData(width, height);
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!), Math.abs(a[i + 3]! - b[i + 3]!));
    if (delta > CHANNEL_TOLERANCE) {
      differing++;
      diff.data.set([255, 0, 0, 255], i);
    } else {
      const grey = 255 - ((255 - (b[i]! + b[i + 1]! + b[i + 2]!) / 3) * b[i + 3]!) / 255 / 4;
      diff.data.set([grey, grey, grey, 255], i);
    }
  }
  const ratio = differing / (width * height);
  const ok = ratio <= MAX_DIFF_RATIO;
  const message = `${(ratio * 100).toFixed(2)}% of pixels differ (limit ${(MAX_DIFF_RATIO * 100).toFixed(2)}%)`;
  if (ok) return { ok, ratio, message };
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = width;
  diffCanvas.height = height;
  diffCanvas.getContext('2d')!.putImageData(diff, 0, 0);
  return { ok, ratio, message, actual: actual.toDataURL('image/png'), diff: diffCanvas.toDataURL('image/png') };
}

