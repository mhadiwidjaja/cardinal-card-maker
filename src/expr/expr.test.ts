import { describe, expect, it } from 'vitest';
import { ExprError, interpolate, run, splitInterpolation, type Value } from './expr';

const card: Record<string, Value> = {
  name: 'Pyre Titan',
  cost: '6',
  attack: '7',
  rarity: 'Rare',
  element: 'Fire, Water',
  subtype: '',
  flavor: '',
  'set.code': 'CORE',
  'my-field': 'dash',
};
const r = (name: string) => card[name];
const ev = (src: string) => run(src, r);

describe('expressions', () => {
  it('does arithmetic with numeric text', () => {
    expect(ev('cost + 1')).toBe(7);
    expect(ev('cost * 2 - attack')).toBe(5);
    expect(ev('(cost + 2) / 4')).toBe(2);
    expect(ev('-cost + 10')).toBe(4);
    expect(ev('7 % 3')).toBe(1);
  });

  it('joins text with +', () => {
    expect(ev("'ATK ' + attack")).toBe('ATK 7');
    expect(ev("name + '!'")).toBe('Pyre Titan!');
  });

  it('compares numbers numerically and text ignoring case', () => {
    expect(ev('cost > 5')).toBe(true);
    expect(ev("'10' > '9'")).toBe(true);
    expect(ev("rarity == 'rare'")).toBe(true);
    expect(ev("rarity = 'Rare'")).toBe(true);
    expect(ev("rarity != 'Common'")).toBe(true);
  });

  it('has and/or/not with the expected precedence', () => {
    expect(ev("not rarity == 'Common'")).toBe(true);
    expect(ev("flavor != '' or cost >= 6")).toBe(true);
    expect(ev('not flavor and cost')).toBe(true);
    expect(ev('!subtype && true')).toBe(true);
    expect(ev("subtype or 'none'")).toBe('none');
  });

  it('has functions', () => {
    expect(ev("if(subtype != '', ' - ' + subtype, '')")).toBe('');
    expect(ev("if(cost > 5, 'big', 'small')")).toBe('big');
    expect(ev("contains(element, 'water')")).toBe(true);
    expect(ev("contains(element, 'Earth')")).toBe(false);
    expect(ev('count(element)')).toBe(2);
    expect(ev('item(element, 2)')).toBe('Water');
    expect(ev('upper(set.code)')).toBe('CORE');
    expect(ev("field('my-field')")).toBe('dash');
    expect(ev('pad(cost, 3)')).toBe('006');
    expect(ev('max(cost, attack, 3)')).toBe(7);
    expect(ev('has(flavor)')).toBe(false);
    expect(ev("number('x', 0) + 1")).toBe(1);
  });

  it('treats unknown names as empty', () => {
    expect(ev('nothing')).toBe('');
    expect(ev("nothing == ''")).toBe(true);
  });

  it('reports mistakes clearly', () => {
    expect(() => ev('cost +')).toThrow(ExprError);
    expect(() => ev("'open")).toThrow(/closing quote/);
    expect(() => ev('frob(1)')).toThrow(/Unknown function "frob"/);
    expect(() => ev('if(1)')).toThrow(/takes 2 to 3 arguments/);
    expect(() => ev("name * 2")).toThrow(/not a number/);
    expect(() => ev('cost / 0')).toThrow(/Division by zero/);
    expect(() => ev('(cost')).toThrow(/Expected "\)"/);
  });
});

describe('interpolate', () => {
  it('fills in {expressions}', () => {
    expect(interpolate('{attack} / {cost}', r)).toBe('7 / 6');
    expect(interpolate("Type{if(subtype != '', ' - ' + subtype, '')}", r)).toBe('Type');
    expect(interpolate('{{literal}}', r)).toBe('{literal}');
    expect(interpolate("{'}'}", r)).toBe('}');
  });

  it('splits text and expressions', () => {
    expect(splitInterpolation('ATK {attack}!')).toEqual(['ATK ', { expr: 'attack' }, '!']);
  });

  it('rejects an unclosed brace', () => {
    expect(() => interpolate('{cost', r)).toThrow(/no matching/);
  });
});
