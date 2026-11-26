import { orientPage, PAGE_SIZES, pageLayout } from './layout';

export interface ShopPrices {
  /** Price of one printed sheet, per paper size (one side). 0 or missing = not offered. */
  sheet: Record<string, number>;
  backExtra: number;
  cutPerSheet: number;
  /** Shops that print card by card (one card per page): price per card. 0 = not offered. */
  perCard: number;
  fixed: number;
}

export const DEFAULT_PRICES: ShopPrices = { sheet: { A4: 0, A3: 0 }, backExtra: 0, cutPerSheet: 0, perCard: 0, fixed: 0 };

export interface CostOption {
  label: string;
  perSheet: number;
  sheets: number;
  emptySlots: number;
  total: number;
  perCopy: number;
}

export interface CostInput {
  cardWmm: number;
  cardHmm: number;
  bleedMm: number;
  copies: number;
  backs: boolean;
  bleed: boolean;
  marginMm: number;
}

export function costOptions(input: CostInput, prices: ShopPrices): CostOption[] {
  const out: CostOption[] = [];
  if (input.copies <= 0) return out;
  for (const [paper, price] of Object.entries(prices.sheet)) {
    const size = PAGE_SIZES[paper];
    if (!size || !(price > 0)) continue;
    for (const orientation of ['portrait', 'landscape'] as const) {
      const fit = (w: number, h: number) =>
        pageLayout(input.cardWmm, input.cardHmm, input.bleedMm, { pageWidthMm: w, pageHeightMm: h, marginMm: input.marginMm, gapMm: 0, bleed: input.bleed, cropMarks: true }).perPage;
      const { pageW, pageH } = orientPage(size, orientation, fit);
      const perSheet = fit(pageW, pageH);
      if (perSheet === 0) continue;
      const sheets = Math.ceil(input.copies / perSheet);
      const perSheetPrice = price + (input.backs ? prices.backExtra : 0) + prices.cutPerSheet;
      const total = sheets * perSheetPrice + prices.fixed;
      out.push({ label: `${paper} ${orientation}`, perSheet, sheets, emptySlots: sheets * perSheet - input.copies, total, perCopy: total / input.copies });
    }
  }
  if (prices.perCard > 0) {
    const total = input.copies * prices.perCard + prices.fixed;
    out.push({ label: 'Card by card (one card per page)', perSheet: 1, sheets: input.copies, emptySlots: 0, total, perCopy: total / input.copies });
  }
  // Same layout found twice (e.g. both orientations fit the same number): keep one.
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.total - b.total || b.perSheet - a.perSheet)
    .filter((o) => {
      const k = `${o.label.split(' ')[0]}:${o.perSheet}:${o.total}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
