import { describe, expect, it } from 'vitest';
import { iconLookup, parseMarkup } from '../markup/markup';
import { cssFont, layoutText, scanline, type LayoutOptions, type Measurer, type Placed } from './textLayout';

const mono: Measurer = {
  width(text, font) {
    const size = Number(/([\d.]+)px/.exec(font)![1]);
    return [...text].length * size * 0.5;
  },
};
const icons = iconLookup(['fire']);
const tokens = (s: string) => parseMarkup(s, icons);
const base = (o: Partial<LayoutOptions> = {}): LayoutOptions => ({
  region: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
  font: { family: 'serif', size: 10 },
  lineHeight: 1,
  ...o,
});
function lines(items: Placed[]): string[] {
  const byY = new Map<number, Placed[]>();
  for (const it of items) {
    const key = Math.round(it.kind === 'text' ? it.y : it.y + it.h / 2 + 3.5);
    byY.set(key, [...(byY.get(key) ?? []), it]);
  }
  return [...byY.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, its]) =>
      its
        .sort((a, b) => a.x - b.x)
        .map((i) => (i.kind === 'text' ? i.text : `[${i.name}]`))
        .join('|'),
    );
}

describe('cssFont', () => {
  it('builds CSS font strings with bold/italic', () => {
    const f = { family: 'My Font, serif', size: 20, weight: 400 };
    expect(cssFont(f, { bold: false, italic: false })).toBe('400 20px "My Font", serif');
    expect(cssFont(f, { bold: true, italic: true })).toBe('italic 700 20px "My Font", serif');
    expect(cssFont({ ...f, style: 'italic' }, { bold: false, italic: true })).toBe('400 20px "My Font", serif');
  });
});

describe('layoutText in a rectangle', () => {
  it('wraps words to the width (20 chars of 5px per 100px line)', () => {
    const r = layoutText(tokens('aaaa bbbb cccc dddd eeee ffff'), base(), mono);
    // "aaaa bbbb cccc dddd" is 19 chars = 95px; adding " eeee" would be 120px.
    expect(r.lineCount).toBe(2);
    expect(r.overflow).toBe(false);
    expect(r.fontSize).toBe(10);
  });

  it('keeps hard line breaks and empty lines', () => {
    const r = layoutText(tokens('a\n\nb'), base(), mono);
    expect(r.lineCount).toBe(3);
  });

  it('aligns centre and right', () => {
    const c = layoutText(tokens('ab'), base({ align: 'center' }), mono);
    expect(c.items[0]!.x).toBe(45);
    const r = layoutText(tokens('ab'), base({ align: 'right' }), mono);
    expect(r.items[0]!.x).toBe(90);
  });

  it('justifies all but the last line of a paragraph', () => {
    const r = layoutText(tokens('aaa bbb ccc ddd eee fff ggg'), base({ align: 'justify' }), mono);
    const firstLine = r.items.filter((i) => i.y === r.items[0]!.y);
    const last = firstLine[firstLine.length - 1]!;
    expect(last.x + 15).toBeCloseTo(100);
  });

  it('centres vertically', () => {
    const r = layoutText(tokens('a'), base({ valign: 'middle' }), mono);
    // One 10px line in a 100px box: line top at 45, baseline at 45 + 5 + 3.5.
    expect(r.items[0]!.y).toBeCloseTo(53.5);
    const b = layoutText(tokens('a'), base({ valign: 'bottom' }), mono);
    expect(b.items[0]!.y).toBeCloseTo(98.5);
  });

  it('shrinks the font until the text fits', () => {
    const text = 'word '.repeat(60);
    const fixed = layoutText(tokens(text), base(), mono);
    expect(fixed.overflow).toBe(true);
    const shrunk = layoutText(tokens(text), base({ shrink: { min: 4 } }), mono);
    expect(shrunk.overflow).toBe(false);
    expect(shrunk.fontSize).toBeLessThan(10);
    expect(shrunk.fontSize).toBeGreaterThanOrEqual(4);
  });

  it('prefers shrinking over splitting a long word', () => {
    const r = layoutText(tokens('abcdefghijklmnopqrstuvwxy'), base({ shrink: { min: 5 } }), mono);
    expect(r.lineCount).toBe(1);
    expect(r.fontSize).toBeLessThanOrEqual(8);
  });

  it('splits a word that cannot fit even at the minimum size', () => {
    const r = layoutText(tokens('x'.repeat(30)), base(), mono);
    expect(lines(r.items)).toEqual(['x'.repeat(20), 'x'.repeat(10)]);
  });

  it('reports overflow but still places all text', () => {
    const r = layoutText(tokens('a\nb\nc'), base({ region: { kind: 'rect', x: 0, y: 0, w: 100, h: 25 } }), mono);
    expect(r.overflow).toBe(true);
    expect(r.items.map((i) => (i.kind === 'text' ? i.text : ''))).toEqual(['a', 'b', 'c']);
  });

  it('places icons inline, sized to the font', () => {
    const r = layoutText(tokens('Pay [fire] now'), base(), mono);
    const icon = r.items.find((i) => i.kind === 'icon')!;
    expect(icon).toMatchObject({ kind: 'icon', name: 'fire', w: 10, h: 10 });
    expect(lines(r.items)).toEqual(['Pay|[fire]|now']);
  });

  it('keeps an icon attached to following punctuation', () => {
    const r = layoutText(tokens('aaaaaaaaaaaaaaaaaa [fire]:'), base(), mono);
    expect(lines(r.items)).toEqual(['aaaaaaaaaaaaaaaaaa', '[fire]|:']);
  });

  it('keeps a number with the icon after it ("2 [fire]")', () => {
    // 16 a's = 80px; " 2 [fire]" would need 26.2px more, so "2 [fire]" moves down together.
    const r = layoutText(tokens('aaaaaaaaaaaaaaaa 2 [fire]'), base(), mono);
    expect(lines(r.items)).toEqual(['aaaaaaaaaaaaaaaa', '2| |[fire]']);
    for (const n of ['-1', '+0.5', '3x', '2×']) {
      expect(lines(layoutText(tokens(`aaaaaaaaaaaaaaa ${n} [fire]`), base(), mono).items)).toHaveLength(2);
    }
  });

  it('only glues number then icon, not a word or the other direction', () => {
    expect(lines(layoutText(tokens('aaaaaaaaaaaaaaaa two [fire]'), base(), mono).items)).toEqual(['aaaaaaaaaaaaaaaa|two', '[fire]']);
    expect(lines(layoutText(tokens('aaaaaaaaaaaaaaaa [fire] 2'), base(), mono).items)).toEqual(['aaaaaaaaaaaaaaaa|[fire]', '2']);
  });

  it('does not stretch the glued space when justifying', () => {
    const r = layoutText(tokens('aaaa bbbb 2 [fire] cccccccccccccccccc'), base({ align: 'justify' }), mono);
    const first = r.items.filter((i) => (i.kind === 'text' ? i.y : i.y + i.h / 2 + 3.5) === 8.5);
    const two = first.find((i) => i.kind === 'text' && i.text === '2')!;
    const icon = first.find((i) => i.kind === 'icon')!;
    expect(icon.x - two.x).toBeCloseTo(5 + 5 + 0.6);
    expect(icon.x + icon.w + 0.6).toBeCloseTo(100);
  });

  it('splits the glued word like any long word when the line is too narrow', () => {
    const r = layoutText(tokens('2 [fire]'), base({ region: { kind: 'rect', x: 0, y: 0, w: 15, h: 100 } }), mono);
    expect(r.overflow).toBe(false);
    expect(lines(r.items)).toEqual(['2| ', '[fire]']);
  });

  it('marks unknown icons', () => {
    const r = layoutText(tokens('[nope]'), base(), mono);
    expect(r.items[0]).toMatchObject({ kind: 'text', text: '[nope]', unknown: true });
  });

  it('handles empty text', () => {
    const r = layoutText([], base(), mono);
    expect(r).toMatchObject({ items: [], overflow: false, lineCount: 0 });
  });
});

describe('layoutText in a polygon', () => {
  it('scanline finds the inside of a triangle', () => {
    const tri: [number, number][] = [[0, 0], [100, 100], [0, 100]];
    expect(scanline(tri, 50)).toEqual([[0, 50]]);
  });

  it('gives each line the width available at its height', () => {
    const region = { kind: 'polygon' as const, points: [[0, 0], [100, 100], [0, 100]] as [number, number][] };
    const r = layoutText(tokens('a b c d e f g h i j k l m n o p q r s t u v'), base({ region }), mono);
    const ls = lines(r.items);
    expect(ls.length).toBeGreaterThan(2);
    const lens = ls.map((l) => l.length);
    for (let i = 1; i < lens.length - 1; i++) expect(lens[i]!).toBeGreaterThanOrEqual(lens[i - 1]!);
    for (const it of r.items) {
      if (it.kind !== 'text') continue;
      const lineTop = it.y - 5 - 3.5;
      expect(it.x + mono.width(it.text, it.font)).toBeLessThanOrEqual(lineTop + 0.01);
    }
  });

  it('skips a too-narrow tip at the top', () => {
    const region = { kind: 'polygon' as const, points: [[50, 0], [100, 100], [0, 100]] as [number, number][] };
    const r = layoutText(tokens('hello'), base({ region }), mono);
    expect(r.overflow).toBe(false);
    expect(r.items[0]!.y).toBeGreaterThan(8.5);
  });

  it('shrinks text to fit a shape', () => {
    const region = { kind: 'polygon' as const, points: [[0, 0], [100, 0], [50, 60]] as [number, number][] };
    const r = layoutText(tokens('word '.repeat(30)), base({ region, shrink: { min: 3 } }), mono);
    expect(r.overflow).toBe(false);
    expect(r.fontSize).toBeLessThan(10);
  });
});
