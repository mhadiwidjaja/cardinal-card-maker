import { useState } from 'react';
import { importRows, type ImportChange, type ImportMode, type ImportReport } from '../../model/cardOps';
import { decodeCsvBytes, parseCsv } from '../../model/csv';
import type { CardSet, Game } from '../../model/types';
import { readXlsx } from '../../model/xlsx';
import { keys } from '../keys';

interface Props {
  game: Game;
  set: CardSet;
  onImport: (set: CardSet, report: ImportReport) => void;
  onClose: () => void;
}

const MAX_LINES = 200;

function cellText(v: string): string {
  const one = v.replace(/\r?\n/g, ' ⏎ ');
  return one.length > 60 ? one.slice(0, 59) + '…' : one;
}

function ChangeList({ changes }: { changes: ImportChange[] }) {
  if (changes.length === 0) return <p className="muted small">Nothing would change.</p>;
  return (
    <ul className="import-changes" aria-label="Changes">
      {changes.slice(0, MAX_LINES).map((c, i) => (
        <li key={i} className={c.kind}>
          {c.kind === 'added' && (
            <>
              + <b>{c.card}</b> <span className="muted">new card</span>
            </>
          )}
          {c.kind === 'removed' && (
            <>
              − <b>{c.card}</b> <span className="muted">removed</span>
            </>
          )}
          {c.kind === 'changed' && (
            <>
              <b>{c.card}</b> · {c.field}: <s>{cellText(c.from) || '(empty)'}</s> → {cellText(c.to) || '(empty)'}
            </>
          )}
        </li>
      ))}
      {changes.length > MAX_LINES && <li className="muted">…and {changes.length - MAX_LINES} more</li>}
    </ul>
  );
}

export function ImportDialog({ game, set, onImport, onClose }: Props) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [error, setError] = useState<string | null>(null);
  const [encodingNote, setEncodingNote] = useState<string | null>(null);

  async function load(file: File) {
    setError(null);
    setEncodingNote(null);
    setFileName(file.name);
    try {
      if (/\.xlsx$/i.test(file.name)) setRows(readXlsx(new Uint8Array(await file.arrayBuffer())));
      else if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        const { text, encoding } = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
        if (encoding !== 'utf-8') {
          setEncodingNote(
            'This file is not UTF-8 (probably saved from Excel as plain "CSV"), so it was read as Windows Western text. Check accented letters and symbols in the list below before importing.',
          );
        }
        const t = parseCsv(/\.tsv$/i.test(file.name) ? text.replace(/\t/g, ',') : text);
        setRows([t.columns, ...t.rows.map((r) => t.columns.map((c) => r[c] ?? ''))]);
      } else throw new Error('Choose a .csv or .xlsx file');
    } catch (e) {
      setRows(null);
      setError((e as Error).message);
    }
  }

  const preview = rows ? importRows(game, set, rows, mode) : null;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import cards into “{set.def.name}”</h3>
        <input type="file" accept=".csv,.xlsx,.tsv,.txt" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        {error && <p className="err">{error}</p>}
        {encodingNote && <p className="warn-inline">{encodingNote}</p>}
        {rows && preview && (
          <>
            <p>
              <strong>{fileName}</strong>: {rows.length - 1} rows, columns: {rows[0]?.join(', ')}
            </p>
            <fieldset>
              <label>
                <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> <strong>Update and add</strong>: rows with a known <code>id</code> update that card;
                others are added
              </label>
              <label>
                <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> <strong>Add</strong> all rows as new cards
              </label>
              <label>
                <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> <strong>Replace</strong> all {set.cards.length} cards in this set
              </label>
            </fieldset>
            <p>
              Result: {preview.report.added} added, {preview.report.updated} updated{preview.report.removed ? `, ${preview.report.removed} removed` : ''}.
              {preview.report.unknownColumns.length > 0 && (
                <span className="warn-inline"> Columns not in game.json (kept as extra columns): {preview.report.unknownColumns.join(', ')}</span>
              )}
            </p>
            <ChangeList changes={preview.report.changes} />
          </>
        )}
        <div className="modal-buttons">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!preview} onClick={() => preview && onImport(preview.set, preview.report)}>
            Import
          </button>
        </div>
        <p className="muted small">You can undo an import with {keys('Ctrl+Z')}. Nothing is written to disk until you save.</p>
      </div>
    </div>
  );
}
