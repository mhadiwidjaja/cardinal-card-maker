import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { run, toBool } from '../../expr/expr';
import { cardResolver } from '../../model/cardContext';
import { faceNames, findLayer, isFaceLandscape, isLandscape, resolveFace } from '../../model/resolve';
import {
  addLayer,
  defaultLayer,
  deleteLayer,
  inheritedIds,
  moveLayer,
  ownEntry,
  replaceOwnEntry,
  setLayerProp,
  uniqueLayerId,
} from '../../model/templateOps';
import type { Card, Game, Layer, LayerPatch, LayerType, Rect, TemplateDef } from '../../model/types';
import type { AssetStore } from '../../render/assets';
import { templateFor, templateSize, type RenderWarning } from '../../render/renderCard';
import { gameKey, type Project } from '../store';
import { LayerList } from './LayerList';
import { LayerProps } from './LayerProps';
import { TemplateCanvas, type GeoChange } from './TemplateCanvas';
import { ResizeHandle, usePanelWidth, type PanelSize } from '../ResizeHandle';
import { StressTest } from './StressTest';
import { useCommands } from '../commands';
import { keys } from '../keys';

const TEMPLATE_LIST: PanelSize = { initial: 190, min: 130, max: 420 };
const TEMPLATE_SIDE: PanelSize = { initial: 340, min: 260, max: 760 };

type Templates = Record<string, TemplateDef>;

interface Props {
  game: Game;
  assets: AssetStore;
  assetVersion: number;
  project: Project;
  active: boolean;
}

interface HistoryEntry {
  templates: Templates;
  changed: string[];
}

const ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function TemplatesView({ game, assets, assetVersion, project, active }: Props) {
  const key = gameKey(game);
  const [listW, setListW] = usePanelWidth('template-list', TEMPLATE_LIST);
  const [stress, setStress] = useState(false);
  const [sideW, setSideW] = usePanelWidth('template-side', TEMPLATE_SIDE);
  const ids = Object.keys(game.templates).sort((a, b) => a.localeCompare(b));
  const [templateId, setTemplateId] = useState<string>(() => ids.find((i) => !game.templates[i]!.abstract) ?? ids[0] ?? '');
  const [face, setFace] = useState('front');
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [sampleIdx, setSampleIdx] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<RenderWarning[]>([]);

  const undo = useRef<HistoryEntry[]>([]);
  const redo = useRef<HistoryEntry[]>([]);
  const lastKey = useRef<{ key: string; time: number } | null>(null);
  const latest = useRef<Templates>(game.templates);
  latest.current = game.templates;
  const [, force] = useState(0);

  const template = game.templates[templateId];
  const faces = template ? faceNames(game.templates, templateId) : [];
  const activeFace = faces.includes(face) ? face : (faces[0] ?? 'front');
  const landscape = templateId ? isFaceLandscape(game.templates, templateId, activeFace) : false;
  const ownFace = template?.faces[activeFace];
  const resolved = useMemo(() => (template ? resolveFace(game.templates, templateId, activeFace) : null), [game.templates, templateId, activeFace, template]);
  const delegated = !!ownFace?.useTemplate || (!!resolved && resolved.templateId !== templateId);
  const layers = resolved && !delegated ? resolved.layers : [];
  const inherited = useMemo(() => (template ? inheritedIds(game.templates, templateId, activeFace) : new Set<string>()), [game.templates, templateId, activeFace, template]);

  const allCards: { card: Card; setIdx: number; label: string }[] = useMemo(
    () => game.sets.flatMap((s, si) => s.cards.map((c) => ({ card: c, setIdx: si, label: `${s.def.name}: ${c.values[nameField(game)] || c.id}` }))),
    [game],
  );
  const preferred = allCards.findIndex((c) => templateFor(game, c.card) === templateId);
  const sample = allCards[sampleIdx ?? (preferred >= 0 ? preferred : 0)] ?? null;
  const sampleCard: Card = sample?.card ?? { id: 'sample', row: 0, values: {} };
  const sampleSet = sample ? game.sets[sample.setIdx] : undefined;

  const hiddenOnCard = useMemo(() => {
    const out = new Set<string>();
    const r = cardResolver(game, sampleCard, sampleSet);
    const walk = (ls: Layer[]) => {
      for (const l of ls) {
        if (l.showIf?.trim()) {
          try {
            if (!toBool(run(l.showIf, r))) out.add(l.id);
          } catch {
            out.add(l.id);
          }
        }
        if (l.type === 'group') walk(l.layers);
      }
    };
    walk(layers);
    return out;
  }, [layers, game, sampleCard, sampleSet]);

  /** Applies a change to templates. `historyKey` merges rapid edits of the same thing into one undo step. */
  const apply = useCallback(
    (fn: (ts: Templates) => { templates: Templates; changed: string[]; deleted?: string[] }, historyKey?: string) => {
      const before = latest.current;
      const result = fn(before);
      const now = Date.now();
      const merge =
        historyKey && lastKey.current?.key === historyKey && (historyKey.startsWith('drag/') || now - lastKey.current.time < 1500);
      if (!merge) {
        undo.current.push({ templates: before, changed: [...result.changed, ...(result.deleted ?? [])] });
        if (undo.current.length > 200) undo.current.shift();
        redo.current = [];
      }
      lastKey.current = historyKey ? { key: historyKey, time: now } : null;
      latest.current = result.templates;
      project.setTemplates(key, result.templates, result.changed, result.deleted);
      force((n) => n + 1);
    },
    [project, key],
  );

  const applyOne = useCallback(
    (fn: (ts: Templates) => TemplateDef, historyKey?: string) =>
      apply((ts) => {
        const t = fn(ts);
        return { templates: { ...ts, [t.id]: t }, changed: [t.id] };
      }, historyKey),
    [apply],
  );

  const undoRedo = useCallback(
    (dir: 'undo' | 'redo') => {
      const from = dir === 'undo' ? undo.current : redo.current;
      const to = dir === 'undo' ? redo.current : undo.current;
      const entry = from.pop();
      if (!entry) return;
      to.push({ templates: latest.current, changed: entry.changed });
      latest.current = entry.templates;
      lastKey.current = null;
      const existing = entry.changed.filter((id) => entry.templates[id]);
      const removed = entry.changed.filter((id) => !entry.templates[id]);
      project.setTemplates(key, entry.templates, existing, removed);
      if (!entry.templates[templateId]) setTemplateId(Object.keys(entry.templates)[0] ?? '');
      force((n) => n + 1);
    },
    [project, key, templateId],
  );

  const setProp = (layerId: string, path: string[], value: unknown) =>
    applyOne((ts) => setLayerProp(ts, templateId, activeFace, layerId, path, value), `${templateId}/${layerId}/${path.join('.')}`);

  const onGeometry = (layerId: string, change: GeoChange, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') {
      lastKey.current = null;
      applyOne((ts) => setLayerProp(ts, templateId, activeFace, layerId, [change.prop], change.value), `drag/${layerId}/${Date.now()}`);
      return;
    }
    applyOne((ts) => setLayerProp(ts, templateId, activeFace, layerId, [change.prop], change.value), lastKey.current?.key);
  };

  const onAdd = (type: LayerType) => {
    const s = templateSize(game, landscape);
    const at: Rect = [Math.round(s.width * 0.25), Math.round(s.height * 0.4), Math.round(s.width * 0.5), Math.round(s.height * 0.12)];
    const id = uniqueLayerId(latest.current, type);
    const sel = selected ? findLayer(layers, selected) : null;
    const selLayer = sel ? sel.list[sel.index] : null;
    const intoGroup = selLayer?.type === 'group' ? selLayer.id : undefined;
    applyOne((ts) => addLayer(ts, templateId, activeFace, defaultLayer(type, id, at), intoGroup ? undefined : (selected ?? undefined), intoGroup));
    setSelected(id);
  };

  const onDelete = (id: string) => {
    applyOne((ts) => deleteLayer(ts, templateId, activeFace, id));
    if (selected === id) setSelected(null);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoRedo(e.shiftKey ? 'redo' : 'undo');
      } else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        undoRedo('redo');
      } else if (!typing && selected && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        onDelete(selected);
      } else if (!typing && selected && e.key.startsWith('Arrow')) {
        const found = findLayer(layers, selected);
        const l = found?.list[found.index];
        if (!l || l.locked) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const nudgeKey = `nudge/${selected}`;
        if (l.type === 'group') setPropKeyed(selected, ['offset'], [(l.offset?.[0] ?? 0) + dx, (l.offset?.[1] ?? 0) + dy], nudgeKey);
        else if (l.type === 'text' && l.polygon) setPropKeyed(selected, ['polygon'], l.polygon.map(([x, y]) => [x + dx, y + dy]), nudgeKey);
        else if (l.type === 'shape' && l.shape === 'polygon' && l.points) setPropKeyed(selected, ['points'], l.points.map(([x, y]) => [x + dx, y + dy]), nudgeKey);
        else if ('rect' in l && l.rect) setPropKeyed(selected, ['rect'], [l.rect[0] + dx, l.rect[1] + dy, l.rect[2], l.rect[3]], nudgeKey);
      }
    };
    const setPropKeyed = (id: string, path: string[], v: unknown, k: string) => applyOne((ts) => setLayerProp(ts, templateId, activeFace, id, path, v), k);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function newTemplate(copyOf?: string) {
    const name = window.prompt(copyOf ? `Id for the copy of "${copyOf}":` : 'Id for the new template (letters, digits, - or _):', copyOf ? `${copyOf}-copy` : 'new-template');
    if (!name) return;
    if (!ID_RE.test(name)) return window.alert('Use letters, digits, - or _ (start with a letter).');
    if (latest.current[name]) return window.alert(`A template "${name}" already exists.`);
    let t: TemplateDef;
    if (copyOf) {
      t = { ...JSON.parse(JSON.stringify(latest.current[copyOf])), id: name, name: undefined, abstract: undefined };
    } else {
      const base = template?.abstract ? templateId : template?.extends;
      t = base
        ? { formatVersion: 1, id: name, name, extends: base, faces: { front: { layers: [] } } }
        : { formatVersion: 1, id: name, name, faces: { front: { layers: [defaultLayer('shape', 'background', [0, 0, templateSize(game).width, templateSize(game).height]) as LayerPatch] } } };
    }
    apply((ts) => ({ templates: { ...ts, [name]: t }, changed: [name] }));
    setTemplateId(name);
    setSelected(null);
  }

  function deleteTemplate() {
    if (!template) return;
    const users = game.sets.flatMap((s) => s.cards).filter((c) => c.values.template === templateId).length;
    const children = Object.values(game.templates).filter((t) => t.extends === templateId || Object.values(t.faces).some((f) => f.useTemplate === templateId));
    if (children.length) return window.alert(`Can't delete: ${children.map((c) => c.id).join(', ')} build on this template.`);
    if (!window.confirm(`Delete template "${templateId}"?${users ? ` ${users} card(s) use it.` : ''}\n\nThe file is removed when you save (a .bak copy is kept).`)) return;
    apply((ts) => {
      const next = { ...ts };
      delete next[templateId];
      return { templates: next, changed: [], deleted: [templateId] };
    });
    setTemplateId(Object.keys(latest.current)[0] ?? '');
  }

  const setTemplateField = (patch: Partial<TemplateDef>) =>
    applyOne((ts) => {
      const t = { ...ts[templateId]!, ...patch };
      for (const k of Object.keys(patch) as (keyof TemplateDef)[]) if (patch[k] === undefined) delete t[k];
      return t;
    }, `tpl/${templateId}/${Object.keys(patch).join()}`);

  function addFace() {
    const name = window.prompt('Name of the new face (e.g. back):', faces.includes('back') ? 'side' : 'back');
    if (!name || faces.includes(name)) return;
    applyOne((ts) => {
      const t = JSON.parse(JSON.stringify(ts[templateId])) as TemplateDef;
      t.faces[name] = { layers: [] };
      return t;
    });
    setFace(name);
  }

  function setFaceSource(src: string) {
    applyOne((ts) => {
      const t = JSON.parse(JSON.stringify(ts[templateId])) as TemplateDef;
      if (src === '') {
        t.faces[activeFace] = { layers: [] };
      } else if (src === '-') {
        delete t.faces[activeFace];
      } else t.faces[activeFace] = { useTemplate: src };
      return t;
    });
  }

  const selLayer = selected ? (findLayer(layers, selected)?.list[findLayer(layers, selected)!.index] ?? null) : null;
  const fontFamilies = ['serif', 'sans-serif', 'monospace', ...(game.def.fonts ?? []).map((f) => f.family)];

  useCommands(
    'templates',
    [
      { id: 'tpl-new', group: 'Templates', label: 'New template', run: () => newTemplate() },
      ...(template
        ? [
            { id: 'tpl-stress', group: 'Templates', label: 'Stress test this template…', run: () => setStress(true), keywords: 'longest overflow combinations' },
            { id: 'tpl-face', group: 'Templates', label: 'Add a face (e.g. a back)', run: addFace },
            { id: 'tpl-dup', group: 'Templates', label: 'Duplicate this template', run: () => newTemplate(template.id) },
            { id: 'tpl-undo', group: 'Templates', label: 'Undo', keys: 'Ctrl+Z', run: () => undoRedo('undo'), disabled: undo.current.length === 0 },
            { id: 'tpl-redo', group: 'Templates', label: 'Redo', keys: 'Ctrl+Y', run: () => undoRedo('redo'), disabled: redo.current.length === 0 },
          ]
        : []),
      ...ids.map((id) => ({ id: `tpl-open-${id}`, group: 'Templates', label: `Open template ${game.templates[id]?.name ?? id}`, run: () => setTemplateId(id) })),
    ],
    active,
  );

  if (!template) {
    return (
      <main className="content">
        <p className="muted">This game has no templates yet.</p>
        <button onClick={() => newTemplate()}>New template</button>
      </main>
    );
  }

  return (
    <div className="templates-view">
      <aside className="tpl-list" style={{ width: listW }}>
        <div className="panel-head">
          <strong>Templates</strong>
          <span className="spacer" />
          <button title="New template" onClick={() => newTemplate()}>
            +
          </button>
        </div>
        <ul>
          {ids.map((id) => {
            const t = game.templates[id]!;
            return (
              <li key={id} className={id === templateId ? 'sel' : ''} onClick={() => (setTemplateId(id), setSelected(null))}>
                {t.name ?? id}
                {t.abstract && <span className="muted small"> base</span>}
                {isLandscape(game.templates, id) && <span className="muted small"> · horizontal</span>}
                {t.extends && <div className="muted small">extends {t.extends}</div>}
              </li>
            );
          })}
        </ul>
        <div className="tpl-settings">
          <label>
            Name
            <input type="text" value={template.name ?? ''} placeholder={templateId} onChange={(e) => setTemplateField({ name: e.target.value || undefined })} />
          </label>
          <label>
            Extends
            <select value={template.extends ?? ''} onChange={(e) => setTemplateField({ extends: e.target.value || undefined })}>
              <option value="">(nothing)</option>
              {ids
                .filter((i) => i !== templateId && !ancestorsOf(game.templates, i).includes(templateId))
                .map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Card shape
            <select
              value={template.orientation ?? ''}
              onChange={(e) => setTemplateField({ orientation: (e.target.value || undefined) as TemplateDef['orientation'] })}
              title="Horizontal cards are the same card turned sideways. Layers keep their positions, so rearrange them after switching."
            >
              {template.extends ? (
                <option value="">Same as {template.extends} ({isLandscape(game.templates, template.extends) ? 'horizontal' : 'vertical'})</option>
              ) : (
                <option value="">Vertical (portrait)</option>
              )}
              {template.extends && <option value="portrait">Vertical (portrait)</option>}
              <option value="landscape">Horizontal (landscape)</option>
            </select>
          </label>
          <label className="inline">
            <input type="checkbox" checked={!!template.abstract} onChange={(e) => setTemplateField({ abstract: e.target.checked || undefined })} />
            Base only (cards can’t use it)
          </label>
          <div className="inline">
            <button onClick={() => newTemplate(templateId)}>Duplicate</button>
            <button onClick={deleteTemplate}>Delete</button>
          </div>
        </div>
      </aside>

      <ResizeHandle panel="left" width={listW} size={TEMPLATE_LIST} onWidth={setListW} label="Template list width" />
      <section className="tpl-center">
        <div className="tpl-toolbar">
          <div className="segmented" role="group" aria-label="Side">
            {faces.map((f) => (
              <button key={f} className={f === activeFace ? 'active' : ''} aria-pressed={f === activeFace} onClick={() => (setFace(f), setSelected(null))}>
                {f}
              </button>
            ))}
            <button title="Add a face (e.g. a back)" onClick={addFace} aria-label="Add a face">
              +
            </button>
          </div>
          <label>
            Sample
            <select value={sampleIdx ?? (preferred >= 0 ? preferred : 0)} onChange={(e) => setSampleIdx(Number(e.target.value))}>
              {allCards.map((c, i) => (
                <option key={i} value={i}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <select value={String(zoom)} onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
            <option value="fit">Fit</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="1.5">150%</option>
          </select>
          <span className="spacer" />
          <div className="toolbar-group">
            <button onClick={() => undoRedo('undo')} disabled={undo.current.length === 0} title={keys('Undo (Ctrl+Z)')} aria-label="Undo">
              ↶
            </button>
            <button onClick={() => undoRedo('redo')} disabled={redo.current.length === 0} title={keys('Redo (Ctrl+Y)')} aria-label="Redo">
              ↷
            </button>
          </div>
          <button onClick={() => setStress(true)} title="Draw this template with the longest texts, empty fields and every combination of choices">
            Stress test
          </button>
        </div>
        {delegated ? (
          <div className="content">
            <p>
              This face uses the template <strong>{ownFace?.useTemplate ?? resolved?.templateId}</strong>
              {ownFace?.useTemplate ? '' : ' (inherited)'}. Edit that template, or give this face its own layers.
            </p>
          </div>
        ) : (
          <TemplateCanvas
            landscape={landscape}
            game={game}
            set={sampleSet}
            card={sampleCard}
            assets={assets}
            version={assetVersion}
            templateId={templateId}
            face={activeFace}
            layers={layers}
            selected={selected}
            zoom={zoom}
            onSelect={setSelected}
            onGeometry={onGeometry}
            onWarnings={setWarnings}
          />
        )}
        <div className="tpl-footer">
          <label>
            Face content
            <select value={ownFace?.useTemplate ?? (ownFace ? '' : '-')} onChange={(e) => setFaceSource(e.target.value)}>
              {!ownFace && <option value="-">inherited</option>}
              <option value="">own layers</option>
              {ids
                .filter((i) => i !== templateId)
                .map((i) => (
                  <option key={i} value={i}>
                    use template “{game.templates[i]!.name ?? i}”
                  </option>
                ))}
            </select>
          </label>
          {warnings.length > 0 && (
            <span className="warn-inline" title={warnings.map((w) => `${w.layer ?? ''} ${w.message}`).join('\n')}>
              ⚠ {warnings.length} warning{warnings.length > 1 ? 's' : ''} on this card
            </span>
          )}
          <span className="muted small">Drag to move · handles resize · Shift keeps axis/aspect · Alt disables snapping · arrows nudge</span>
        </div>
      </section>

      <ResizeHandle panel="right" width={sideW} size={TEMPLATE_SIDE} onWidth={setSideW} label="Layer panel width" />
      {stress && <StressTest game={game} templateId={templateId} assets={assets} onClose={() => setStress(false)} />}
      <aside className="tpl-side" style={{ width: sideW }}>
        {!delegated && (
          <LayerList
            layers={layers}
            selected={selected}
            inherited={inherited}
            hiddenOnCard={hiddenOnCard}
            onSelect={setSelected}
            onToggle={(id, prop) => {
              const l = findLayer(layers, id);
              const cur = l ? (l.list[l.index] as Layer)[prop] : false;
              setProp(id, [prop], cur ? undefined : true);
            }}
            onMove={(id, dir) => applyOne((ts) => moveLayer(ts, templateId, activeFace, id, dir))}
            onDelete={onDelete}
            onAdd={onAdd}
          />
        )}
        {selLayer && (
          <LayerProps
            key={selLayer.id}
            game={game}
            layer={selLayer}
            own={ownEntry(template, activeFace, selLayer.id)}
            inherited={inherited.has(selLayer.id)}
            onProp={(path, v) => setProp(selLayer.id, path, v)}
            onReplaceOwn={(entry) => applyOne((ts) => replaceOwnEntry(ts, templateId, activeFace, selLayer.id, entry))}
            fontFamilies={fontFamilies}
          />
        )}
      </aside>
    </div>
  );
}

function nameField(game: Game): string {
  return game.def.fields.find((f) => f.identifying)?.id ?? game.def.fields[0]?.id ?? 'name';
}

function ancestorsOf(ts: Templates, id: string): string[] {
  const out: string[] = [];
  let cur = ts[id];
  const seen = new Set<string>();
  while (cur?.extends && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur.extends);
    cur = ts[cur.extends];
  }
  return out;
}
