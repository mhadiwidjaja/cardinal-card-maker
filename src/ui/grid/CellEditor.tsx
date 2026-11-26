import { useEffect, useRef, useState } from 'react';
import type { Field } from '../../model/types';

interface Props {
  field?: Field;
  column: string;
  initial: string;
  replace: boolean;
  templates: string[];
  imageFiles: string[];
  onCommit: (value: string, then?: { dr: number; dc: number }) => void;
  onCancel: () => void;
}

/**
 * In-cell editor. Enter commits and moves down, Tab moves right, Escape
 * cancels. In multi-line text, Shift+Enter or Alt+Enter adds a line break.
 */
export function CellEditor({ field, initial, replace, templates, imageFiles, onCommit, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if ('setSelectionRange' in el && typeof el.value === 'string' && el.tagName !== 'SELECT') {
      const end = el.value.length;
      try {
        el.setSelectionRange(replace ? end : 0, end);
      } catch {}
    }
  }, [replace]);

  const commit = (v: string, then?: { dr: number; dc: number }) => {
    if (done.current) return;
    done.current = true;
    onCommit(v, then);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  const keys = (e: React.KeyboardEvent, multiline: boolean) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && !(multiline && (e.shiftKey || e.altKey))) {
      e.preventDefault();
      commit(value, { dr: e.shiftKey ? -1 : 1, dc: 0 });
    } else if (e.key === 'Enter' && multiline && e.altKey) {
      e.preventDefault();
      const el = e.target as HTMLTextAreaElement;
      const s = el.selectionStart;
      const next = value.slice(0, s) + '\n' + value.slice(el.selectionEnd);
      setValue(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 1, s + 1));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commit(value, { dr: 0, dc: e.shiftKey ? -1 : 1 });
    }
    e.stopPropagation();
  };

  const choices = field?.source === 'templates' ? templates : field?.type === 'boolean' ? ['yes', 'no'] : field?.type === 'choice' ? (field.choices ?? []) : null;

  if (choices && !replace) {
    const known = choices.some((c) => c.toLowerCase() === value.toLowerCase());
    return (
      <select
        ref={ref}
        className="cell-editor"
        value={known ? choices.find((c) => c.toLowerCase() === value.toLowerCase()) : value}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => keys(e, false)}
        onBlur={() => commit(value)}
      >
        <option value="">(empty)</option>
        {!known && value && <option value={value}>{value} (not valid)</option>}
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    );
  }

  if (field?.type === 'multi' && field.choices && !replace) {
    const picked = new Set(value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    const toggle = (c: string) => {
      const next = field.choices!.filter((x) => (x === c ? !picked.has(x.toLowerCase()) : picked.has(x.toLowerCase())));
      setValue(next.join(', '));
    };
    return (
      <div
        className="cell-editor multi"
        tabIndex={-1}
        ref={ref as never}
        onKeyDown={(e) => keys(e, false)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) commit(value);
        }}
      >
        {field.choices.map((c) => (
          <label key={c}>
            <input type="checkbox" checked={picked.has(c.toLowerCase())} onChange={() => toggle(c)} /> {c}
          </label>
        ))}
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => commit(value)}>
          OK
        </button>
      </div>
    );
  }

  const multiline = field?.type === 'richtext' || (field?.type === 'text' && (value.includes('\n') || value.length > 60));
  if (multiline) {
    return (
      <div className="cell-editor area">
        <textarea
          ref={ref}
          value={value}
          rows={Math.min(10, Math.max(3, value.split('\n').length + 1))}
          spellCheck
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => keys(e, true)}
          onBlur={() => commit(value)}
        />
        <div className="cell-hint">Enter = done · Shift/Alt+Enter = new line · Esc = cancel</div>
      </div>
    );
  }

  return (
    <>
      <input
        ref={ref}
        className="cell-editor"
        type="text"
        value={value}
        list={field?.type === 'image' ? 'image-files' : undefined}
        spellCheck={field?.type === 'text' || field?.type === 'richtext'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => keys(e, false)}
        onBlur={() => commit(value)}
      />
      {field?.type === 'image' && (
        <datalist id="image-files">
          {imageFiles.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      )}
    </>
  );
}
