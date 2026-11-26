import { describe, expect, it } from 'vitest';
import { BOM, decodeCsvBytes, parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads a header row and data rows', () => {
    const t = parseCsv('name,cost\nEmber Scout,1\nRiptide,2\n');
    expect(t.columns).toEqual(['name', 'cost']);
    expect(t.rows).toEqual([
      { name: 'Ember Scout', cost: '1' },
      { name: 'Riptide', cost: '2' },
    ]);
    expect(t.errors).toEqual([]);
  });

  it('strips the BOM that Excel adds', () => {
    expect(parseCsv('﻿name\nA\n').columns).toEqual(['name']);
  });

  it('keeps commas and line breaks inside quoted cells', () => {
    const t = parseCsv('name,rules\nTitan,"Shield 2\nDeal 2, then draw."\n');
    expect(t.rows[0]!.rules).toBe('Shield 2\nDeal 2, then draw.');
  });

  it('handles Windows line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('reports rows with the wrong number of cells', () => {
    const t = parseCsv('a,b,c\n1,2\n');
    expect(t.errors).toEqual([{ row: 2, message: 'Has 2 cells but the header has 3 columns' }]);
    expect(t.rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('reports duplicate and empty column names', () => {
    const t = parseCsv('a,a,\n1,2,3\n');
    expect(t.errors.map((e) => e.message)).toEqual(['Duplicate column "a"', 'Column 3 has no name']);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a\n1\n\n2\n').rows).toHaveLength(2);
  });
});

describe('toCsv', () => {
  it('round-trips through parseCsv', () => {
    const rows = [{ name: 'Titan', rules: 'Shield 2\nSay "hi", then draw.' }];
    const text = toCsv(['name', 'rules'], rows);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(parseCsv(text).rows).toEqual(rows);
  });

  it('starts with a BOM so Excel reads it as UTF-8', () => {
    const text = toCsv(['name'], [{ name: 'Café' }]);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1, 5)).toBe('name');
    expect(parseCsv(text).columns).toEqual(['name']);
  });
});

describe('decodeCsvBytes', () => {
  it('reads UTF-8 (with or without a BOM)', () => {
    const bytes = new TextEncoder().encode(BOM + 'name\nCafé\n');
    expect(decodeCsvBytes(bytes)).toEqual({ text: 'name\nCafé\n', encoding: 'utf-8' });
  });

  it('falls back to windows-1252 for Excel "CSV" files', () => {
    // "Café" with é as the single byte 0xE9, as Excel saves it on Western Windows.
    const bytes = new Uint8Array([0x6e, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x0a]);
    expect(decodeCsvBytes(bytes)).toEqual({ text: 'n\nCafé\n', encoding: 'windows-1252' });
  });
});
