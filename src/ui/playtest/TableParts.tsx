import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { deckSize, type Deck } from '../../playtest/decks';
import { useEscape } from '../useEscape';

export interface MenuEntry {
  label: string;
  key?: string;
  run: () => void;
}

export function ContextMenu({ x, y, items, close }: { x: number; y: number; items: MenuEntry[]; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [close]);
  const style: CSSProperties = { left: Math.min(x, window.innerWidth - 240), top: Math.max(8, Math.min(y, window.innerHeight - items.length * 32 - 16)) };
  return (
    <div className="pt-menu" role="menu" ref={ref} style={style}>
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          onClick={() => {
            it.run();
            close();
          }}
        >
          <span>{it.label}</span>
          {it.key && <kbd>{it.key}</kbd>}
        </button>
      ))}
    </div>
  );
}

export function GenericBack({ name }: { name: string }) {
  return (
    <div className="pt-generic-back" aria-label="Card back">
      <span>{name}</span>
    </div>
  );
}

export function NameDialog({ title, initial, onDone }: { title: string; initial: string; onDone: (name: string | null) => void }) {
  useEscape(() => onDone(null));
  const [name, setName] = useState(initial);
  return (
    <div className="modal-back" onClick={() => onDone(null)}>
      <form
        className="modal pt-dialog"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onDone(name.trim() || null);
        }}
      >
        <h3>{title}</h3>
        <input aria-label="Name" value={name} maxLength={40} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} />
        <div className="modal-buttons">
          <button type="button" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={!name.trim()}>
            OK
          </button>
        </div>
      </form>
    </div>
  );
}

/** Picks a deck to shuffle into a new pile on the table, such as a shared market or monster deck. */
export function PutDeckDialog({ decks, onDone }: { decks: Deck[]; onDone: (pick: { deck: Deck; name: string } | null) => void }) {
  useEscape(() => onDone(null));
  const [id, setId] = useState(decks[0]?.id ?? '');
  const deck = decks.find((d) => d.id === id);
  const [name, setName] = useState('');
  return (
    <div className="modal-back" onClick={() => onDone(null)}>
      <form
        className="modal pt-dialog"
        role="dialog"
        aria-label="Put a deck on the table"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (deck) onDone({ deck, name: name.trim() || deck.name.replace(/ \(whole set\)$/, '') });
        }}
      >
        <h3>Put a deck on the table</h3>
        <p className="muted small">It is shuffled into a face-down pile that belongs to nobody, for example a shared market. Every player can draw from it or deal from it.</p>
        <label className="pt-field">
          <span>Deck</span>
          <select value={id} onChange={(e) => setId(e.target.value)} autoFocus>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {deckSize(d)} cards
              </option>
            ))}
          </select>
        </label>
        <label className="pt-field">
          <span>Pile name</span>
          <input value={name} maxLength={40} placeholder={deck?.name.replace(/ \(whole set\)$/, '')} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="modal-buttons">
          <button type="button" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={!deck || deckSize(deck) === 0}>
            Put on the table
          </button>
        </div>
      </form>
    </div>
  );
}
