import { describe, expect, it } from 'vitest';
import { cardPage, cardPageOrder, cropMarks, mirroredSlot, orientPage, pageLayout, safeFileName, ttsCardPx, ttsGrid } from './layout';

const a4 = { pageWidthMm: 210, pageHeightMm: 297, marginMm: 5, gapMm: 0, bleed: false, cropMarks: true };

describe('pageLayout', () => {
  it('fits 9 poker-size cards on A4, centred', () => {
    const l = pageLayout(63, 88, 3, a4);
    expect([l.cols, l.rows, l.perPage]).toEqual([3, 3, 9]);
    expect(l.slots[0]!.x).toBeCloseTo((210 - 189) / 2);
    expect(l.slots[0]!.y).toBeCloseTo((297 - 264) / 2);
    expect(l.slots[1]!.x - l.slots[0]!.x).toBeCloseTo(63);
  });

  it('spaces cards so printed bleed does not overlap', () => {
    const l = pageLayout(63, 88, 3, { ...a4, bleed: true });
    expect(l.slots[1]!.x - l.slots[0]!.x).toBeCloseTo(69);
    expect([l.drawW, l.drawH, l.drawOffset]).toEqual([69, 94, -3]);
    expect(l.cols).toBe(2);
  });

  it('uses the gap when it is larger than the bleed', () => {
    const l = pageLayout(63, 88, 3, { ...a4, gapMm: 2 });
    expect(l.slots[1]!.x - l.slots[0]!.x).toBeCloseTo(65);
  });

  it('mirrors columns for back pages', () => {
    const l = pageLayout(63, 88, 3, a4);
    expect([0, 1, 2, 3, 8].map((i) => mirroredSlot(l, i))).toEqual([2, 1, 0, 5, 6]);
  });

  it('places crop marks outside the grid at each cut line', () => {
    const l = pageLayout(63, 88, 3, a4);
    const marks = cropMarks(l, 63, 88, 9);
    expect(marks).toHaveLength(16);
    const top = l.slots[0]!.y;
    expect(marks.every(([, y1, , y2]) => y1 === y2 || Math.max(y1, y2) <= top - 1 || Math.min(y1, y2) >= top + 3 * 88 + 1)).toBe(true);
  });
});

describe('one card per page', () => {
  it('is the card plus bleed, with the trim box inside', () => {
    const p = cardPage(63, 88, 3, true);
    expect([p.pageW, p.pageH]).toEqual([69, 94]);
    expect(p.trim).toEqual({ x: 3, y: 3, w: 63, h: 88 });
    expect(p.bleed).toEqual({ x: 0, y: 0, w: 69, h: 94 });
  });

  it('is the trim size when bleed is off', () => {
    const p = cardPage(63, 88, 3, false);
    expect([p.pageW, p.pageH]).toEqual([63, 88]);
    expect(p.trim).toEqual(p.bleed);
  });

  it('orders pages: fronts only, back after each front, or backs in a second file', () => {
    const show = (backs: 'none' | 'duplex' | 'separate') => cardPageOrder(2, backs).map((p) => `${p.file}:${p.copy}${p.face[0]}`);
    expect(show('none')).toEqual(['main:0f', 'main:1f']);
    expect(show('duplex')).toEqual(['main:0f', 'main:0b', 'main:1f', 'main:1b']);
    expect(show('separate')).toEqual(['main:0f', 'main:1f', 'backs:0b', 'backs:1b']);
  });
});

describe('Tabletop Simulator sheets', () => {
  it('uses at most 10 × 7 and at least 2 × 2', () => {
    expect(ttsGrid(1)).toEqual({ cols: 2, rows: 2 });
    expect(ttsGrid(14)).toEqual({ cols: 10, rows: 2 });
    expect(ttsGrid(200)).toEqual({ cols: 10, rows: 7 });
  });

  it('keeps the sheet within 4096 px', () => {
    const { w, h } = ttsCardPx(63, 88, 10, 7);
    expect(w * 10).toBeLessThanOrEqual(4096);
    expect(h * 7).toBeLessThanOrEqual(4096);
  });
});

describe('safeFileName', () => {
  it('removes characters Windows does not allow', () => {
    expect(safeFileName('001 Fire: "Big"/Small?')).toBe('001 Fire BigSmall');
    expect(safeFileName('con')).toBe('_con');
    expect(safeFileName('  ')).toBe('card');
    expect(safeFileName('name. ')).toBe('name');
  });
});

describe('orientPage', () => {
  const fits = (bleed: boolean) => (pageWidthMm: number, pageHeightMm: number) => pageLayout(63, 88, 3, { ...a4, pageWidthMm, pageHeightMm, bleed }).perPage;

  it('turns the page as asked', () => {
    expect(orientPage([210, 297], 'portrait', fits(false))).toEqual({ pageW: 210, pageH: 297, landscape: false });
    expect(orientPage([210, 297], 'landscape', fits(false))).toEqual({ pageW: 297, pageH: 210, landscape: true });
  });

  it('auto picks landscape for poker cards with bleed on A4 (8 instead of 6)', () => {
    const o = orientPage([210, 297], 'auto', fits(true));
    expect(o.landscape).toBe(true);
    expect(fits(true)(o.pageW, o.pageH)).toBe(8);
    expect(fits(true)(210, 297)).toBe(6);
  });

  it('auto keeps portrait when it fits more (poker cards without bleed: 9 vs 8)', () => {
    expect(orientPage([210, 297], 'auto', fits(false)).landscape).toBe(false);
  });
});
