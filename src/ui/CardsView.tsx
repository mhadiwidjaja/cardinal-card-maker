import { MenuButton, type MenuItem } from './MenuButton';
import { useCommands } from './commands';
import { ResizeHandle, usePanelWidth, type PanelSize } from './ResizeHandle';

const CARD_LIST: PanelSize = { initial: 230, min: 160, max: 480 };
const INSPECTOR: PanelSize = { initial: 320, min: 240, max: 640 };
const SHEET_KEY = 'card-maker:sheet';
function readSheet(): { open: boolean; height: number } {
  const v = readStored<{ open?: unknown; height?: unknown } | null>(SHEET_KEY, null);
  return v && typeof v.height === 'number' ? { open: v.open !== false, height: v.height } : { open: true, height: 280 };
}
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { joinPath } from '../fs/types';
import { blankCard, filterCards, setColumns, sortIndices, withCards } from '../model/cardOps';
import { cardsText } from '../model/save';
import type { Card, CardSet, Game } from '../model/types';
import { writeXlsx } from '../model/xlsx';
import type { AssetStore } from '../render/assets';
import { CardPreview } from './CardPreview';
import { framingColumn } from '../model/framing';
import { download, slug } from './download';
import { CardGrid, type CellChange, type Column } from './grid/CardGrid';
import { ImportDialog } from './grid/ImportDialog';
import { FindReplaceDialog } from './grid/FindReplaceDialog';
import { WordingDialog } from './grid/WordingDialog';
import { toast } from './toast';
import { CardList } from './workbench/CardList';
import { CardInspector } from './workbench/CardInspector';
import { gameKey, type Project } from './store';
import { readStored, writeStored } from './stored';
import { keys } from './keys';

interface Props {
  game: Game;
  set: CardSet;
  assets: AssetStore;
  assetVersion: number;
  project: Project;
  active?: boolean;
}

export function CardsView({ game, set, assets, assetVersion, project, active = true }: Props) {
  const key = gameKey(game);
  const [focusCard, setFocusCard] = useState<number | null>(0);
  const [listW, setListW] = usePanelWidth('card-list', CARD_LIST);
  const [inspW, setInspW] = usePanelWidth('card-inspector', INSPECTOR);
  const [sheet, setSheetState] = useState(readSheet);
  const setSheet = (next: { open: boolean; height: number }) => {
    const height = Math.round(Math.max(120, Math.min(window.innerHeight - 260, next.height)));
    setSheetState({ open: next.open, height });
    writeStored(SHEET_KEY, { open: next.open, height });
  };
  const sheetDrag = useRef<{ y: number; h: number } | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ column: string; dir: 1 | -1 } | null>(null);
  const [importing, setImporting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [wording, setWording] = useState(false);
  const [naming, setNaming] = useState(false);
  const [imageFiles, setImageFiles] = useState<string[]>([]);
  const readOnly = !project.fs?.writable;

  const undo = useRef<CardSet[]>([]);
  const redo = useRef<CardSet[]>([]);
  const latest = useRef(set);
  latest.current = set;
  const [, force] = useState(0);

  const commit = useCallback(
    (next: CardSet, what: 'cards' | 'set' = 'cards') => {
      undo.current.push(latest.current);
      if (undo.current.length > 200) undo.current.shift();
      redo.current = [];
      latest.current = next;
      project.setSet(key, next, what);
      force((n) => n + 1);
    },
    [project, key],
  );

  const setFraming = (field: string, value: string) => {
    if (focusCard === null) return;
    const column = framingColumn(field);
    const cards = latest.current.cards.map((c, i) => (i === focusCard ? { ...c, values: { ...c.values, [column]: value } } : c));
    commit(withCards(latest.current, cards, game));
  };

  const undoRedo = (dir: 'undo' | 'redo') => {
    const from = dir === 'undo' ? undo.current : redo.current;
    const to = dir === 'undo' ? redo.current : undo.current;
    const prev = from.pop();
    if (!prev) return;
    to.push(latest.current);
    const defChanged = JSON.stringify(prev.def) !== JSON.stringify(latest.current.def);
    latest.current = prev;
    project.setSet(key, prev, 'cards');
    if (defChanged) project.setSet(key, prev, 'set');
    force((n) => n + 1);
  };

  useEffect(() => {
    const dir = joinPath(game.path, 'assets', 'art');
    project.fs
      ?.exists(dir)
      .then((ok) => (ok ? project.fs!.list(dir) : []))
      .then((entries) => setImageFiles(entries.filter((e) => e.kind === 'file' && /\.(png|jpe?g|webp|gif|svg)$/i.test(e.name)).map((e) => e.name)))
      .catch(() => setImageFiles([]));
  }, [project.fs, game.path, assetVersion]);

  const columns: Column[] = useMemo(() => {
    const ids = setColumns(game, set);
    const fieldMap = new Map(game.def.fields.map((f) => [f.id, f]));
    const cols: Column[] = ids.map((id) => {
      const f = fieldMap.get(id);
      return { id, label: f?.label ?? id, field: f, readOnly: false };
    });
    // Computed fields are shown read-only after the field they follow in game.json.
    for (const f of game.def.fields.filter((x) => x.computed)) cols.push({ id: f.id, label: `${f.label ?? f.id} =`, field: f, readOnly: true });
    return cols;
  }, [game, set]);

  const { indices, error: filterError } = useMemo(() => filterCards(game, set, query), [game, set, query]);
  const rows = useMemo(() => (sort ? sortIndices(game, set, indices, sort.column, sort.dir) : indices), [game, set, indices, sort]);

  const onChange = (changes: CellChange[], extraRows?: string[][]) => {
    if (changes.length === 0 && !extraRows) return;
    const cards = set.cards.map((c) => ({ ...c, values: { ...c.values } }));
    for (const ch of changes) {
      const card = cards[ch.card];
      if (!card) continue;
      if (ch.column === 'id') {
        const id = ch.value.trim();
        if (id && !cards.some((c, i) => i !== ch.card && c.id === id)) {
          card.id = id;
          card.values.id = id;
        }
      } else card.values[ch.column] = ch.value;
    }
    if (extraRows) {
      const taken = new Set<string>();
      for (const r of extraRows) {
        const c = blankCard(game, { ...set, cards }, taken);
        taken.add(c.id);
        columns.forEach((col, i) => {
          if (!col.readOnly && r[i] !== undefined && r[i] !== '' && col.id !== 'id') c.values[col.id] = r[i]!;
        });
        cards.push(c);
      }
    }
    commit(withCards(set, cards, game));
  };

  const selectedCards = focusCard !== null ? [focusCard] : [];

  const addCard = () => {
    const c = blankCard(game, set);
    const at = focusCard !== null ? focusCard + 1 : set.cards.length;
    const cards = [...set.cards];
    cards.splice(at, 0, c);
    commit(withCards(set, cards, game));
    setQuery('');
    setFocusCard(at);
  };

  const duplicate = () => {
    if (focusCard === null) return;
    const src = set.cards[focusCard];
    if (!src) return;
    const id = blankCard(game, set).id;
    const copy: Card = { id, row: 0, values: { ...src.values, id } };
    const cards = [...set.cards];
    cards.splice(focusCard + 1, 0, copy);
    commit(withCards(set, cards, game));
    setFocusCard(focusCard + 1);
  };

  const remove = () => {
    if (!selectedCards.length) return;
    const card = set.cards[selectedCards[0]!];
    if (!card || !window.confirm(keys(`Delete “${card.values[nameField(game)] || card.id}”? (Ctrl+Z undoes it)`))) return;
    commit(withCards(set, set.cards.filter((_, i) => !selectedCards.includes(i)), game));
  };

  const applySort = () => {
    if (!sort || query.trim()) return;
    commit(withCards(set, rows.map((i) => set.cards[i]!), game));
    setSort(null);
  };

  const exportCsv = () => download(`${slug(set.def.name)}.csv`, cardsText(set), 'text/csv');
  const exportXlsx = () => {
    const cols = setColumns(game, set);
    const data = [cols, ...set.cards.map((c) => cols.map((col) => (col === 'id' ? c.id : (c.values[col] ?? ''))))];
    download(`${slug(set.def.name)}.xlsx`, writeXlsx(data, set.def.name), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  const card = focusCard !== null ? set.cards[focusCard] : undefined;

  const moreItems: MenuItem[] = [
    { heading: 'Text' },
    { label: 'Find and replace…', onClick: () => setReplacing(true), disabled: readOnly, hint: 'Ctrl+H' },
    { label: 'Wording check…', onClick: () => setWording(true) },
    { heading: 'Set' },
    { label: 'Set name and code…', onClick: () => setNaming(true), disabled: readOnly },
    { heading: 'Spreadsheet' },
    { label: 'Import from CSV or Excel…', onClick: () => setImporting(true), disabled: readOnly },
    { label: 'Download as CSV', onClick: exportCsv },
    { label: 'Download as Excel (.xlsx)', onClick: exportXlsx },
  ];
  useCommands(
    'cards',
    [
      { id: 'card-add', group: 'Cards', label: 'Add a card', run: addCard, disabled: readOnly },
      { id: 'card-dup', group: 'Cards', label: 'Duplicate the selected card', run: duplicate, disabled: readOnly || focusCard === null },
      { id: 'card-del', group: 'Cards', label: 'Delete the selected card', run: remove, disabled: readOnly || focusCard === null },
      { id: 'card-undo', group: 'Cards', label: 'Undo', keys: 'Ctrl+Z', run: () => undoRedo('undo'), disabled: !undo.current.length },
      { id: 'card-redo', group: 'Cards', label: 'Redo', keys: 'Ctrl+Y', run: () => undoRedo('redo'), disabled: !redo.current.length },
      { id: 'card-replace', group: 'Cards', label: 'Find and replace…', keys: 'Ctrl+H', run: () => setReplacing(true), disabled: readOnly },
      { id: 'card-wording', group: 'Cards', label: 'Wording check…', run: () => setWording(true), keywords: 'spelling keywords lint style' },
      { id: 'set-name', group: 'Cards', label: 'Rename the set, change its code…', run: () => setNaming(true), disabled: readOnly },
      { id: 'card-import', group: 'Cards', label: 'Import from CSV or Excel…', run: () => setImporting(true), disabled: readOnly },
      { id: 'card-csv', group: 'Cards', label: 'Download as CSV', run: exportCsv },
      { id: 'card-xlsx', group: 'Cards', label: 'Download as Excel (.xlsx)', run: exportXlsx },
      { id: 'card-sheet', group: 'Cards', label: sheet.open ? 'Hide the sheet (spreadsheet)' : 'Show the sheet (spreadsheet)', keys: 'Ctrl+J', run: () => setSheet({ ...sheet, open: !sheet.open }) },
      { id: 'card-filter', group: 'Cards', label: 'Filter the cards', run: () => document.querySelector<HTMLInputElement>('.grid-toolbar .filter')?.focus() },
    ],
    active,
  );

  const setValue = (column: string, value: string) => {
    if (focusCard === null) return;
    const cards = latest.current.cards.map((c, i) => (i === focusCard ? { ...c, values: { ...c.values, [column]: value } } : c));
    commit(withCards(latest.current, cards, game));
  };

  return (
    <div
      className="cards-view workbench"
      onKeyDown={(e) => {
        // While typing in a text field, Ctrl+Z / Ctrl+Y stay the field's own undo.
        const t = e.target as HTMLElement;
        const typing = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'color'].includes((t as HTMLInputElement).type));
        const k = e.key.toLowerCase();
        if (!(e.ctrlKey || e.metaKey)) return;
        if (k === 'j') setSheet({ ...sheet, open: !sheet.open });
        else if (k === 'z' && !typing) undoRedo(e.shiftKey ? 'redo' : 'undo');
        else if (k === 'y' && !typing) undoRedo('redo');
        else if (k === 'h' && !readOnly) setReplacing(true);
        else return;
        e.preventDefault();
      }}
    >
        <div className="grid-toolbar">
          <div className="toolbar-group">
            <input
              type="search"
              className={'filter' + (filterError ? ' bad' : '')}
              placeholder="Filter…   or = cost > 3"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              title={filterError ?? "Words match any cell. Start with = to use an expression, e.g. = cost > 3 and rarity == 'Rare'"}
              aria-label="Filter cards"
            />
            <span className="count mono small muted" title="Cards shown / cards in the set">
              {rows.length}/{set.cards.length}
            </span>
            {sort && (
              <button onClick={() => setSort(null)} title="Show the cards in file order">
                Unsort
              </button>
            )}
            {sort && !query.trim() && !readOnly && (
              <button onClick={applySort} title="Reorder the cards in the file to match this sort (changes card numbers)">
                Keep this order
              </button>
            )}
          </div>
          <span className="spacer" />
          <div className="toolbar-group">
            <button onClick={addCard} disabled={readOnly} title="Add a card below the selected one">
              + Card
            </button>
            <button onClick={duplicate} disabled={readOnly || focusCard === null}>
              Duplicate
            </button>
            <button onClick={remove} disabled={readOnly || focusCard === null}>
              Delete
            </button>
          </div>
          <div className="toolbar-group">
            <button onClick={() => undoRedo('undo')} disabled={!undo.current.length} title={keys('Undo (Ctrl+Z)')} aria-label="Undo">
              ↶
            </button>
            <button onClick={() => undoRedo('redo')} disabled={!redo.current.length} title={keys('Redo (Ctrl+Y)')} aria-label="Redo">
              ↷
            </button>
          </div>
          <MenuButton label="More" title="Find and replace, wording check, spreadsheet import and download" items={moreItems} />
        </div>
      <div className="wb-main">
        <aside className="wb-list" style={{ width: listW }}>
          <CardList game={game} set={set} rows={rows} focusCard={focusCard} onFocusCard={setFocusCard} assets={assets} assetVersion={assetVersion} />
        </aside>
        <ResizeHandle panel="left" width={listW} size={CARD_LIST} onWidth={setListW} label="Card list width" />
        <section className="wb-stage preview-pane">
          {card ? (
            <CardPreview game={game} set={set} card={card} assets={assets} version={assetVersion} onFrame={readOnly ? undefined : setFraming} />
          ) : (
            <p className="muted pad">Select a card.</p>
          )}
        </section>
        <ResizeHandle panel="right" width={inspW} size={INSPECTOR} onWidth={setInspW} label="Inspector width" />
        <aside className="wb-inspector" style={{ width: inspW }}>
          {card ? (
            <CardInspector game={game} set={set} card={card} readOnly={readOnly} imageFiles={imageFiles} onValue={setValue} />
          ) : (
            <p className="muted pad">No card selected.</p>
          )}
          {readOnly && <p className="muted small grid-note">The demo is read-only. Use “Copy demo to a folder…” (top of the window) to edit cards.</p>}
        </aside>
      </div>
      <section className={'sheet-drawer' + (sheet.open ? '' : ' closed')} style={sheet.open ? { height: sheet.height } : undefined} aria-label="Sheet">
        <div
          className="sheet-head"
          onPointerDown={(e) => {
            if (!sheet.open || (e.target as HTMLElement).closest('button')) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            sheetDrag.current = { y: e.clientY, h: sheet.height };
          }}
          onPointerMove={(e) => sheetDrag.current && setSheet({ open: true, height: sheetDrag.current.h - (e.clientY - sheetDrag.current.y) })}
          onPointerUp={() => (sheetDrag.current = null)}
          onDoubleClick={() => setSheet({ ...sheet, open: !sheet.open })}
          title={keys('Drag to resize · double-click or Ctrl+J to open or close')}
        >
          <button className="sheet-toggle" onClick={() => setSheet({ ...sheet, open: !sheet.open })} aria-expanded={sheet.open}>
            <span aria-hidden>{sheet.open ? '▾' : '▴'}</span> <span className="slug">Sheet</span>
          </button>
          <span className="muted small">All cards as a spreadsheet: bulk edits, paste from Excel</span>
          <span className="spacer" />
          <span className="mono small muted">{rows.length}/{set.cards.length}</span>
        </div>
        {sheet.open && (
        <div
          className="grid-wrap"
        >
          <CardGrid
            game={game}
            set={set}
            columns={columns}
            rows={rows}
            focusCard={focusCard}
            onFocusCard={setFocusCard}
            onChange={onChange}
            sort={sort}
            onSort={(column) => setSort((s) => (s?.column !== column ? { column, dir: 1 } : s.dir === 1 ? { column, dir: -1 } : null))}
            imageFiles={imageFiles}
            readOnly={readOnly}
          />
        </div>
        )}
      </section>
      {naming && (
        <div className="modal-back" onClick={() => setNaming(false)}>
          <div className="modal set-dialog" role="dialog" aria-label="Set name and code" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => (e.key === 'Escape' || e.key === 'Enter') && setNaming(false)}>
            <h3>Set name and code</h3>
            <label className="fr-row">
              <span>Name</span>
              <input type="text" autoFocus value={set.def.name} onChange={(e) => commit({ ...set, def: { ...set.def, name: e.target.value } }, 'set')} aria-label="Set name" />
            </label>
            <label className="fr-row">
              <span>Code</span>
              <input type="text" className="set-code" value={set.def.code ?? ''} placeholder="CORE" onChange={(e) => commit({ ...set, def: { ...set.def, code: e.target.value || undefined } }, 'set')} aria-label="Set code" />
            </label>
            <p className="muted small">The code is printed with {'{set.code}'} in templates, e.g. in the collector line. {keys('Ctrl+Z')} undoes changes.</p>
            <div className="modal-buttons">
              <button className="primary" onClick={() => setNaming(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {wording && (
        <WordingDialog
          game={game}
          currentSet={set.id}
          onShow={(_setId, cardId) => {
            const i = set.cards.findIndex((c) => c.id === cardId);
            if (i >= 0) {
              setQuery('');
              setFocusCard(i);
            }
            setWording(false);
          }}
          onClose={() => setWording(false)}
        />
      )}
      {replacing && (
        <FindReplaceDialog
          game={game}
          set={set}
          filtered={query.trim() && !filterError ? indices : null}
          onClose={() => setReplacing(false)}
          onReplace={(changed, matches) => {
            const cards = latest.current.cards.map((c, i) => (changed.has(i) ? { ...c, values: changed.get(i)! } : c));
            commit(withCards(latest.current, cards, game));
            setReplacing(false);
            toast(keys(`Replaced ${matches} times in ${changed.size} cards. Ctrl+Z undoes it.`));
          }}
        />
      )}
      {importing && (
        <ImportDialog
          game={game}
          set={set}
          onClose={() => setImporting(false)}
          onImport={(next) => {
            commit(next);
            setImporting(false);
          }}
        />
      )}
    </div>
  );
}

function nameField(game: Game): string {
  return game.def.fields.find((f) => f.identifying)?.id ?? 'name';
}
