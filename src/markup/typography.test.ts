import { describe, expect, it } from 'vitest';
import { smartPunctuation } from './typography';

describe('smartPunctuation', () => {
  it('curls double and single quotes', () => {
    expect(smartPunctuation('"Burn," she said.')).toBe('“Burn,” she said.');
    expect(smartPunctuation("Kai's 'best' card")).toBe('Kai’s ‘best’ card');
    expect(smartPunctuation('("quoted")')).toBe('(“quoted”)');
    expect(smartPunctuation("don't")).toBe('don’t');
  });

  it('makes dashes and ellipses', () => {
    expect(smartPunctuation('1--3')).toBe('1–3');
    expect(smartPunctuation('Wait --- what...')).toBe('Wait — what…');
    expect(smartPunctuation('-1 power')).toBe('-1 power');
  });

  it('leaves icon codes and literal brackets alone', () => {
    expect(smartPunctuation("Pay [it's] -- \"now\"")).toBe('Pay [it\'s] – “now”');
    expect(smartPunctuation('[[not an icon] "x"')).toBe('[[not an icon] “x”');
  });

  it('opens a quote after a line break', () => {
    expect(smartPunctuation('Line one.\n"Two"')).toBe('Line one.\n“Two”');
  });
});
