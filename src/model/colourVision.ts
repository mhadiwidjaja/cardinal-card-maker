import { srgbToXyzD50, xyzToLab } from '../export/cmyk';
import type { Game } from './types';

/**
 * Colour-blindness simulation (Machado, Oliveira and Fernandes 2009, severity
 * 1.0, applied in linear RGB) and a check that a field's colours (e.g. the
 * elements) can still be told apart. Used by the preview filter
 * (ui/vision.tsx) and by Game settings.
 */

export type Vision = 'normal' | 'protan' | 'deutan' | 'tritan' | 'grey';
export type Matrix3 = [number, number, number, number, number, number, number, number, number];

export const VISION_MATRICES: Record<Exclude<Vision, 'normal'>, Matrix3> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
  // Luminance (Rec. 709) on every channel: shows whether colours differ in brightness at all.
  grey: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
};

export const VISION_LABELS: Record<Vision, string> = {
  normal: 'Normal vision',
  protan: 'Protanopia (red-blind)',
  deutan: 'Deuteranopia (green-blind)',
  tritan: 'Tritanopia (blue-blind)',
  grey: 'Greyscale',
};

const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};

export function parseHex(text: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export function simulate(rgb: [number, number, number], vision: Vision): [number, number, number] {
  if (vision === 'normal') return rgb;
  const m = VISION_MATRICES[vision];
  const [r, g, b] = rgb.map(toLin) as [number, number, number];
  return [toSrgb(m[0] * r + m[1] * g + m[2] * b), toSrgb(m[3] * r + m[4] * g + m[5] * b), toSrgb(m[6] * r + m[7] * g + m[8] * b)];
}

export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const la = xyzToLab(srgbToXyzD50(...a));
  const lb = xyzToLab(srgbToXyzD50(...b));
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

export interface ColourClash {
  field: string;
  a: string;
  b: string;
  vision: Vision;
  deltaE: number;
  seenA: string;
  seenB: string;
}

/** Below this, two colours are hard to tell apart on a card (small icons, frames seen across a table). */
export const CLASH_DELTA_E = 20;

const hex = (rgb: [number, number, number]) => '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

export function colourClashes(game: Game): ColourClash[] {
  const out: ColourClash[] = [];
  for (const f of game.def.fields) {
    const colours = Object.entries(f.colors ?? {})
      .map(([value, c]) => [value, parseHex(c)] as const)
      .filter((x): x is readonly [string, [number, number, number]] => x[1] !== null);
    for (let i = 0; i < colours.length; i++)
      for (let j = i + 1; j < colours.length; j++) {
        const [va, ca] = colours[i]!;
        const [vb, cb] = colours[j]!;
        for (const vision of ['normal', 'protan', 'deutan', 'tritan', 'grey'] as Vision[]) {
          const sa = simulate(ca, vision);
          const sb = simulate(cb, vision);
          const d = deltaE(sa, sb);
          if (d < CLASH_DELTA_E) out.push({ field: f.id, a: va, b: vb, vision, deltaE: d, seenA: hex(sa), seenB: hex(sb) });
        }
      }
  }
  return out.sort((x, y) => x.deltaE - y.deltaE);
}
