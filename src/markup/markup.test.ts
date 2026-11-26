import { describe, expect, it } from 'vitest';
import { addReminders, compileKeywords } from './keywords';
import { iconLookup, parseMarkup } from './markup';

const icons = iconLookup(['fire', 'water', 'shield'], { f: 'fire', w: 'water' });
const plain = { bold: false, italic: false };

describe('parseMarkup', () => {
  it('turns [name] into icons, ignoring case and using aliases', () => {
    expect(parseMarkup('Pay [Fire] or [w].', icons)).toEqual([
      { kind: 'text', text: 'Pay ', style: plain },
      { kind: 'icon', name: 'fire', style: plain },
      { kind: 'text', text: ' or ', style: plain },
      { kind: 'icon', name: 'water', style: plain },
      { kind: 'text', text: '.', style: plain },
    ]);
  });

  it('keeps unknown icons visible', () => {
    const t = parseMarkup('a [firre] b', icons);
    expect(t[1]).toEqual({ kind: 'unknown', text: '[firre]', style: plain });
  });

  it('[[ gives a literal bracket', () => {
    expect(parseMarkup('[[Not an icon]', icons)).toEqual([{ kind: 'text', text: '[Not an icon]', style: plain }]);
  });

  it('leaves an unclosed [ alone', () => {
    expect(parseMarkup('a [ b', icons)).toEqual([{ kind: 'text', text: 'a [ b', style: plain }]);
  });

  it('handles bold and italic', () => {
    expect(parseMarkup('get *+1 attack* and _Shield 1_.', icons)).toEqual([
      { kind: 'text', text: 'get ', style: plain },
      { kind: 'text', text: '+1 attack', style: { bold: true, italic: false } },
      { kind: 'text', text: ' and ', style: plain },
      { kind: 'text', text: 'Shield 1', style: { bold: false, italic: true } },
      { kind: 'text', text: '.', style: plain },
    ]);
  });

  it('nests styles and styles icons', () => {
    const t = parseMarkup('*bold _both [f]_*', icons);
    expect(t[1]).toEqual({ kind: 'text', text: 'both ', style: { bold: true, italic: true } });
    expect(t[2]).toEqual({ kind: 'icon', name: 'fire', style: { bold: true, italic: true } });
  });

  it('keeps a lone * or _ literal', () => {
    expect(parseMarkup('2 * 3 and snake_case', icons)).toEqual([{ kind: 'text', text: '2 * 3 and snake_case', style: plain }]);
  });

  it('supports escapes', () => {
    expect(parseMarkup('\\*not bold\\* \\[f]', icons)).toEqual([{ kind: 'text', text: '*not bold* [f]', style: plain }]);
  });

  it('turns line breaks (real or \\n) into break tokens and resets styles', () => {
    const t = parseMarkup('a\nb\\nc', icons);
    expect(t.map((x) => x.kind)).toEqual(['text', 'break', 'text', 'break', 'text']);
  });
});

describe('keywords', () => {
  const kws = compileKeywords([
    { name: 'Shield', match: 'Shield {n:number}', reminder: '(Prevent the next {n} damage.)', auto: 'firstUse' },
    { name: 'Swift', match: 'Swift', reminder: '(Attack at once.)' },
    { name: 'Quiet', match: 'Quiet', reminder: '(Shh.)', auto: 'never' },
  ]);

  it('adds reminder text on keyword lines', () => {
    expect(addReminders('Shield 2\nDraw a card.', kws)).toBe('Shield 2 _(Prevent the next 2 damage.)_\nDraw a card.');
  });

  it('handles several keywords on one line', () => {
    expect(addReminders('Swift, Shield 1', kws)).toBe('Swift, Shield 1 _(Attack at once.) (Prevent the next 1 damage.)_');
  });

  it('ignores keywords in the middle of a sentence', () => {
    expect(addReminders('Swift units you control get +1.', kws)).toBe('Swift units you control get +1.');
  });

  it('matches case-insensitively and respects firstUse / never', () => {
    expect(addReminders('shield 1\nShield 2\nQuiet', kws)).toBe('shield 1 _(Prevent the next 1 damage.)_\nShield 2\nQuiet');
  });

  it('can be forced on or off', () => {
    expect(addReminders('Quiet', kws, 'all')).toBe('Quiet _(Shh.)_');
    expect(addReminders('Swift', kws, 'none')).toBe('Swift');
  });

  it('escapes markup characters in reminders', () => {
    const k = compileKeywords([{ name: 'A', match: 'A', reminder: '(*star*)' }]);
    expect(addReminders('A', k)).toBe('A _(\\*star\\*)_');
  });
});
