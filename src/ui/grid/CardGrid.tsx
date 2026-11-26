import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react';
import { toText } from '../../expr/expr';
import { cardResolver } from '../../model/cardContext';
import { cardProblems, fromTsv, toTsv } from '../../model/cardOps';
import type { Card, CardSet, Field, Game } from '../../model/types';
import { CellEditor } from './CellEditor';
import { readStored, writeStored } from '../stored';

export interface Column {
  id: string;
  label: string;
  field?: Field;
  readOnly: boolean;
}

export interface CellChange {
  card: number;
  column: string;
  value: string;
}

interface Props {
  game: Game;
  set: CardSet;
  columns: Column[];
  rows: number[];
  focusCard: number | null;
  onFocusCard: (card: number) => void;
  onChange: (changes: CellChange[], extraRows?: string[][]) => void;
  sort: { column: string; dir: 1 | -1 } | null;
  onSort: (column: string) => void;
  imageFiles: string[];
  readOnly: boolean;
}

interface Pos {
  r: number;
  c: number;
}

const WIDTH_KEY = 'card-maker:colwidths:';

export function CardGrid(props: Props) {
  const { game, set, columns, rows, focusCard, onFocusCard, onChange, sort, onSort, imageFiles, readOnly } = props;
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  // The focused row is the focused card (owned by the parent); only the column is local.
  const [focusC, setFocusC] = useState(0);
  const fr = focusCard === null ? -1 : rows.indexOf(focusCard);
  const focus: Pos = { r: Math.max(0, fr), c: Math.min(focusC, Math.max(0, columns.length - 1)) };
  const setFocus = (p: Pos) => {
    setFocusC(p.c);
    const card = rows[p.r];
    if (card !== undefined && card !== focusCard) onFocusCard(card);
  };
  const [editing, setEditing] = useState<{ pos: Pos; initial: string; replace: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Where the mouse went down. Clicking a half-hidden cell scrolls the grid under a still mouse,
  // which fires pointerenter on the neighbouring cell; only a real mouse move extends the selection.
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>(() => readStored(WIDTH_KEY + game.def.name, {}));
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fr === -1 && rows.length) onFocusCard(rows[0]!);
    setAnchor((a) => ({ r: Math.max(0, Math.min(a.r, rows.length - 1)), c: Math.max(0, Math.min(a.c, columns.length - 1)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns.length]);

  useEffect(() => {
    gridRef.current?.querySelector(`[data-pos="${focus.r}:${focus.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focus]);

  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [dragging]);

  const problems = useMemo(() => set.cards.map((c) => cardProblems(game, c)), [game, set]);
  const computed = useMemo(() => {
    const cols = columns.filter((c) => c.field?.computed);
    if (!cols.length) return null;
    return set.cards.map((card) => {
      const r = cardResolver(game, card, set);
      const out: Record<string, string> = {};
      for (const c of cols) out[c.id] = toText(r(c.id) ?? '');
      return out;
    });
  }, [columns, game, set]);

  const sel = {
    r0: Math.min(anchor.r, focus.r),
    r1: Math.max(anchor.r, focus.r),
    c0: Math.min(anchor.c, focus.c),
    c1: Math.max(anchor.c, focus.c),
  };
  const inSel = (r: number, c: number) => r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;

  const cellValue = (r: number, c: number): string => {
    const card = set.cards[rows[r]!];
    const col = columns[c];
    if (!card || !col) return '';
    if (col.field?.computed) return computed?.[rows[r]!]?.[col.id] ?? '';
    return col.id === 'id' ? card.id : (card.values[col.id] ?? '');
  };

  const move = (dr: number, dc: number, extend: boolean) => {
    const next = { r: Math.max(0, Math.min(rows.length - 1, focus.r + dr)), c: Math.max(0, Math.min(columns.length - 1, focus.c + dc)) };
    setFocus(next);
    if (!extend) setAnchor(next);
  };

  const startEdit = (pos: Pos, initial?: string) => {
    const col = columns[pos.c];
    if (readOnly || !col || col.readOnly || rows[pos.r] === undefined) return;
    setEditing({ pos, initial: initial ?? cellValue(pos.r, pos.c), replace: initial !== undefined });
  };

  const commitEdit = (value: string, then?: { dr: number; dc: number }) => {
    if (!editing) return;
    const { pos } = editing;
    setEditing(null);
    if (value !== cellValue(pos.r, pos.c)) onChange([{ card: rows[pos.r]!, column: columns[pos.c]!.id, value }]);
    if (then) move(then.dr, then.dc, false);
    gridRef.current?.focus();
  };

  const selectedCells = (): CellChange[] => {
    const out: CellChange[] = [];
    for (let r = sel.r0; r <= sel.r1; r++)
      for (let c = sel.c0; c <= sel.c1; c++) {
        const col = columns[c]!;
        if (!col.readOnly) out.push({ card: rows[r]!, column: col.id, value: '' });
      }
    return out;
  };

  const copyText = () => {
    const out: string[][] = [];
    for (let r = sel.r0; r <= sel.r1; r++) {
      const row: string[] = [];
      for (let c = sel.c0; c <= sel.c1; c++) row.push(cellValue(r, c));
      out.push(row);
    }
    return toTsv(out);
  };

  const paste = (text: string) => {
    if (readOnly) return;
    const data = fromTsv(text);
    if (data.length === 0) return;
    const changes: CellChange[] = [];
    const extra: string[][] = [];
    if (data.length === 1 && data[0]!.length === 1 && (sel.r1 > sel.r0 || sel.c1 > sel.c0)) {
      for (const c of selectedCells()) changes.push({ ...c, value: data[0]![0]! });
    } else {
      data.forEach((row, dr) => {
        const r = focus.r + dr;
        if (r >= rows.length) {
          const values: string[] = [];
          row.forEach((v, dc) => (values[focus.c + dc] = v));
          extra.push(columns.map((_, i) => values[i] ?? ''));
          return;
        }
        row.forEach((v, dc) => {
          const col = columns[focus.c + dc];
          if (col && !col.readOnly) changes.push({ card: rows[r]!, column: col.id, value: v });
        });
      });
    }
    onChange(changes, extra.length ? extra : undefined);
  };

  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (k === 'ArrowUp') move(ctrl ? -rows.length : -1, 0, e.shiftKey);
    else if (k === 'ArrowDown') move(ctrl ? rows.length : 1, 0, e.shiftKey);
    else if (k === 'ArrowLeft') move(0, ctrl ? -columns.length : -1, e.shiftKey);
    else if (k === 'ArrowRight') move(0, ctrl ? columns.length : 1, e.shiftKey);
    else if (k === 'Tab') move(0, e.shiftKey ? -1 : 1, false);
    else if (k === 'Home') move(ctrl ? -rows.length : 0, -columns.length, e.shiftKey);
    else if (k === 'End') move(ctrl ? rows.length : 0, columns.length, e.shiftKey);
    else if (k === 'PageDown') move(15, 0, e.shiftKey);
    else if (k === 'PageUp') move(-15, 0, e.shiftKey);
    else if (k === 'Enter' || k === 'F2') startEdit(focus);
    else if ((k === 'Delete' || k === 'Backspace') && !readOnly) onChange(selectedCells());
    else if (ctrl && k.toLowerCase() === 'a') {
      setAnchor({ r: 0, c: 0 });
      setFocus({ r: rows.length - 1, c: columns.length - 1 });
    } else if (ctrl && k.toLowerCase() === 'd' && !readOnly && sel.r1 > sel.r0) {
      const changes: CellChange[] = [];
      for (let c = sel.c0; c <= sel.c1; c++) {
        const col = columns[c]!;
        if (col.readOnly) continue;
        const v = cellValue(sel.r0, c);
        for (let r = sel.r0 + 1; r <= sel.r1; r++) changes.push({ card: rows[r]!, column: col.id, value: v });
      }
      onChange(changes);
    } else if (!ctrl && !e.altKey && k.length === 1) {
      startEdit(focus, k);
    } else return;
    e.preventDefault();
  };

  const setWidth = (id: string, w: number) => {
    setWidths((prev) => {
      const next = { ...prev, [id]: Math.max(40, Math.round(w)) };
      writeStored(WIDTH_KEY + game.def.name, next);
      return next;
    });
  };

  const startResize = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).parentElement!;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const onMove = (ev: PointerEvent) => setWidth(id, startW + ev.clientX - startX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className="grid"
      tabIndex={0}
      ref={gridRef}
      onKeyDown={onKeyDown}
      onCopy={(e) => {
        if (editing) return;
        e.clipboardData.setData('text/plain', copyText());
        e.preventDefault();
      }}
      onCut={(e) => {
        if (editing || readOnly) return;
        e.clipboardData.setData('text/plain', copyText());
        onChange(selectedCells());
        e.preventDefault();
      }}
      onPaste={(e) => {
        if (editing) return;
        paste(e.clipboardData.getData('text/plain'));
        e.preventDefault();
      }}
    >
      <table>
        <colgroup>
          <col style={{ width: 44 }} />
          {columns.map((c) => (
            <col key={c.id} style={{ width: widths[c.id] ?? defaultWidth(c) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="rownum">#</th>
            {columns.map((c, ci) => (
              <th
                key={c.id}
                className={(c.field ? '' : 'unknown ') + (c.readOnly ? 'ro ' : '') + (ci >= sel.c0 && ci <= sel.c1 ? 'hl' : '')}
                title={c.field ? `${c.field.type}${c.field.computed ? ` = ${c.field.computed}` : ''}${c.field.choices ? `: ${c.field.choices.join(', ')}` : ''}` : c.id === 'id' ? 'Card id' : 'Not defined in game.json'}
                onClick={() => onSort(c.id)}
              >
                {c.label}
                {sort?.column === c.id && <span className="sort">{sort.dir === 1 ? ' ▲' : ' ▼'}</span>}
                <span className="resize" onPointerDown={(e) => startResize(e, c.id)} onClick={(e) => e.stopPropagation()} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cardIdx, r) => {
            const card: Card = set.cards[cardIdx]!;
            const probs = problems[cardIdx]!;
            return (
              <tr key={card.id + ':' + cardIdx} className={r === focus.r ? 'focus-row' : ''}>
                <td
                  className={'rownum' + (probs.size ? ' bad' : '')}
                  title={probs.size ? [...probs.values()].join('\n') : undefined}
                  onPointerDown={(e) => {
                    setAnchor({ r: e.shiftKey ? anchor.r : r, c: 0 });
                    setFocus({ r, c: columns.length - 1 });
                    gridRef.current?.focus();
                  }}
                >
                  {cardIdx + 1}
                </td>
                {columns.map((col, c) => {
                  const v = cellValue(r, c);
                  const problem = probs.get(col.id);
                  const isFocus = r === focus.r && c === focus.c;
                  const isEditing = editing && editing.pos.r === r && editing.pos.c === c;
                  return (
                    <td
                      key={col.id}
                      data-pos={`${r}:${c}`}
                      className={(inSel(r, c) ? 'sel ' : '') + (isFocus ? 'focus ' : '') + (problem ? 'bad ' : '') + (col.readOnly ? 'ro ' : '')}
                      title={problem ?? (v.length > 40 || v.includes('\n') ? v : undefined)}
                      onPointerDown={(e) => {
                        if (isEditing || e.button !== 0) return;
                        const p = { r, c };
                        setFocus(p);
                        if (!e.shiftKey) setAnchor(p);
                        setDragging(true);
                        downAt.current = { x: e.clientX, y: e.clientY };
                        gridRef.current?.focus();
                      }}
                      onPointerEnter={(e) => {
                        const d = downAt.current;
                        if (!dragging || (d && Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4)) return;
                        setFocus({ r, c });
                      }}
                      onDoubleClick={() => startEdit({ r, c })}
                    >
                      {isEditing ? (
                        <CellEditor
                          field={col.field}
                          column={col.id}
                          initial={editing.initial}
                          replace={editing.replace}
                          templates={Object.values(game.templates).filter((t) => !t.abstract).map((t) => t.id)}
                          imageFiles={imageFiles}
                          onCommit={commitEdit}
                          onCancel={() => {
                            setEditing(null);
                            gridRef.current?.focus();
                          }}
                        />
                      ) : (
                        <span className="cell">{display(v)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted empty-grid">No cards{set.cards.length ? ' match the filter' : ' yet'}.</p>}
    </div>
  );
}

function display(v: string): string {
  const nl = v.indexOf('\n');
  return nl === -1 ? v : v.slice(0, nl) + ' ↵ …';
}

function defaultWidth(c: Column): number {
  if (c.id === 'id') return 70;
  switch (c.field?.type) {
    case 'number':
    case 'boolean':
      return 70;
    case 'richtext':
      return 320;
    case 'text':
      return c.field.identifying ? 170 : 150;
    case 'multi':
      return 130;
    default:
      return 110;
  }
}
