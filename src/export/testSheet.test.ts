import { describe, expect, it } from 'vitest';
import { SWATCH_MM, testSheetLayout, testSwatches } from './testSheet';
import { loadWorkspace } from '../model/load';
import { demoWorkspaceFs } from '../model/demo';

describe('test print sheet', () => {
  it('fits a poker card, a 100 mm ruler and three rows of swatches on A4 and Letter', () => {
    for (const [w, h] of [
      [210, 297],
      [215.9, 279.4],
    ] as const) {
      const L = testSheetLayout(w, 63, 88, 3);
      expect(L.ruler.length).toBe(100);
      expect(L.ruler.x + L.ruler.length).toBeLessThanOrEqual(w - L.margin);
      expect(L.card.w).toBe(69);
      const rows = 3;
      expect(L.swatches.y + rows * (SWATCH_MM + 9) + 30).toBeLessThan(h - L.margin);
      expect(L.swatches.x + L.swatches.perRow * (SWATCH_MM + L.swatches.gap) - L.swatches.gap).toBeLessThanOrEqual(w - L.margin);
    }
  });

  it('shortens the ruler on a narrow page instead of running off it', () => {
    const L = testSheetLayout(150, 63, 88, 3);
    expect(L.ruler.length).toBeLessThan(100);
    expect(L.ruler.x + L.ruler.length).toBeLessThanOrEqual(150 - L.margin);
  });

  it("lists the game's colours first, then process inks, rich black and greys", async () => {
    const ws = await loadWorkspace(demoWorkspaceFs());
    const s = testSwatches(ws.games[0]!);
    expect(s.slice(0, 3).map((x) => x.label)).toEqual(['Fire #d9442b', 'Water #2b7bd9', 'Earth #5f9b3a']);
    expect(s.find((x) => x.label === 'M 50%')?.cmyk).toEqual([0, 0.5, 0, 0]);
    expect(s.some((x) => x.label === 'Rich black')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(3 * testSheetLayout(210, 63, 88, 3).swatches.perRow);
  });
});
