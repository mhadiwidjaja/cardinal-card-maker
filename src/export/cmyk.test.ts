import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeLab, iccConverter, IccError, parseIcc, simpleConverter, srgbToXyzD50, xyzToLab } from './cmyk';

const near = (a: number[], b: number[], tol = 0.01) => a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(tol));

describe('simple CMYK conversion', () => {
  const conv = simpleConverter();

  it('keeps white as paper and black/greys on the black plate', () => {
    near(conv.convertOne(1, 1, 1), [0, 0, 0, 0]);
    near(conv.convertOne(0, 0, 0), [0, 0, 0, 1]);
    near(conv.convertOne(0.5, 0.5, 0.5), [0, 0, 0, 0.5]);
  });

  it('converts primaries', () => {
    near(conv.convertOne(1, 0, 0), [0, 1, 1, 0]);
    near(conv.convertOne(0, 0, 1), [1, 1, 0, 0]);
  });

  it('respects the ink limit', () => {
    const c = simpleConverter({ inkLimit: 260, pureBlack: false, blackGeneration: 0.3 }).convertOne(0.05, 0.02, 0.1);
    expect(c.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2.6 + 1e-6);
  });

  it('converts pixels, compositing transparency over white', () => {
    const out = conv.convert(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]));
    expect([...out]).toEqual([0, 0, 0, 255, 0, 0, 0, 0, 0, 255, 255, 0]);
  });
});

describe('colour maths', () => {
  it('sRGB white is Lab 100/0/0 and black is 0', () => {
    near(xyzToLab(srgbToXyzD50(1, 1, 1)), [100, 0, 0], 0.05);
    near(xyzToLab(srgbToXyzD50(0, 0, 0)), [0, 0, 0], 0.05);
  });
});

function u32(n: number) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const curvIdentity = () => [...ascii('curv'), 0, 0, 0, 0, ...u32(0)];

function makeV4Profile(): Uint8Array {
  const header = 32;
  const bCurves = [...curvIdentity(), ...curvIdentity(), ...curvIdentity()];
  const grid = [2, 2, 2, ...new Array(13).fill(0)];
  const data: number[] = [];
  for (let L = 0; L < 2; L++)
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++) {
        const k = Math.round((1 - L) * 65535);
        data.push(0, 0, 0, 0, 0, 0, k >> 8, k & 255);
      }
  const clut = [...grid, 2, 0, 0, 0, ...data];
  const aCurves = [...curvIdentity(), ...curvIdentity(), ...curvIdentity(), ...curvIdentity()];
  const offB = header;
  const offClut = offB + bCurves.length;
  const offA = offClut + clut.length;
  const mba = [...ascii('mBA '), 0, 0, 0, 0, 3, 4, 0, 0, ...u32(offB), ...u32(0), ...u32(0), ...u32(offClut), ...u32(offA), ...bCurves, ...clut, ...aCurves];
  const tagStart = 128 + 4 + 12;
  const total = tagStart + mba.length;
  const head = new Array(128).fill(0);
  head.splice(0, 4, ...u32(total));
  head.splice(8, 4, 4, 0x30, 0, 0);
  head.splice(12, 4, ...ascii('prtr'));
  head.splice(16, 4, ...ascii('CMYK'));
  head.splice(20, 4, ...ascii('Lab '));
  head.splice(36, 4, ...ascii('acsp'));
  return new Uint8Array([...head, ...u32(1), ...ascii('B2A0'), ...u32(tagStart), ...u32(mba.length), ...mba]);
}

describe('ICC profiles', () => {
  it('reads a v4 (mBA) profile and converts through it', () => {
    const conv = iccConverter(makeV4Profile(), { pureBlack: false });
    near(conv.convertOne(1, 1, 1), [0, 0, 0, 0], 0.02);
    near(conv.convertOne(0, 0, 0), [0, 0, 0, 1], 0.02);
    const L = xyzToLab(srgbToXyzD50(0.5, 0.5, 0.5))[0];
    near(conv.convertOne(0.5, 0.5, 0.5), [0, 0, 0, 1 - L / 100], 0.02);
    expect(conv.profile).toBeDefined();
  });

  it('explains files that are not CMYK profiles', () => {
    expect(() => iccConverter(new Uint8Array(200))).toThrow(IccError);
    const p = makeV4Profile();
    p.set(ascii('RGB '), 16);
    expect(() => iccConverter(p)).toThrow(/RGB profile/);
  });

  // Windows ships a real CMYK profile (US Web Coated SWOP, ICC v2, mft2 tables).
  const RSWOP = 'C:/Windows/System32/spool/drivers/color/RSWOP.icm';
  it.skipIf(!existsSync(RSWOP))('round-trips colours through the Windows SWOP profile', () => {
    const bytes = new Uint8Array(readFileSync(RSWOP));
    const profile = parseIcc(bytes);
    expect(profile.colorSpace).toBe('CMYK');
    const conv = iccConverter(bytes, { intent: 1, pureBlack: false });
    const back = profile.aToB[1]!;
    // (The profile's own two tables are not exact inverses: its Lab → CMYK → Lab
    // round trip alone is off by 2–6 ΔE, so the limit is 7, not 1.)
    for (const rgb of [
      [0.8, 0.6, 0.5],
      [0.3, 0.5, 0.3],
      [0.5, 0.5, 0.7],
      [0.9, 0.9, 0.85],
      [0.4, 0.4, 0.4],
    ] as [number, number, number][]) {
      const lab = xyzToLab(srgbToXyzD50(...rgb));
      const cmyk = conv.convertOne(...rgb);
      const lab2 = decodeLab(back, back.run(cmyk));
      const dE = Math.hypot(lab[0] - lab2[0], lab[1] - lab2[1], lab[2] - lab2[2]);
      expect(dE, `ΔE for ${rgb} → ${cmyk.map((v) => v.toFixed(2))}`).toBeLessThan(7);
    }
    const cyan = decodeLab(back, back.run([1, 0, 0, 0]));
    expect(cyan[1]).toBeLessThan(-30);
    expect(cyan[2]).toBeLessThan(-35);
    near(conv.convertOne(1, 1, 1), [0, 0, 0, 0], 0.02);
    expect(conv.convertOne(0, 0, 0).reduce((a, b) => a + b, 0)).toBeLessThan(3.1);
  });
});
