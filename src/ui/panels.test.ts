import { describe, expect, it } from 'vitest';
import { menuPosition } from './MenuButton';
import { clampWidth } from './ResizeHandle';

describe('menuPosition', () => {
  it('lines up the right edges when there is room', () => {
    expect(menuPosition({ left: 500, right: 600, bottom: 40 }, 240, 1200)).toEqual({ left: 360, top: 44 });
  });

  it('moves right instead of going off the left edge', () => {
    expect(menuPosition({ left: 20, right: 120, bottom: 40 }, 240, 1200).left).toBe(8);
  });

  it('stays inside a narrow window', () => {
    expect(menuPosition({ left: 280, right: 300, bottom: 40 }, 240, 300).left).toBe(52);
  });
});

describe('clampWidth', () => {
  const size = { initial: 300, min: 200, max: 600 };

  it('keeps the width inside the limits', () => {
    expect(clampWidth(100, size, 1600)).toBe(200);
    expect(clampWidth(900, size, 1600)).toBe(600);
    expect(clampWidth(412.6, size, 1600)).toBe(413);
  });

  it('leaves room for the main area in a small window', () => {
    expect(clampWidth(600, size, 800)).toBe(480);
    expect(clampWidth(600, size, 400)).toBe(200);
  });
});
