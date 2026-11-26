import { describe, expect, it } from 'vitest';
import { keys } from './keys';

describe('shortcut labels', () => {
  it('keeps Windows labels', () => {
    expect(keys('Undo (Ctrl+Z)', false)).toBe('Undo (Ctrl+Z)');
  });

  it('uses Mac symbols on a Mac, and the Mac redo', () => {
    expect(keys('Undo (Ctrl+Z) · Redo (Ctrl+Y)', true)).toBe('Undo (⌘Z) · Redo (⇧⌘Z)');
    expect(keys('Ctrl K', true)).toBe('⌘K');
    expect(keys('Alt+3', true)).toBe('⌥3');
    expect(keys(keys('Ctrl+S', true), true)).toBe('⌘S');
  });
});
