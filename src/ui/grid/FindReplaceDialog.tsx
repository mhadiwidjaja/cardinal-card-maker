import { useState } from 'react';
import { findReplace, searchableColumns, type FindOptions } from '../../model/findReplace';
import type { CardSet, Game } from '../../model/types';
import { useEscape } from '../useEscape';
import { keys } from '../keys';

interface Props {
  game: Game;
  set: CardSet;
  filtered: number[] | null;
  onReplace: (changed: Map<number, Record<string, string>>, matches: number) => void;
  onClose: () => void;
}

export function FindReplaceDialog({ game, set, filtered, onReplace, onClose }: Props) {
  useEscape(onClose);
  const [o, setO] = useState<FindOptions>({ find: '', replace: '', column: null, matchCase: false, wholeWord: false, only: null });
  const [onlyFiltered, setOnlyFiltered] = useState(filtered !== null);
  const opts = { ...o, only: onlyFiltered ? filtered : null };
  const result = findReplace(game, set, opts);
  const label = (id: string) => game.def.fields.find((f) => f.id === id)?.label ?? id;

  return (
    <div className="modal-back" onClick={onClose}>
      <div
        className="modal find-replace"
        role="dialog"
        aria-label="Find and replace"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h3>Find and replace in “{set.def.name}”</h3>
        <label className="fr-row">
          <span>Find</span>
          <input type="text" autoFocus value={o.find} onChange={(e) => setO({ ...o, find: e.target.value })} aria-label="Find" />
        </label>
        <label className="fr-row">
          <span>Replace with</span>
          <input type="text" value={o.replace} onChange={(e) => setO({ ...o, replace: e.target.value })} aria-label="Replace with" />
        </label>
        <label className="fr-row">
          <span>In</span>
          <select value={o.column ?? ''} onChange={(e) => setO({ ...o, column: e.target.value || null })} aria-label="In column">
            <option value="">All fields</option>
            {searchableColumns(game).map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </label>
        <div className="fr-checks">
          <label>
            <input type="checkbox" checked={o.matchCase} onChange={(e) => setO({ ...o, matchCase: e.target.checked })} /> Match case
          </label>
          <label>
            <input type="checkbox" checked={o.wholeWord} onChange={(e) => setO({ ...o, wholeWord: e.target.checked })} /> Whole words only
          </label>
          {filtered && (
            <label>
              <input type="checkbox" checked={onlyFiltered} onChange={(e) => setOnlyFiltered(e.target.checked)} /> Only the {filtered.length} filtered cards
            </label>
          )}
        </div>
        <p className="muted" aria-live="polite">
          {o.find === '' ? 'Type the text to find.' : result.matches === 0 ? 'No matches.' : `${result.matches} matches in ${result.cards} cards.`}
        </p>
        <div className="modal-buttons">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={result.matches === 0} onClick={() => onReplace(result.changed, result.matches)}>
            Replace all
          </button>
        </div>
        <p className="muted small">{keys('Ctrl+Z')} undoes the whole replacement. Nothing is written to disk until you save.</p>
      </div>
    </div>
  );
}
