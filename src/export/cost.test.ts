import { describe, expect, it } from 'vitest';
import { costOptions, DEFAULT_PRICES } from './cost';

const poker = { cardWmm: 63, cardHmm: 88, bleedMm: 3, copies: 100, backs: false, bleed: true, marginMm: 5 };

describe('print cost planner', () => {
  it('compares paper sizes and orientations, cheapest first', () => {
    const opts = costOptions(poker, { ...DEFAULT_PRICES, sheet: { A4: 2000, A3: 3500 }, cutPerSheet: 500 });
    const a4l = opts.find((o) => o.label === 'A4 landscape')!;
    expect(a4l.perSheet).toBe(8);
    expect(a4l.sheets).toBe(13);
    expect(a4l.emptySlots).toBe(4);
    expect(a4l.total).toBe(13 * 2500);
    expect(opts[0]!.total).toBeLessThanOrEqual(opts[opts.length - 1]!.total);
    expect(opts.some((o) => o.label.startsWith('A3'))).toBe(true);
  });

  it('adds backs, fixed costs and card-by-card printing', () => {
    const opts = costOptions({ ...poker, backs: true, copies: 10 }, { ...DEFAULT_PRICES, sheet: { A4: 1000 }, backExtra: 800, perCard: 300, fixed: 5000 });
    expect(opts.find((o) => o.label.startsWith('Card by card'))!.total).toBe(10 * 300 + 5000);
    expect(opts.find((o) => o.label === 'A4 landscape')!.total).toBe(2 * 1800 + 5000);
  });

  it('offers nothing without prices or cards', () => {
    expect(costOptions(poker, DEFAULT_PRICES)).toEqual([]);
    expect(costOptions({ ...poker, copies: 0 }, { ...DEFAULT_PRICES, sheet: { A4: 1 } })).toEqual([]);
  });
});
