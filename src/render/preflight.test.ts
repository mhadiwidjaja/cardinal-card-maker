import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iccGamutDelta } from '../export/cmyk';
import type { Game } from '../model/types';
import { checkFace, GAMUT_THRESHOLD, gamutMask, printRules } from './preflight';
import type { LayerBox } from './renderCard';

// 63 × 88 mm, 3 mm bleed and safe zone, 300 DPI: 815 × 1110 px; safe area starts at 71 px.
const game = { def: { card: { widthMm: 63, heightMm: 88, bleedMm: 3, safeMm: 3, dpi: 300 }, fields: [] } } as unknown as Game;
const kinds = (boxes: LayerBox[]) => checkFace(game, boxes, false).map((i) => `${i.kind}:${i.level}`);

describe('checkFace', () => {
  it('passes a well-made card', () => {
    const boxes: LayerBox[] = [
      { id: 'art', rect: [0, 0, 815, 600], check: { type: 'image', ink: [0, 0, 815, 600], image: { src: 'art/a.png', width: 1700, height: 1250, drawnW: 815, drawnH: 600 } } },
      { id: 'rules', rect: [80, 700, 650, 300], check: { type: 'text', ink: [90, 710, 600, 200], fontSize: 30, overflow: false } },
    ];
    expect(kinds(boxes)).toEqual([]);
  });

  it('finds low-resolution art, tiny text, overflow, text past the safe zone and hairlines', () => {
    const boxes: LayerBox[] = [
      { id: 'art', rect: [0, 0, 815, 600], check: { type: 'image', ink: [0, 0, 815, 600], image: { src: 'art/small.jpg', width: 400, height: 300, drawnW: 815, drawnH: 600 } } },
      { id: 'rules', rect: [80, 700, 650, 300], check: { type: 'text', ink: [90, 710, 600, 200], fontSize: 20, designSize: 30, overflow: true } },
      { id: 'name', rect: [40, 40, 700, 60], check: { type: 'text', ink: [50, 45, 300, 50], fontSize: 40, overflow: false } },
      { id: 'border', rect: [0, 0, 815, 1110], check: { type: 'shape', stroke: 0.5 } },
    ];
    expect(kinds(boxes)).toEqual(['art-resolution:error', 'overflow:error', 'text-size:warning', 'safe-zone:warning', 'hairline:warning']);
    const art = checkFace(game, boxes, false)[0]!;
    expect(art.message).toContain('147 PPI');
  });

  it('ignores SVG pictures (they are vector) and pictures that bleed off the edge', () => {
    const boxes: LayerBox[] = [{ id: 'frame', rect: [0, 0, 815, 1110], check: { type: 'image', ink: [0, 0, 815, 1110], image: { src: 'frames/f.svg', width: 512, height: 700, drawnW: 815, drawnH: 1110 } } }];
    expect(kinds(boxes)).toEqual([]);
  });

  it('reads the limits from game.json', () => {
    const g = { def: { ...game.def, print: { minTextPt: 4, minPpi: 0 } } } as unknown as Game;
    expect(printRules(g)).toEqual({ minPpi: 300, minTextPt: 4, minLinePt: 0.25 });
  });
});

describe('gamutMask', () => {
  it('marks pixels whose colour moves a lot, ignoring transparent ones', () => {
    const px = new Uint8ClampedArray([0, 0, 255, 255, 128, 128, 128, 255, 0, 0, 255, 0]);
    const r = gamutMask(px, (r, _g, b) => (b > 0.9 && r < 0.1 ? 30 : 2));
    expect([...r.mask]).toEqual([1, 0, 0]);
    expect(r.ratio).toBeCloseTo(0.5);
  });

  const RSWOP = 'C:/Windows/System32/spool/drivers/color/RSWOP.icm';
  it.skipIf(!existsSync(RSWOP))('knows that SWOP presses cannot print screen blue, but can print greys and skin tones', () => {
    const delta = iccGamutDelta(new Uint8Array(readFileSync(RSWOP)));
    const hex = (h: string) => delta(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
    for (const out of ['#0000ff', '#00ffff', '#ff00ff', '#00ff00', '#4060ff']) expect(hex(out), out).toBeGreaterThan(GAMUT_THRESHOLD);
    for (const ok of ['#808080', '#2b2b33', '#d9a07a', '#e9c46a', '#c0392b', '#3b2a5c', '#1b2a4a']) expect(hex(ok), ok).toBeLessThan(GAMUT_THRESHOLD);
  });
});
