import { describe, expect, it } from 'vitest';
import { run } from '../expr/expr';
import { cardResolver } from './cardContext';
import { demoWorkspaceFs } from './demo';
import { loadWorkspace } from './load';
import { faceNames, isFaceLandscape, isLandscape, resolveFace } from './resolve';
import type { TemplateDef } from './types';

const t = (def: Partial<TemplateDef> & { id: string }): TemplateDef => ({ formatVersion: 1, faces: {}, ...def });

const templates: Record<string, TemplateDef> = {
  base: t({
    id: 'base',
    faces: {
      front: {
        layers: [
          { id: 'bg', type: 'shape', shape: 'rect', rect: [0, 0, 10, 10], fill: 'red' },
          { id: 'title', type: 'text', text: '{name}', rect: [0, 0, 10, 2], font: { family: 'serif', size: 10, weight: 700 } },
          { id: 'grp', type: 'group', layers: [{ id: 'inner', type: 'shape', shape: 'ellipse', rect: [1, 1, 1, 1], fill: 'blue' }] },
        ],
      },
      back: { useTemplate: 'back' },
    },
  }),
  child: t({
    id: 'child',
    extends: 'base',
    faces: {
      front: {
        layers: [
          { id: 'bg', fill: 'green' },
          { id: 'title', font: { size: 20 } } as never,
          { id: 'inner', remove: true },
          { id: 'badge', type: 'shape', shape: 'rect', rect: [5, 5, 1, 1], after: 'bg' } as never,
        ],
      },
    },
  }),
  back: t({ id: 'back', faces: { front: { layers: [{ id: 'logo', type: 'shape', shape: 'ellipse', rect: [0, 0, 1, 1] }] } } }),
};

describe('resolveFace', () => {
  it('returns a template’s own layers', () => {
    expect(resolveFace(templates, 'base', 'front')!.layers.map((l) => l.id)).toEqual(['bg', 'title', 'grp']);
  });

  it('applies overrides, additions and removals from a child template', () => {
    const layers = resolveFace(templates, 'child', 'front')!.layers;
    expect(layers.map((l) => l.id)).toEqual(['bg', 'badge', 'title', 'grp']);
    expect(layers[0]).toMatchObject({ fill: 'green', shape: 'rect' });
    expect(layers[2]).toMatchObject({ font: { family: 'serif', size: 20, weight: 700 } });
    expect(layers[3]).toMatchObject({ type: 'group', layers: [] });
  });

  it('does not modify the parent template', () => {
    resolveFace(templates, 'child', 'front');
    expect(resolveFace(templates, 'base', 'front')!.layers[0]).toMatchObject({ fill: 'red' });
  });

  it('inherits faces and follows useTemplate', () => {
    expect(faceNames(templates, 'child')).toEqual(['front', 'back']);
    const back = resolveFace(templates, 'child', 'back')!;
    expect(back.templateId).toBe('back');
    expect(back.layers.map((l) => l.id)).toEqual(['logo']);
  });

  it('returns null for unknown templates or faces', () => {
    expect(resolveFace(templates, 'nope', 'front')).toBeNull();
    expect(resolveFace(templates, 'back', 'side')).toBeNull();
  });
});

describe('cardResolver', () => {
  it('exposes fields, defaults, template names, set info and field colors', async () => {
    const game = (await loadWorkspace(demoWorkspaceFs())).games[0]!;
    const set = game.sets[0]!;
    const titan = set.cards[3]!;
    const r = cardResolver(game, titan, set);
    expect(run('name', r)).toBe('Pyre Titan');
    expect(run('template.name', r)).toBe('Unit');
    expect(run('card.number', r)).toBe(4);
    expect(run('card.total', r)).toBe(14);
    expect(run('set.code', r)).toBe('CORE');
    expect(run('color.element', r)).toBe('#d9442b');
    const blank = { ...titan, values: { ...titan.values, count: '' } };
    expect(run('count', cardResolver(game, blank, set))).toBe('1');
  });
});

describe('card shape (orientation)', () => {
  const ts: Record<string, TemplateDef> = {
    back: t({ id: 'back', faces: { front: { layers: [] } } }),
    wide: t({ id: 'wide', orientation: 'landscape', faces: { front: { layers: [] }, back: { useTemplate: 'back' } } }),
    wideChild: t({ id: 'wideChild', extends: 'wide', faces: {} }),
    tallAgain: t({ id: 'tallAgain', extends: 'wide', orientation: 'portrait', faces: {} }),
  };

  it('is portrait unless a template in the chain says landscape', () => {
    expect(isLandscape(ts, 'back')).toBe(false);
    expect(isLandscape(ts, 'wide')).toBe(true);
    expect(isLandscape(ts, 'wideChild')).toBe(true);
    expect(isLandscape(ts, 'tallAgain')).toBe(false);
  });

  it('a face that uses another template takes that template’s shape', () => {
    expect(isFaceLandscape(ts, 'wide', 'front')).toBe(true);
    expect(isFaceLandscape(ts, 'wide', 'back')).toBe(false);
  });
});
