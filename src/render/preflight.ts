import type { Game, Rect } from '../model/types';
import type { LayerBox } from './renderCard';
import { templateSize } from './renderCard';

/**
 * Print check ("preflight"): problems a print shop would print exactly as
 * they are. Works on the facts renderCard reports for each layer
 * (LayerBox.check), so it needs no second drawing path. Pure, unit-tested.
 *
 * Colours the press can't reach are checked separately on the pixels
 * (src/export/cmyk.ts → iccGamutDelta), because they need the shop's profile.
 */

export interface PrintRules {
  /** Lowest acceptable resolution of a picture at its printed size. */
  minPpi: number;
  /** Smallest readable text size after shrink-to-fit, in points. */
  minTextPt: number;
  /** Thinnest outline that reliably prints, in points. */
  minLinePt: number;
}

export const DEFAULT_PRINT_RULES: PrintRules = { minPpi: 300, minTextPt: 6, minLinePt: 0.25 };

export type IssueKind = 'overflow' | 'text-size' | 'safe-zone' | 'art-resolution' | 'hairline' | 'colour';

export interface PrintIssue {
  kind: IssueKind;
  level: 'error' | 'warning';
  layer?: string;
  message: string;
  rect?: Rect;
}

export function printRules(game: Game): PrintRules {
  const p = game.def.print ?? {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  return { minPpi: num(p.minPpi, DEFAULT_PRINT_RULES.minPpi), minTextPt: num(p.minTextPt, DEFAULT_PRINT_RULES.minTextPt), minLinePt: num(p.minLinePt, DEFAULT_PRINT_RULES.minLinePt) };
}

const inside = (r: Rect, area: Rect, tol = 0.5) => r[0] >= area[0] - tol && r[1] >= area[1] - tol && r[0] + r[2] <= area[0] + area[2] + tol && r[1] + r[3] <= area[1] + area[3] + tol;
const fmt = (n: number, digits = 1) => String(Math.round(n * 10 ** digits) / 10 ** digits);

export function checkFace(game: Game, boxes: LayerBox[], landscape: boolean, rules: PrintRules = printRules(game)): PrintIssue[] {
  const dpi = game.def.card.dpi;
  const pt = (px: number) => (px / dpi) * 72;
  const size = templateSize(game, landscape);
  const safeArea: Rect = [size.bleed + size.safe, size.bleed + size.safe, size.width - 2 * (size.bleed + size.safe), size.height - 2 * (size.bleed + size.safe)];
  const issues: PrintIssue[] = [];

  for (const b of boxes) {
    const c = b.check;
    if (!c) continue;
    if (c.type === 'text' && c.overflow) {
      issues.push({ kind: 'overflow', level: 'error', layer: b.id, message: 'Text does not fit in its box, even at the smallest allowed size', rect: b.rect });
    }
    if (c.type === 'text' && c.fontSize !== undefined && c.ink && pt(c.fontSize) < rules.minTextPt - 0.05) {
      issues.push({
        kind: 'text-size',
        level: 'warning',
        layer: b.id,
        message: `Text ${c.designSize !== undefined && c.fontSize < c.designSize - 0.01 ? 'shrinks to' : 'is'} ${fmt(pt(c.fontSize))} pt; under ${fmt(rules.minTextPt)} pt is hard to read on a card`,
        rect: c.ink,
      });
    }
    if ((c.type === 'text' || c.type === 'icons') && c.ink && !inside(c.ink, safeArea)) {
      issues.push({ kind: 'safe-zone', level: 'warning', layer: b.id, message: 'Text or icons outside the safe zone: they may be cut off or look crowded at the edge', rect: c.ink });
    }
    if (c.image && !/\.svg$/i.test(c.image.src)) {
      // Pixels per inch at the printed size, along the less detailed direction.
      const ppi = Math.min(c.image.width / (c.image.drawnW / dpi), c.image.height / (c.image.drawnH / dpi));
      if (ppi < rules.minPpi - 0.5) {
        issues.push({
          kind: 'art-resolution',
          level: ppi < rules.minPpi / 2 ? 'error' : 'warning',
          layer: b.id,
          message: `${c.image.src} prints at ${Math.round(ppi)} PPI (${c.image.width}×${c.image.height} px); ${rules.minPpi} or more looks sharp`,
          rect: c.ink ?? b.rect,
        });
      }
    }
    if (c.stroke !== undefined && c.stroke > 0 && pt(c.stroke) < rules.minLinePt) {
      issues.push({ kind: 'hairline', level: 'warning', layer: b.id, message: `Outline is ${fmt(pt(c.stroke), 2)} pt thin; under ${fmt(rules.minLinePt, 2)} pt may not print`, rect: b.rect });
    }
  }
  return issues;
}

/**
 * Measured with the Windows SWOP profile: greys, skin tones, the demo's gold
 * and red stay under 6; screen blue (17.5), cyan (15.5), magenta (16.7) and
 * pure green (8.9) go over. 8 separates the two.
 */
export const GAMUT_THRESHOLD = 8;

export function gamutMask(rgba: Uint8ClampedArray, delta: (r: number, g: number, b: number) => number, threshold = GAMUT_THRESHOLD): { ratio: number; mask: Uint8Array } {
  const n = rgba.length / 4;
  const mask = new Uint8Array(n);
  let bad = 0;
  let counted = 0;
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3]!;
    if (a < 128) continue;
    counted++;
    if (delta(rgba[i * 4]! / 255, rgba[i * 4 + 1]! / 255, rgba[i * 4 + 2]! / 255) > threshold) {
      mask[i] = 1;
      bad++;
    }
  }
  return { ratio: counted ? bad / counted : 0, mask };
}
