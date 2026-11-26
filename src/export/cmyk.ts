
export interface CmykConverter {
  name: string;
  /** Converts RGBA pixels (alpha composited over white paper) to CMYK bytes, 4 per pixel, 255 = full ink. */
  convert(rgba: Uint8ClampedArray | Uint8Array): Uint8Array;
  convertOne(r: number, g: number, b: number): [number, number, number, number];
  profile?: Uint8Array;
}

export interface SimpleOptions {
  /** How much of the shared grey is replaced by black ink: 0 (none) to 1 (all). Default 0.8. */
  blackGeneration?: number;
  /** Maximum total ink in percent (C+M+Y+K). Default 300. */
  inkLimit?: number;
  pureBlack?: boolean;
}

export interface IccOptions {
  /** 0 = perceptual (photos, default), 1 = relative colorimetric (exact in-gamut colours). */
  intent?: 0 | 1;
  pureBlack?: boolean;
}

export class IccError extends Error {}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function makeConvert(one: (r: number, g: number, b: number) => [number, number, number, number], pureBlack: boolean) {
  return (rgba: Uint8ClampedArray | Uint8Array): Uint8Array => {
    const n = rgba.length >> 2;
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = rgba[i * 4 + 3]! / 255;
      const r = Math.round(rgba[i * 4]! * a + 255 * (1 - a));
      const g = Math.round(rgba[i * 4 + 1]! * a + 255 * (1 - a));
      const b = Math.round(rgba[i * 4 + 2]! * a + 255 * (1 - a));
      const o = i * 4;
      // White is always bare paper (profiles may otherwise add faint dots of ink).
      if (r === 255 && g === 255 && b === 255) continue;
      if (pureBlack && r === g && g === b) {
        out[o + 3] = 255 - r;
        continue;
      }
      const [c, m, y, k] = one(r / 255, g / 255, b / 255);
      out[o] = Math.round(c * 255);
      out[o + 1] = Math.round(m * 255);
      out[o + 2] = Math.round(y * 255);
      out[o + 3] = Math.round(k * 255);
    }
    return out;
  };
}

export function simpleConverter(opts: SimpleOptions = {}): CmykConverter {
  const gcr = clamp01(opts.blackGeneration ?? 0.8);
  const limit = Math.max(100, Math.min(400, opts.inkLimit ?? 300)) / 100;
  const pureBlack = opts.pureBlack ?? true;
  const one = (r: number, g: number, b: number): [number, number, number, number] => {
    const c0 = 1 - r;
    const m0 = 1 - g;
    const y0 = 1 - b;
    const k = Math.min(c0, m0, y0) * gcr;
    let c = k >= 1 ? 0 : (c0 - k) / (1 - k);
    let m = k >= 1 ? 0 : (m0 - k) / (1 - k);
    let y = k >= 1 ? 0 : (y0 - k) / (1 - k);
    const cmy = c + m + y;
    if (cmy + k > limit && cmy > 0) {
      const f = Math.max(0, limit - k) / cmy;
      c *= f;
      m *= f;
      y *= f;
    }
    return [clamp01(c), clamp01(m), clamp01(y), clamp01(k)];
  };
  const convertOne = (r: number, g: number, b: number): [number, number, number, number] =>
    pureBlack && r === g && g === b ? [0, 0, 0, 1 - r] : one(r, g, b);
  return { name: `built-in conversion (ink limit ${Math.round(limit * 100)}%)`, convert: makeConvert(one, pureBlack), convertOne };
}

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const WHITE_D50 = [0.9642, 1, 0.8249] as const;

export function srgbToXyzD50(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  return [0.4360747 * R + 0.3850649 * G + 0.1430804 * B, 0.2225045 * R + 0.7168786 * G + 0.0606169 * B, 0.0139322 * R + 0.0971045 * G + 0.7141733 * B];
}

export function xyzToLab([x, y, z]: [number, number, number]): [number, number, number] {
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x / WHITE_D50[0]);
  const fy = f(y / WHITE_D50[1]);
  const fz = f(z / WHITE_D50[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

type Curve = (v: number) => number;

export interface Pipeline {
  inputs: number;
  outputs: number;
  labEncoding: 'legacy16' | 'v4';
  run(input: number[]): number[];
}

export interface IccProfile {
  colorSpace: string;
  pcs: 'Lab' | 'XYZ';
  description: string;
  bToA: (Pipeline | null)[];
  aToB: (Pipeline | null)[];
  bytes: Uint8Array;
}

class Reader {
  private v: DataView;
  constructor(readonly b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8 = (o: number) => this.v.getUint8(o);
  u16 = (o: number) => this.v.getUint16(o);
  u32 = (o: number) => this.v.getUint32(o);
  s15 = (o: number) => this.v.getInt32(o) / 65536;
  sig = (o: number) => String.fromCharCode(this.b[o]!, this.b[o + 1]!, this.b[o + 2]!, this.b[o + 3]!);
  check(o: number, len: number) {
    if (o < 0 || o + len > this.b.length) throw new IccError('The ICC profile is damaged (data runs past the end of the file).');
  }
}

function tableCurve(values: ArrayLike<number>, max: number): Curve {
  const n = values.length;
  if (n === 0) return (v) => v;
  if (n === 1) return (v) => v;
  return (v) => {
    const x = clamp01(v) * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    const t = x - i;
    return (values[i]! * (1 - t) + values[i + 1]! * t) / max;
  };
}

function readCurve(r: Reader, o: number): [Curve, number] {
  const type = r.sig(o);
  if (type === 'curv') {
    const n = r.u32(o + 8);
    r.check(o + 12, n * 2);
    const len = 12 + n * 2;
    if (n === 0) return [(v) => v, pad4(len)];
    if (n === 1) {
      const g = r.u16(o + 12) / 256;
      return [(v) => clamp01(v) ** g, pad4(len)];
    }
    const vals = new Uint16Array(n);
    for (let i = 0; i < n; i++) vals[i] = r.u16(o + 12 + i * 2);
    return [tableCurve(vals, 65535), pad4(len)];
  }
  if (type === 'para') {
    const fn = r.u16(o + 8);
    const count = [1, 3, 4, 5, 7][fn];
    if (count === undefined) throw new IccError(`Unsupported curve type in the ICC profile (para ${fn}).`);
    const p = Array.from({ length: count }, (_, i) => r.s15(o + 12 + i * 4));
    const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = p as number[];
    const curve: Curve = (x) => {
      switch (fn) {
        case 0:
          return clamp01(Math.max(0, x) ** g!);
        case 1:
          return clamp01(x >= -b / a ? Math.max(0, a * x + b) ** g! : 0);
        case 2:
          return clamp01(x >= -b / a ? Math.max(0, a * x + b) ** g! + c : c);
        case 3:
          return clamp01(x >= d ? Math.max(0, a * x + b) ** g! : c * x);
        default:
          return clamp01(x >= d ? Math.max(0, a * x + b) ** g! + e : c * x + f);
      }
    };
    return [curve, pad4(12 + count * 4)];
  }
  throw new IccError(`Unsupported curve type "${type}" in the ICC profile.`);
}

const pad4 = (n: number) => (n + 3) & ~3;

function clutLookup(grid: number[], data: ArrayLike<number>, max: number, outputs: number, input: number[]): number[] {
  const nIn = input.length;
  const base: number[] = [];
  const frac: number[] = [];
  for (let i = 0; i < nIn; i++) {
    const x = clamp01(input[i]!) * (grid[i]! - 1);
    const b = Math.min(grid[i]! - 2, Math.floor(x));
    base.push(Math.max(0, b));
    frac.push(grid[i]! > 1 ? x - Math.max(0, b) : 0);
  }
  const stride: number[] = new Array(nIn);
  let s = outputs;
  for (let i = nIn - 1; i >= 0; i--) {
    stride[i] = s;
    s *= grid[i]!;
  }
  const out = new Array(outputs).fill(0);
  for (let corner = 0; corner < 1 << nIn; corner++) {
    let w = 1;
    let idx = 0;
    for (let i = 0; i < nIn; i++) {
      const bit = (corner >> (nIn - 1 - i)) & 1;
      if (grid[i]! === 1 && bit) {
        w = 0;
        break;
      }
      w *= bit ? frac[i]! : 1 - frac[i]!;
      idx += (base[i]! + bit) * stride[i]!;
    }
    if (w === 0) continue;
    for (let o = 0; o < outputs; o++) out[o] += w * data[idx + o]!;
  }
  return out.map((v) => v / max);
}

function readLut(r: Reader, o: number): Pipeline {
  const type = r.sig(o);
  if (type === 'mft2' || type === 'mft1') {
    const wide = type === 'mft2';
    const nIn = r.u8(o + 8);
    const nOut = r.u8(o + 9);
    const g = r.u8(o + 10);
    const matrix = Array.from({ length: 9 }, (_, i) => r.s15(o + 12 + i * 4));
    const inN = wide ? r.u16(o + 48) : 256;
    const outN = wide ? r.u16(o + 50) : 256;
    const size = wide ? 2 : 1;
    const max = wide ? 65535 : 255;
    let p = o + (wide ? 52 : 48);
    const read = (count: number) => {
      r.check(p, count * size);
      const a = wide ? new Uint16Array(count) : new Uint8Array(count);
      for (let i = 0; i < count; i++) a[i] = wide ? r.u16(p + i * 2) : r.u8(p + i);
      p += count * size;
      return a;
    };
    const inCurves = Array.from({ length: nIn }, () => tableCurve(read(inN), max));
    const clut = read(g ** nIn * nOut);
    const outCurves = Array.from({ length: nOut }, () => tableCurve(read(outN), max));
    const grid = new Array(nIn).fill(g);
    const identity = matrix.every((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) < 1e-6);
    return {
      inputs: nIn,
      outputs: nOut,
      labEncoding: wide ? 'legacy16' : 'v4',
      run(input) {
        let v = input;
        // The matrix only applies to XYZ input; Lab profiles carry the identity.
        if (!identity && nIn === 3) v = [0, 1, 2].map((i) => clamp01(matrix[i * 3]! * v[0]! + matrix[i * 3 + 1]! * v[1]! + matrix[i * 3 + 2]! * v[2]!));
        v = v.map((x, i) => inCurves[i]!(x));
        v = clutLookup(grid, clut, max, nOut, v);
        return v.map((x, i) => outCurves[i]!(x));
      },
    };
  }
  if (type === 'mBA ' || type === 'mAB ') {
    const bToA = type === 'mBA ';
    const nIn = r.u8(o + 8);
    const nOut = r.u8(o + 9);
    const [offB, offMat, offM, offClut, offA] = [12, 16, 20, 24, 28].map((k) => r.u32(o + k)) as [number, number, number, number, number];
    const curves = (off: number, n: number): Curve[] | null => {
      if (!off) return null;
      const list: Curve[] = [];
      let p = o + off;
      for (let i = 0; i < n; i++) {
        const [c, len] = readCurve(r, p);
        list.push(c);
        p += len;
      }
      return list;
    };
    const B = curves(offB, bToA ? nIn : nOut);
    const M = curves(offM, bToA ? nIn : nOut);
    const A = curves(offA, bToA ? nOut : nIn);
    const mat = offMat ? Array.from({ length: 12 }, (_, i) => r.s15(o + offMat + i * 4)) : null;
    let clut: ((v: number[]) => number[]) | null = null;
    if (offClut) {
      const c = o + offClut;
      const gIn = bToA ? nIn : nIn;
      const grid = Array.from({ length: gIn }, (_, i) => r.u8(c + i));
      const prec = r.u8(c + 16);
      const count = grid.reduce((a, b) => a * b, 1) * nOut;
      r.check(c + 20, count * prec);
      const data = prec === 2 ? new Uint16Array(count) : new Uint8Array(count);
      for (let i = 0; i < count; i++) data[i] = prec === 2 ? r.u16(c + 20 + i * 2) : r.u8(c + 20 + i);
      clut = (v) => clutLookup(grid, data, prec === 2 ? 65535 : 255, nOut, v);
    }
    const applyMat = (v: number[]) => (mat ? [0, 1, 2].map((i) => clamp01(mat[i * 3]! * v[0]! + mat[i * 3 + 1]! * v[1]! + mat[i * 3 + 2]! * v[2]! + mat[9 + i]!)) : v);
    const each = (cs: Curve[] | null, v: number[]) => (cs ? v.map((x, i) => cs[i]!(x)) : v);
    return {
      inputs: nIn,
      outputs: nOut,
      labEncoding: 'v4',
      run(input) {
        if (bToA) {
          let v = each(B, input);
          v = applyMat(v);
          v = each(M, v);
          if (clut) v = clut(v);
          return each(A, v);
        }
        let v = each(A, input);
        if (clut) v = clut(v);
        v = each(M, v);
        v = applyMat(v);
        return each(B, v);
      },
    };
  }
  throw new IccError(`This ICC profile uses a table type Cardinal can't read yet ("${type.trim()}").`);
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f�]/g, '').replace(/\s+/g, ' ').trim();

function readDescription(r: Reader, o: number): string {
  try {
    const type = r.sig(o);
    if (type === 'desc') {
      const n = r.u32(o + 8);
      return clean(new TextDecoder('latin1').decode(r.b.subarray(o + 12, o + 12 + Math.max(0, n - 1))));
    }
    if (type === 'mluc') {
      const len = r.u32(o + 20);
      const off = r.u32(o + 24);
      const bytes = r.b.subarray(o + off, o + off + len);
      let s = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
      return clean(s);
    }
  } catch {
    // fall through
  }
  return '';
}

export function parseIcc(bytes: Uint8Array): IccProfile {
  if (bytes.length < 132) throw new IccError('This file is too small to be an ICC profile.');
  const r = new Reader(bytes);
  if (r.sig(36) !== 'acsp') throw new IccError('This file is not an ICC colour profile (.icc / .icm).');
  const colorSpace = r.sig(16).trim();
  const pcsSig = r.sig(20).trim();
  if (pcsSig !== 'Lab' && pcsSig !== 'XYZ') throw new IccError(`Unsupported profile connection space "${pcsSig}".`);
  const tags = new Map<string, number>();
  const n = r.u32(128);
  for (let i = 0; i < n; i++) {
    const at = 132 + i * 12;
    r.check(at, 12);
    tags.set(r.sig(at), r.u32(at + 4));
  }
  const lut = (sig: string) => {
    const off = tags.get(sig);
    return off === undefined ? null : readLut(r, off);
  };
  const desc = tags.has('desc') ? readDescription(r, tags.get('desc')!) : '';
  return {
    colorSpace,
    pcs: pcsSig as 'Lab' | 'XYZ',
    description: desc,
    bToA: [lut('B2A0'), lut('B2A1'), lut('B2A2')],
    aToB: [lut('A2B0'), lut('A2B1'), lut('A2B2')],
    bytes,
  };
}

function encodePcs(p: IccProfile, pipe: Pipeline, lab: [number, number, number], xyz: [number, number, number]): number[] {
  if (p.pcs === 'XYZ') return xyz.map((v) => clamp01((v * 32768) / 65535));
  const [L, a, b] = lab;
  if (pipe.labEncoding === 'legacy16') return [clamp01((L * 652.8) / 65535), clamp01(((a + 128) * 256) / 65535), clamp01(((b + 128) * 256) / 65535)];
  return [clamp01(L / 100), clamp01((a + 128) / 255), clamp01((b + 128) / 255)];
}

export function decodeLab(pipe: Pipeline, v: number[]): [number, number, number] {
  if (pipe.labEncoding === 'legacy16') return [(v[0]! * 65535) / 652.8, (v[1]! * 65535) / 256 - 128, (v[2]! * 65535) / 256 - 128];
  return [v[0]! * 100, v[1]! * 255 - 128, v[2]! * 255 - 128];
}

function pickBToA(p: IccProfile, intent: number): Pipeline {
  const pipe = p.bToA[intent] ?? p.bToA[0] ?? p.bToA[1] ?? p.bToA[2];
  if (!pipe) throw new IccError('This profile can’t convert colours into CMYK (it has no B2A table). Ask the print shop for their CMYK output profile.');
  return pipe;
}

const GRID = 33;

/**
 * How much a colour changes in colourfulness and hue (CIE94 weighting, lightness
 * left out). Every press prints the darkest screen colours a little lighter, which
 * is expected; what reads as "duller" is lost colourfulness or a hue shift. The
 * CIE94 weights make the same shift count less in very colourful colours, where
 * the eye notices it less.
 */
export function colourShift(lab: [number, number, number], lab2: [number, number, number]): number {
  const c1 = Math.hypot(lab[1], lab[2]);
  const c2 = Math.hypot(lab2[1], lab2[2]);
  const dC = c1 - c2;
  const dH2 = Math.max(0, (lab[1] - lab2[1]) ** 2 + (lab[2] - lab2[2]) ** 2 - dC * dC);
  return Math.sqrt((dC / (1 + 0.045 * c1)) ** 2 + dH2 / (1 + 0.015 * c1) ** 2);
}

/**
 * For the print check: how much each sRGB colour changes (colourShift) when it goes
 * through the print profile to CMYK and back, with relative colorimetric
 * intent. Colours inside the press's range move only a little (the profile's
 * own tables are off by 2–6 ΔE); colours the press can't reach move a lot.
 * Sampled on a 17³ grid once and interpolated, like the converter.
 */
export function iccGamutDelta(bytes: Uint8Array): (r: number, g: number, b: number) => number {
  const p = parseIcc(bytes);
  if (p.colorSpace !== 'CMYK') throw new IccError(`This is a ${p.colorSpace} profile, not a CMYK print profile.`);
  const toCmyk = pickBToA(p, 1);
  const back = p.aToB[1] ?? p.aToB[0] ?? p.aToB[2];
  if (!back) throw new IccError('This profile can’t convert CMYK back to colours (it has no A2B table), so the colour check can’t use it.');
  const n = 17;
  const table = new Float32Array(n * n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        const xyz = srgbToXyzD50(i / (n - 1), j / (n - 1), k / (n - 1));
        const lab = xyzToLab(xyz);
        const cmyk = toCmyk.run(encodePcs(p, toCmyk, lab, xyz)).map(clamp01);
        const out = back.run(cmyk);
        const lab2 = p.pcs === 'XYZ' ? xyzToLab([out[0]! * (65535 / 32768), out[1]! * (65535 / 32768), out[2]! * (65535 / 32768)]) : decodeLab(back, out);
        // The profile's tables are least exact in the darkest colours (even a dark grey moves by ~6),
        // so very dark colours get a little more room before they count as a problem.
        table[(i * n + j) * n + k] = colourShift(lab, lab2) - Math.max(0, 30 - lab[0]) * 0.3;
      }
  const grid = [n, n, n];
  return (r, g, b) => clutLookup(grid, table, 1, 1, [r, g, b])[0]!;
}

export function iccConverter(bytes: Uint8Array, opts: IccOptions = {}): CmykConverter {
  const p = parseIcc(bytes);
  if (p.colorSpace !== 'CMYK') throw new IccError(`This is a ${p.colorSpace} profile. A CMYK print profile is needed (e.g. FOGRA39, GRACoL, SWOP).`);
  const pipe = pickBToA(p, opts.intent ?? 0);
  if (pipe.inputs !== 3 || pipe.outputs !== 4) throw new IccError('Unexpected table shape in the ICC profile.');
  const exact = (r: number, g: number, b: number): [number, number, number, number] => {
    const xyz = srgbToXyzD50(r, g, b);
    const out = pipe.run(encodePcs(p, pipe, xyzToLab(xyz), xyz));
    return [clamp01(out[0]!), clamp01(out[1]!), clamp01(out[2]!), clamp01(out[3]!)];
  };
  // Converting every pixel through the profile is slow, so sample a 33×33×33
  // RGB grid once and interpolate between its points.
  const table = new Float32Array(GRID * GRID * GRID * 4);
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++)
      for (let k = 0; k < GRID; k++) {
        const v = exact(i / (GRID - 1), j / (GRID - 1), k / (GRID - 1));
        table.set(v, ((i * GRID + j) * GRID + k) * 4);
      }
  const grid = [GRID, GRID, GRID];
  const fast = (r: number, g: number, b: number) => clutLookup(grid, table, 1, 4, [r, g, b]) as [number, number, number, number];
  const pureBlack = opts.pureBlack ?? true;
  return {
    name: p.description || 'ICC profile',
    convert: makeConvert(fast, pureBlack),
    convertOne: (r, g, b) => (r >= 1 && g >= 1 && b >= 1 ? [0, 0, 0, 0] : pureBlack && r === g && g === b ? [0, 0, 0, 1 - r] : fast(r, g, b)),
    profile: bytes,
  };
}
