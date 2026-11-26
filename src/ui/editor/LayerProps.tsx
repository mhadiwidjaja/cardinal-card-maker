import { useEffect, useState, type ReactNode } from 'react';
import { compile, splitInterpolation } from '../../expr/expr';
import type { Game, Layer, LayerPatch, Paint, Pt, Rect } from '../../model/types';

type SetProp = (path: string[], value: unknown) => void;

interface Props {
  game: Game;
  layer: Layer;
  own: LayerPatch | null;
  inherited: boolean;
  onProp: SetProp;
  onReplaceOwn: (entry: LayerPatch | null) => void;
  fontFamilies: string[];
}

export function LayerProps({ game, layer, own, inherited, onProp, onReplaceOwn, fontFamilies }: Props) {
  const fieldIds = game.def.fields.map((f) => f.id);
  const overridden = (k: string) => inherited && own !== null && k in own && k !== 'id';
  const reset = (k: string) =>
    overridden(k) ? (
      <button className="reset" title="Reset to the inherited value" onClick={() => onProp([k], undefined)}>
        ↺
      </button>
    ) : null;
  const row = (label: string, key: string, control: ReactNode) => (
    <div className={'prop' + (overridden(key) ? ' over' : '')}>
      <label>{label}</label>
      <div className="ctl">{control}</div>
      {reset(key)}
    </div>
  );

  return (
    <div className="layer-props">
      <div className="panel-head">
        <strong>{layer.type}</strong>&nbsp;<code>{layer.id}</code>
        {inherited && <span className="muted small">&nbsp;inherited</span>}
      </div>
      {row('Name', 'name', <TextIn value={layer.name ?? ''} onChange={(v) => onProp(['name'], v || undefined)} placeholder={layer.id} />)}
      {row('Show if', 'showIf', <ExprIn value={layer.showIf ?? ''} onChange={(v) => onProp(['showIf'], v || undefined)} placeholder="always" fields={fieldIds} />)}

      {layer.type === 'text' && (
        <>
          {row('Text', 'text', <TemplateTextIn value={layer.text} onChange={(v) => onProp(['text'], v)} fields={fieldIds} />)}
          {row('Font', 'font', <FontIn value={layer.font} families={fontFamilies} onChange={(k, v) => onProp(['font', k], v)} />)}
          {row('Color', 'color', <ColorIn value={layer.color ?? '#000000'} onChange={(v) => onProp(['color'], v)} />)}
          {row(
            'Align',
            'align',
            <Seg value={layer.align ?? 'left'} options={['left', 'center', 'right', 'justify']} onChange={(v) => onProp(['align'], v)} />,
          )}
          {row('V-align', 'valign', <Seg value={layer.valign ?? 'top'} options={['top', 'middle', 'bottom']} onChange={(v) => onProp(['valign'], v)} />)}
          {row('Line height', 'lineHeight', <NumIn value={layer.lineHeight ?? 1.2} step={0.05} onChange={(v) => onProp(['lineHeight'], v)} />)}
          {row('Paragraph gap', 'paragraphSpacing', <NumIn value={layer.paragraphSpacing ?? 0} step={0.05} onChange={(v) => onProp(['paragraphSpacing'], v || undefined)} />)}
          {row(
            'Shrink to fit',
            'shrink',
            <span className="inline">
              <input type="checkbox" checked={!!layer.shrink} onChange={(e) => onProp(['shrink'], e.target.checked ? { min: Math.round((layer.font?.size ?? 30) * 0.6) } : undefined)} />
              {layer.shrink && (
                <>
                  min <NumIn value={layer.shrink.min} onChange={(v) => onProp(['shrink', 'min'], v)} />
                </>
              )}
            </span>,
          )}
          {row('Letter spacing', 'letterSpacing', <NumIn value={layer.letterSpacing ?? 0} step={0.5} onChange={(v) => onProp(['letterSpacing'], v || undefined)} />)}
          {row('Icon size', 'iconScale', <NumIn value={layer.iconScale ?? 1} step={0.05} onChange={(v) => onProp(['iconScale'], v === 1 ? undefined : v)} />)}
          {row(
            'Outline',
            'stroke',
            <OptionalGroup
              on={!!layer.stroke}
              onToggle={(on) => onProp(['stroke'], on ? { color: '#ffffff', width: 4 } : undefined)}
            >
              {layer.stroke && (
                <>
                  <ColorIn value={layer.stroke.color} onChange={(v) => onProp(['stroke', 'color'], v)} />
                  <NumIn value={layer.stroke.width} onChange={(v) => onProp(['stroke', 'width'], v)} />
                </>
              )}
            </OptionalGroup>,
          )}
          {row(
            'Shadow',
            'shadow',
            <OptionalGroup on={!!layer.shadow} onToggle={(on) => onProp(['shadow'], on ? { color: 'rgba(0,0,0,0.6)', blur: 6, dx: 2, dy: 2 } : undefined)}>
              {layer.shadow && (
                <>
                  <ColorIn value={layer.shadow.color} onChange={(v) => onProp(['shadow', 'color'], v)} />
                  blur <NumIn value={layer.shadow.blur ?? 0} onChange={(v) => onProp(['shadow', 'blur'], v)} />
                  x <NumIn value={layer.shadow.dx ?? 0} onChange={(v) => onProp(['shadow', 'dx'], v)} />
                  y <NumIn value={layer.shadow.dy ?? 0} onChange={(v) => onProp(['shadow', 'dy'], v)} />
                </>
              )}
            </OptionalGroup>,
          )}
          {row(
            'Case',
            'transform',
            <Seg value={layer.transform ?? 'none'} options={['none', 'uppercase', 'lowercase']} onChange={(v) => onProp(['transform'], v === 'none' ? undefined : v)} />,
          )}
          {row(
            'Reminders',
            'reminders',
            <Seg value={layer.reminders ?? 'auto'} options={['auto', 'all', 'none']} onChange={(v) => onProp(['reminders'], v === 'auto' ? undefined : v)} />,
          )}
          {row(
            'Text area',
            'polygon',
            <Seg
              value={layer.polygon ? 'shape' : 'box'}
              options={['box', 'shape']}
              onChange={(v) => {
                if (v === 'shape' && !layer.polygon) {
                  const [x, y, w, h] = layer.rect ?? [100, 100, 300, 200];
                  onProp(['polygon'], [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
                } else if (v === 'box' && layer.polygon) {
                  const xs = layer.polygon.map((p) => p[0]);
                  const ys = layer.polygon.map((p) => p[1]);
                  const x = Math.min(...xs);
                  const y = Math.min(...ys);
                  onProp(['rect'], [x, y, Math.max(...xs) - x, Math.max(...ys) - y]);
                  onProp(['polygon'], inherited ? null : undefined);
                }
              }}
            />,
          )}
          {layer.polygon && <p className="hint">Drag the points on the card. Double-click an edge to add a point; Alt+click a point to remove it.</p>}
        </>
      )}

      {layer.type === 'image' && (
        <>
          {row('File', 'src', <TemplateTextIn value={layer.src} onChange={(v) => onProp(['src'], v)} fields={fieldIds} placeholder="art/{art}" />)}
          {row('Fit', 'fit', <Seg value={layer.fit ?? 'cover'} options={['cover', 'contain', 'stretch']} onChange={(v) => onProp(['fit'], v)} />)}
          {row(
            'Focus',
            'focus',
            <span className="inline">
              x <NumIn value={layer.focus?.[0] ?? 0.5} step={0.05} onChange={(v) => onProp(['focus'], [v, layer.focus?.[1] ?? 0.5])} />
              y <NumIn value={layer.focus?.[1] ?? 0.5} step={0.05} onChange={(v) => onProp(['focus'], [layer.focus?.[0] ?? 0.5, v])} />
            </span>,
          )}
          {row('Corner radius', 'radius', <NumIn value={layer.radius ?? 0} onChange={(v) => onProp(['radius'], v || undefined)} />)}
        </>
      )}

      {layer.type === 'shape' && (
        <>
          {row(
            'Shape',
            'shape',
            <Seg
              value={layer.shape}
              options={['rect', 'roundrect', 'ellipse', 'polygon']}
              onChange={(v) => {
                if (v === 'polygon' && !layer.points) {
                  const [x, y, w, h] = layer.rect ?? [100, 100, 200, 200];
                  onProp(['points'], [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
                }
                if (v !== 'polygon' && !layer.rect && layer.points) {
                  const xs = layer.points.map((p) => p[0]);
                  const ys = layer.points.map((p) => p[1]);
                  onProp(['rect'], [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]);
                }
                onProp(['shape'], v);
              }}
            />,
          )}
          {layer.shape === 'roundrect' && row('Corner radius', 'radius', <NumIn value={layer.radius ?? 0} onChange={(v) => onProp(['radius'], v)} />)}
          {row('Fill', 'fill', <PaintIn value={layer.fill} onChange={(v) => onProp(['fill'], v)} />)}
          {row(
            'Outline',
            'stroke',
            <OptionalGroup on={!!layer.stroke} onToggle={(on) => onProp(['stroke'], on ? { color: '#000000', width: 4 } : undefined)}>
              {layer.stroke && (
                <>
                  <ColorIn value={layer.stroke.color} onChange={(v) => onProp(['stroke', 'color'], v)} />
                  <NumIn value={layer.stroke.width} onChange={(v) => onProp(['stroke', 'width'], v)} />
                </>
              )}
            </OptionalGroup>,
          )}
          {layer.shape === 'polygon' && <p className="hint">Drag the points on the card. Double-click an edge to add a point; Alt+click a point to remove it.</p>}
        </>
      )}

      {layer.type === 'icons' && (
        <>
          {row(
            'Icons',
            'icons',
            <TemplateTextIn value={layer.icons ?? ''} onChange={(v) => onProp(['icons'], v || undefined)} fields={fieldIds} placeholder="{element}  (comma-separated names)" />,
          )}
          {row(
            'Or repeat',
            'repeat',
            <OptionalGroup on={!!layer.repeat} onToggle={(on) => onProp(['repeat'], on ? { icon: Object.keys(game.def.icons ?? {}).find((k) => k !== 'aliases') ?? '', count: '{cost}' } : undefined)}>
              {layer.repeat && (
                <>
                  <TextIn value={layer.repeat.icon} onChange={(v) => onProp(['repeat', 'icon'], v)} placeholder="icon" />×
                  <TextIn value={layer.repeat.count} onChange={(v) => onProp(['repeat', 'count'], v)} placeholder="{cost}" />
                </>
              )}
            </OptionalGroup>,
          )}
          {row('Icon size', 'size', <NumIn value={layer.size ?? 0} onChange={(v) => onProp(['size'], v || undefined)} />)}
          {row('Gap', 'gap', <NumIn value={layer.gap ?? 0} onChange={(v) => onProp(['gap'], v || undefined)} />)}
          {row('Direction', 'direction', <Seg value={layer.direction ?? 'row'} options={['row', 'column']} onChange={(v) => onProp(['direction'], v)} />)}
          {row('Align', 'align', <Seg value={layer.align ?? 'center'} options={['start', 'center', 'end']} onChange={(v) => onProp(['align'], v)} />)}
        </>
      )}

      {layer.type === 'group' && (
        <>
          {row(
            'Offset',
            'offset',
            <span className="inline">
              x <NumIn value={layer.offset?.[0] ?? 0} onChange={(v) => onProp(['offset'], [v, layer.offset?.[1] ?? 0])} />
              y <NumIn value={layer.offset?.[1] ?? 0} onChange={(v) => onProp(['offset'], [layer.offset?.[0] ?? 0, v])} />
            </span>,
          )}
          <p className="hint">Add layers inside the group with “+ Add…” while the group is selected. Clip shapes can be set in the JSON below.</p>
        </>
      )}

      {'rect' in layer && layer.rect && row('Position', 'rect', <RectIn value={layer.rect} onChange={(v) => onProp(['rect'], v)} />)}
      {row('Opacity', 'opacity', <NumIn value={layer.opacity ?? 1} step={0.05} onChange={(v) => onProp(['opacity'], v >= 1 ? undefined : Math.max(0, v))} />)}
      {row('Rotate °', 'rotate', <NumIn value={layer.rotate ?? 0} onChange={(v) => onProp(['rotate'], v || undefined)} />)}
      {row(
        'Blend',
        'blend',
        <select value={layer.blend ?? 'source-over'} onChange={(e) => onProp(['blend'], e.target.value === 'source-over' ? undefined : e.target.value)}>
          {['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'soft-light', 'hard-light', 'difference', 'luminosity'].map((b) => (
            <option key={b} value={b}>
              {b === 'source-over' ? 'normal' : b}
            </option>
          ))}
        </select>,
      )}

      <JsonEntry own={own} layerId={layer.id} inherited={inherited} onApply={onReplaceOwn} />
    </div>
  );
}

export function NumIn({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      className="num"
      step={step}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export function TextIn({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function exprError(src: string, wrap: boolean): string | null {
  try {
    if (wrap) for (const p of splitInterpolation(src)) typeof p !== 'string' && compile(p.expr);
    else if (src.trim()) compile(src);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function ExprIn({ value, onChange, placeholder, fields }: { value: string; onChange: (v: string) => void; placeholder?: string; fields: string[] }) {
  const err = exprError(value, false);
  return (
    <div className="expr">
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} list="field-list" className={err ? 'bad' : ''} />
      <datalist id="field-list">
        {fields.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function TemplateTextIn({ value, onChange, fields, placeholder }: { value: string; onChange: (v: string) => void; fields: string[]; placeholder?: string }) {
  const err = exprError(value, true);
  return (
    <div className="expr">
      <textarea rows={Math.min(5, Math.max(1, value.split('\n').length))} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={err ? 'bad' : ''} />
      <select
        className="insert"
        value=""
        onChange={(e) => {
          if (e.target.value) onChange(value + `{${e.target.value}}`);
        }}
        title="Insert a field"
      >
        <option value="">+ field</option>
        {[...fields, 'template.name', 'card.number', 'card.total', 'set.name', 'set.code', 'game.name'].map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function Seg({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <span className="seg">
      {options.map((o) => (
        <button key={o} className={o === value ? 'active' : ''} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </span>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;
export function ColorIn({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="inline color">
      <input type="color" value={HEX.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} title="Pick a colour" />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

function PaintIn({ value, onChange }: { value: Paint | undefined; onChange: (v: Paint | undefined) => void }) {
  if (value === undefined || typeof value === 'string')
    return (
      <span className="inline">
        <ColorIn value={value ?? 'none'} onChange={(v) => onChange(v)} />
        <button
          title="Use a gradient"
          onClick={() => onChange({ type: 'linear', angle: 90, stops: [[0, typeof value === 'string' && HEX.test(value) ? value : '#ffffff'], [1, '#888888']] })}
        >
          ▤
        </button>
      </span>
    );
  return (
    <div className="gradient">
      <span className="inline">
        <Seg value={value.type} options={['linear', 'radial']} onChange={(t) => onChange({ ...value, type: t as 'linear' })} />
        {value.type === 'linear' && (
          <>
            angle <NumIn value={value.angle ?? 90} onChange={(a) => onChange({ ...value, angle: a })} />
          </>
        )}
        <button title="Use a single colour" onClick={() => onChange(value.stops[0]?.[1] ?? '#ffffff')}>
          ■
        </button>
      </span>
      {value.stops.map(([o, c], i) => (
        <span key={i} className="inline">
          <NumIn value={o} step={0.05} onChange={(n) => onChange({ ...value, stops: value.stops.map((s, j) => (j === i ? [n, s[1]] : s)) })} />
          <ColorIn value={c} onChange={(col) => onChange({ ...value, stops: value.stops.map((s, j) => (j === i ? [s[0], col] : s)) })} />
          {value.stops.length > 2 && <button onClick={() => onChange({ ...value, stops: value.stops.filter((_, j) => j !== i) })}>✕</button>}
        </span>
      ))}
      <button onClick={() => onChange({ ...value, stops: [...value.stops, [1, '#000000']] })}>+ stop</button>
    </div>
  );
}

function FontIn({ value, families, onChange }: { value: { family: string; size: number; weight?: number; style?: string }; families: string[]; onChange: (k: string, v: unknown) => void }) {
  return (
    <div className="font-in">
      <input type="text" list="font-list" value={value?.family ?? ''} onChange={(e) => onChange('family', e.target.value)} />
      <datalist id="font-list">
        {families.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <span className="inline">
        size <NumIn value={value?.size ?? 24} onChange={(v) => onChange('size', v)} />
        <select value={value?.weight ?? 400} onChange={(e) => onChange('weight', Number(e.target.value) === 400 ? undefined : Number(e.target.value))}>
          {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
            <option key={w} value={w}>
              {w === 400 ? 'regular' : w === 700 ? 'bold' : w}
            </option>
          ))}
        </select>
        <label className="inline">
          <input type="checkbox" checked={value?.style === 'italic'} onChange={(e) => onChange('style', e.target.checked ? 'italic' : undefined)} /> italic
        </label>
      </span>
    </div>
  );
}

function RectIn({ value, onChange }: { value: Rect; onChange: (v: Rect) => void }) {
  const set = (i: number, n: number) => onChange(value.map((v, j) => (j === i ? n : v)) as Rect);
  return (
    <span className="inline rect-in">
      x <NumIn value={value[0]} onChange={(n) => set(0, n)} />
      y <NumIn value={value[1]} onChange={(n) => set(1, n)} />
      w <NumIn value={value[2]} onChange={(n) => set(2, n)} />
      h <NumIn value={value[3]} onChange={(n) => set(3, n)} />
    </span>
  );
}

function OptionalGroup({ on, onToggle, children }: { on: boolean; onToggle: (on: boolean) => void; children: ReactNode }) {
  return (
    <span className="inline">
      <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
      {children}
    </span>
  );
}

function JsonEntry({ own, layerId, inherited, onApply }: { own: LayerPatch | null; layerId: string; inherited: boolean; onApply: (e: LayerPatch | null) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(JSON.stringify(own ?? { id: layerId }, null, 2));
    setErr(null);
  }, [own, layerId]);
  return (
    <details className="json-entry" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>JSON {inherited ? '(this template’s overrides)' : ''}</summary>
      <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {err && <div className="err">{err}</div>}
      <button
        onClick={() => {
          try {
            const v = JSON.parse(text) as LayerPatch;
            if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('Expected an object');
            if (v.id !== layerId) throw new Error(`"id" must stay "${layerId}"`);
            onApply(inherited && Object.keys(v).length === 1 ? null : v);
            setErr(null);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        Apply JSON
      </button>
    </details>
  );
}

export type { Pt };
