import { describe, expect, it } from 'vitest';
import { formatFraming, framedField, isFramingColumn, parseFraming } from './framing';
import type { Field } from './types';

const fields = [
  { id: 'name', type: 'text' },
  { id: 'art', type: 'image' },
  { id: 'frameArt', type: 'image' },
] as Field[];

describe('framing cells', () => {
  it('reads zoom and focus, clamped to sensible limits', () => {
    expect(parseFraming('1.4 0.3 0.6')).toEqual({ zoom: 1.4, fx: 0.3, fy: 0.6 });
    expect(parseFraming('99 -1 2')).toEqual({ zoom: 10, fx: 0, fy: 1 });
    expect(parseFraming('1.5 0.5')).toBeNull();
    expect(parseFraming('1.5 x 0.5')).toBeNull();
    expect(parseFraming('')).toBeNull();
    expect(parseFraming(undefined)).toBeNull();
  });

  it('writes a short cell that reads back the same', () => {
    const text = formatFraming({ zoom: 1.23456, fx: 0.5, fy: 0.12345 });
    expect(text).toBe('1.235 0.5 0.123');
    expect(parseFraming(text)).toEqual({ zoom: 1.235, fx: 0.5, fy: 0.123 });
  });
});

describe('framedField', () => {
  it('finds the one image field a layer shows', () => {
    expect(framedField('art/{art}', fields)).toBe('art');
    expect(framedField("art/{if(art == '', 'blank.png', art)}", fields)).toBe('art');
    expect(framedField('frames/{lower(name)}.png', fields)).toBeNull();
    expect(framedField('{art}{frameArt}', fields)).toBeNull();
    expect(framedField('frames/unit.png', fields)).toBeNull();
  });

  it('knows framing columns', () => {
    expect(isFramingColumn('art.frame', fields)).toBe(true);
    expect(isFramingColumn('name.frame', fields)).toBe(false);
  });
});
