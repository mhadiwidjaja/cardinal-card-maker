import { useEffect, useState } from 'react';
import { toText } from '../../expr/expr';
import { cardResolver } from '../../model/cardContext';
import { cardProblems } from '../../model/cardOps';
import { framingColumn } from '../../model/framing';
import type { Card, CardSet, Field, Game } from '../../model/types';
import { splitList } from '../../expr/expr';
import { keys } from '../keys';

interface Props {
  game: Game;
  set: CardSet;
  card: Card;
  readOnly: boolean;
  imageFiles: string[];
  onValue: (column: string, value: string) => void;
}

export function CardInspector({ game, set, card, readOnly, imageFiles, onValue }: Props) {
  const problems = cardProblems(game, card);
  const resolve = cardResolver(game, card, set);
  const templates = Object.values(game.templates)
    .filter((t) => !t.abstract)
    .map((t) => t.id);

  return (
    <div className="inspector-body">
      <div className="insp-head">
        <span className="slug">Card</span>
        <code className="muted">{card.id}</code>
      </div>
      <form className="insp-fields" onSubmit={(e) => e.preventDefault()}>
        {game.def.fields.map((f) => {
          const label = f.label ?? f.id;
          const problem = problems.get(f.id);
          let computed = '';
          if (f.computed) {
            try {
              computed = toText(resolve(f.id) ?? '');
            } catch (e) {
              computed = `⚠ ${(e as Error).message}`;
            }
          }
          return (
            <div key={f.id} className={'insp-field' + (problem ? ' bad' : '') + (f.type === 'richtext' ? ' wide' : '')}>
              <label htmlFor={`insp-${f.id}`} className="slug">
                {label}
                {f.computed && <span className="muted"> =</span>}
              </label>
              {f.computed ? (
                <output id={`insp-${f.id}`} className="insp-computed mono" title={`= ${f.computed}`}>
                  {computed || '—'}
                </output>
              ) : (
                <FieldInput
                  id={`insp-${f.id}`}
                  field={f}
                  value={card.values[f.id] ?? ''}
                  readOnly={readOnly}
                  templates={templates}
                  imageFiles={imageFiles}
                  onValue={(v) => onValue(f.id, v)}
                />
              )}
              {f.type === 'image' && card.values[framingColumn(f.id)] && !readOnly && (
                <button type="button" className="insp-link" onClick={() => onValue(framingColumn(f.id), '')} title="Go back to the template's framing">
                  Reset art framing ({card.values[framingColumn(f.id)]})
                </button>
              )}
              {problem && <span className="insp-problem">{problem}</span>}
            </div>
          );
        })}
      </form>
    </div>
  );
}

function FieldInput({ id, field, value, readOnly, templates, imageFiles, onValue }: { id: string; field: Field; value: string; readOnly: boolean; templates: string[]; imageFiles: string[]; onValue: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (v: string = draft) => {
    if (v !== value) onValue(v);
  };

  if (field.type === 'choice') {
    const options = field.source === 'templates' ? templates : (field.choices ?? []);
    return (
      <select id={id} value={value} disabled={readOnly} onChange={(e) => onValue(e.target.value)}>
        <option value="">—</option>
        {!options.includes(value) && value && <option value={value}>{value} (not in the list)</option>}
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'multi') {
    const picked = new Set(splitList(value).map((v) => v.toLowerCase()));
    const toggle = (c: string) => {
      const next = (field.choices ?? []).filter((x) => (x === c ? !picked.has(x.toLowerCase()) : picked.has(x.toLowerCase())));
      onValue(next.join(', '));
    };
    return (
      <div className="insp-multi" id={id} role="group">
        {(field.choices ?? []).map((c) => (
          <label key={c} className="chip">
            <input type="checkbox" disabled={readOnly} checked={picked.has(c.toLowerCase())} onChange={() => toggle(c)} /> {c}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === 'boolean') {
    const on = /^(true|yes|1|y|x)$/i.test(value.trim());
    return (
      <label className="chip">
        <input id={id} type="checkbox" disabled={readOnly} checked={on} onChange={(e) => onValue(e.target.checked ? 'true' : 'false')} /> {on ? 'yes' : 'no'}
      </label>
    );
  }
  if (field.type === 'color') {
    const hex = /^#[0-9a-f]{6}$/i.test(draft) ? draft : '#000000';
    return (
      <span className="inline">
        <input type="color" value={hex} disabled={readOnly} onChange={(e) => onValue(e.target.value)} aria-label={`${field.id} colour`} />
        <input id={id} type="text" className="mono" value={draft} readOnly={readOnly} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit()} />
      </span>
    );
  }
  if (field.type === 'richtext') {
    return (
      <textarea
        id={id}
        rows={Math.min(8, Math.max(3, draft.split('\n').length + 1))}
        spellCheck
        value={draft}
        readOnly={readOnly}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
          if (e.key === 'Escape') setDraft(value);
        }}
        title={keys('Ctrl+Enter or leaving the field saves; Esc undoes your typing')}
      />
    );
  }
  return (
    <>
      <input
        id={id}
        type="text"
        className={field.type === 'number' ? 'mono' : undefined}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        list={field.type === 'image' ? `${id}-files` : undefined}
        spellCheck={field.type === 'text'}
        value={draft}
        readOnly={readOnly}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(value);
        }}
      />
      {field.type === 'image' && (
        <datalist id={`${id}-files`}>
          {imageFiles.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      )}
    </>
  );
}
