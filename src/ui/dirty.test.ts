import { describe, expect, it } from 'vitest';
import { afterSave, dirtyKey, withDirty, type Dirty, type DirtyMap } from './dirty';

const cards: Dirty = { kind: 'cards', game: 'g', set: 'core' };
const game: Dirty = { kind: 'game', game: 'g' };

describe('dirty map', () => {
  it('removes entries that were written', () => {
    const before = withDirty(new Map(), [cards, game]);
    expect(afterSave(before, before).size).toBe(0);
  });

  it('keeps an entry that was edited again while the save ran', () => {
    const before = withDirty(new Map(), [cards, game]);
    const written: DirtyMap = new Map(before);
    const during = withDirty(before, [cards]);
    const after = afterSave(during, written);
    expect([...after.keys()]).toEqual([dirtyKey(cards)]);
  });

  it('keeps entries added during the save and entries that failed', () => {
    const before = withDirty(new Map(), [cards, game]);
    const written: DirtyMap = new Map([[dirtyKey(game), before.get(dirtyKey(game))!]]);
    const during = withDirty(before, [{ kind: 'template', game: 'g', id: 'unit' }]);
    const after = afterSave(during, written);
    expect([...after.keys()].sort()).toEqual([dirtyKey(cards), dirtyKey({ kind: 'template', game: 'g', id: 'unit' })].sort());
  });

  it('a template edit cancels its pending delete', () => {
    const m = withDirty(new Map(), [{ kind: 'templateDelete', game: 'g', id: 'unit', path: 'x' }]);
    expect(withDirty(m, [{ kind: 'template', game: 'g', id: 'unit' }]).size).toBe(1);
  });
});
