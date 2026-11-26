import { describe, expect, it } from 'vitest';
import { colourClashes, deltaE, parseHex, simulate } from './colourVision';
import { demoWorkspaceFs } from './demo';
import { loadWorkspace } from './load';
import type { Game } from './types';

describe('colour vision', () => {
  it('reads hex colours', () => {
    expect(parseHex('#fff')).toEqual([1, 1, 1]);
    expect(parseHex('#d9442b')![0]).toBeCloseTo(0.851, 3);
    expect(parseHex('red')).toBeNull();
  });

  it('red and green look alike without red or green cones, but not to normal eyes', () => {
    const red = parseHex('#cc3333')!;
    const green = parseHex('#4c9a2a')!;
    expect(deltaE(red, green)).toBeGreaterThan(50);
    expect(deltaE(simulate(red, 'deutan'), simulate(green, 'deutan'))).toBeLessThan(20);
    expect(simulate([0.5, 0.5, 0.5], 'deutan').every((v) => Math.abs(v - 0.5) < 0.01)).toBe(true);
  });

  it('finds the demo elements that clash, worst first', async () => {
    const game = (await loadWorkspace(demoWorkspaceFs())).games[0]!;
    const clashes = colourClashes(game);
    expect(clashes.length).toBeGreaterThan(0);
    expect(clashes.every((c) => c.field === 'element')).toBe(true);
    expect(clashes.some((c) => [c.a, c.b].includes('Fire') && [c.a, c.b].includes('Earth') && (c.vision === 'deutan' || c.vision === 'protan'))).toBe(true);
    expect(clashes[0]!.deltaE).toBeLessThanOrEqual(clashes[clashes.length - 1]!.deltaE);
    expect(colourClashes({ def: { fields: [{ id: 'x', type: 'choice', colors: { A: '#000000', B: '#ffffff' } }] } } as unknown as Game)).toEqual([]);
  });
});
