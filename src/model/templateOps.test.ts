import { describe, expect, it } from 'vitest';
import { resolveFace } from './resolve';
import { addLayer, defaultLayer, deleteLayer, moveLayer, ownEntry, setLayerProp } from './templateOps';
import type { TemplateDef } from './types';

function fixture(): Record<string, TemplateDef> {
  return {
    base: {
      formatVersion: 1,
      id: 'base',
      faces: {
        front: {
          layers: [
            { id: 'a', type: 'shape', shape: 'rect', rect: [0, 0, 1, 1], fill: 'red' },
            { id: 'b', type: 'text', text: 'x', rect: [0, 0, 1, 1], font: { family: 'serif', size: 10 } },
            { id: 'c', type: 'shape', shape: 'ellipse', rect: [0, 0, 1, 1] },
          ],
        },
      },
    },
    child: { formatVersion: 1, id: 'child', extends: 'base', faces: { front: { layers: [{ id: 'n', type: 'shape', shape: 'rect', rect: [5, 5, 1, 1] }] } } },
  };
}
const ids = (ts: Record<string, TemplateDef>, id: string) => resolveFace(ts, id, 'front')!.layers.map((l) => l.id);
const withT = (ts: Record<string, TemplateDef>, t: TemplateDef) => ({ ...ts, [t.id]: t });

describe('setLayerProp', () => {
  it('edits a layer defined in the template directly', () => {
    const ts = fixture();
    const t = setLayerProp(ts, 'base', 'front', 'a', ['fill'], 'blue');
    expect(t.faces.front!.layers![0]).toMatchObject({ id: 'a', fill: 'blue' });
    expect(ts.base!.faces.front!.layers![0]).toMatchObject({ fill: 'red' });
  });

  it('writes only the changed sub-property as a patch for inherited layers', () => {
    const ts = fixture();
    const t = setLayerProp(ts, 'child', 'front', 'b', ['font', 'size'], 20);
    expect(ownEntry(t, 'front', 'b')).toEqual({ id: 'b', font: { size: 20 } });
    const b = resolveFace(withT(ts, t), 'child', 'front')!.layers[1]!;
    expect(b).toMatchObject({ font: { family: 'serif', size: 20 } });
  });

  it('removes an empty patch when a property is reset', () => {
    const ts = fixture();
    const t1 = setLayerProp(ts, 'child', 'front', 'a', ['fill'], 'green');
    const t2 = setLayerProp(withT(ts, t1), 'child', 'front', 'a', ['fill'], undefined);
    expect(ownEntry(t2, 'front', 'a')).toBeNull();
  });
});

describe('add / delete', () => {
  it('adds after a given layer in a root template', () => {
    const ts = fixture();
    const t = addLayer(ts, 'base', 'front', defaultLayer('shape', 'z', [0, 0, 1, 1]), 'a');
    expect(ids(withT(ts, t), 'base')).toEqual(['a', 'z', 'b', 'c']);
  });

  it('adds after an inherited layer using an anchor', () => {
    const ts = fixture();
    const t = addLayer(ts, 'child', 'front', defaultLayer('text', 'z', [0, 0, 1, 1]), 'a');
    expect(ids(withT(ts, t), 'child')).toEqual(['a', 'z', 'b', 'c', 'n']);
  });

  it('deletes own layers and hides inherited ones', () => {
    const ts = fixture();
    let t = deleteLayer(ts, 'child', 'front', 'n');
    expect(ids(withT(ts, t), 'child')).toEqual(['a', 'b', 'c']);
    t = deleteLayer(withT(ts, t), 'child', 'front', 'b');
    expect(ids(withT(ts, t), 'child')).toEqual(['a', 'c']);
    expect(ids(ts, 'base')).toEqual(['a', 'b', 'c']);
  });
});

describe('moveLayer', () => {
  it('reorders a root template physically', () => {
    const ts = fixture();
    const t = moveLayer(ts, 'base', 'front', 'a', 1);
    expect(ids(withT(ts, t), 'base')).toEqual(['b', 'a', 'c']);
    expect(t.faces.front!.layers!.every((l) => l.after === undefined && l.before === undefined)).toBe(true);
  });

  it('reorders inherited layers in a child without touching the parent', () => {
    const ts = fixture();
    let cur = ts;
    cur = withT(cur, moveLayer(cur, 'child', 'front', 'n', -1));
    expect(ids(cur, 'child')).toEqual(['a', 'b', 'n', 'c']);
    cur = withT(cur, moveLayer(cur, 'child', 'front', 'n', -1));
    cur = withT(cur, moveLayer(cur, 'child', 'front', 'n', -1));
    expect(ids(cur, 'child')).toEqual(['n', 'a', 'b', 'c']);
    cur = withT(cur, moveLayer(cur, 'child', 'front', 'c', -1));
    expect(ids(cur, 'child')).toEqual(['n', 'a', 'c', 'b']);
    expect(ids(cur, 'base')).toEqual(['a', 'b', 'c']);
  });

  it('does nothing at the ends', () => {
    const ts = fixture();
    expect(moveLayer(ts, 'base', 'front', 'c', 1)).toBe(ts.base);
  });
});
