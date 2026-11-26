import { useMemo, useState } from 'react';
import type { FileStore } from '../../fs/types';
import type { Game } from '../../model/types';
import { cardKey, deckSize, saveDeck, type Deck } from '../../playtest/decks';
import type { AssetStore } from '../../render/assets';
import { slug } from '../download';
import { toast } from '../toast';
import { useCardImages } from './useCardImages';
import { DeckOdds } from './DeckOdds';

interface Props {
  game: Game;
  fs: FileStore;
  assets: AssetStore;
  assetVersion: number;
  deck: Deck;
  existing: Deck[];
  onClose: (saved: Deck | null) => void;
}

export function DeckEditor({ game, fs, assets, assetVersion, deck, existing, onClose }: Props) {
  const isFile = !!deck.file;
  const [name, setName] = useState(isFile ? deck.name : deck.id.startsWith('set:') ? deck.name.replace(/ \(whole set\)$/, '') + ' deck' : deck.name);
  const [counts, setCounts] = useState<Map<string, number>>(() => new Map(deck.entries.map((e) => [e.key, e.count])));
  const [query, setQuery] = useState('');
  const [onlyInDeck, setOnlyInDeck] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameField = game.def.fields.find((f) => f.identifying)?.id ?? 'name';

  const all = useMemo(() => game.sets.flatMap((set) => set.cards.map((card) => ({ set, card, key: cardKey(set, card) }))), [game]);
  const q = query.trim().toLowerCase();
  const shown = all.filter((x) => (!onlyInDeck || (counts.get(x.key) ?? 0) > 0) && (!q || Object.values(x.card.values).some((v) => v.toLowerCase().includes(q))));
  const images = useCardImages(game, assets, shown.slice(0, 60).map((x) => x.key), assetVersion);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const change = (key: string, d: number) =>
    setCounts((m) => {
      const n = new Map(m);
      const v = Math.max(0, Math.min(99, (n.get(key) ?? 0) + d));
      if (v === 0) n.delete(key);
      else n.set(key, v);
      return n;
    });

  function result(): Deck {
    // Keep the game's card order, so deck files are stable and easy to read.
    const entries = all.filter((x) => counts.get(x.key)).map((x) => ({ key: x.key, count: counts.get(x.key)! }));
    return { ...deck, name: name.trim() || 'Deck', entries };
  }

  async function save() {
    const d = result();
    if (!fs.writable) {
      const id = deck.id.startsWith('scratch:') ? deck.id : `scratch:${Date.now()}`;
      toast('Deck kept until you close the page. Copy the demo to a folder to save decks.', 'info');
      return onClose({ ...d, id, file: undefined });
    }
    let file = deck.file;
    if (!file) {
      file = slug(d.name) || 'deck';
      const taken = new Set(existing.map((x) => x.file).filter(Boolean));
      for (let i = 2; taken.has(file); i++) file = `${slug(d.name) || 'deck'}-${i}`;
    }
    setBusy(true);
    try {
      const saved = { ...d, id: `file:${file}`, file };
      await saveDeck(fs, game, saved);
      toast(`Saved deck “${saved.name}” (${deckSize(saved)} cards)`);
      onClose(saved);
    } catch (e) {
      toast(`Could not save the deck: ${(e as Error).message}`, 'info');
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={() => onClose(null)}>
      <div className="modal deck-editor" role="dialog" aria-label="Deck" onClick={(e) => e.stopPropagation()}>
        <div className="de-head">
          <input type="text" className="de-name" aria-label="Deck name" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="de-total" aria-live="polite">
            <b>{total}</b> cards
          </span>
        </div>
        <div className="de-filters">
          <input type="search" placeholder="Search cards…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus aria-label="Search cards" />
          <label>
            <input type="checkbox" checked={onlyInDeck} onChange={(e) => setOnlyInDeck(e.target.checked)} /> only cards in the deck
          </label>
          <span className="spacer" />
          <button onClick={() => setCounts(new Map())} disabled={total === 0}>
            Clear
          </button>
        </div>
        <p className="muted small de-hint">Click a card to add a copy. Use − to remove one.</p>
        <ul className="de-list">
          {shown.map(({ card, key, set }) => {
            const n = counts.get(key) ?? 0;
            const img = images.get(key);
            return (
              <li key={key} className={n ? 'in-deck' : ''}>
                <button className="de-card" onClick={() => change(key, 1)} title="Add a copy">
                  {img ? <img src={img.front} alt="" /> : <span className="de-noimg" />}
                  <span className="de-name-cell">
                    {card.values[nameField] || card.id}
                    <span className="muted small">
                      {' '}
                      · {game.sets.length > 1 ? `${set.def.name} · ` : ''}
                      {card.values.template || ''}
                    </span>
                  </span>
                </button>
                <span className="de-count">
                  <button aria-label="Remove a copy" onClick={() => change(key, -1)} disabled={n === 0}>
                    −
                  </button>
                  <b>{n}</b>
                  <button aria-label="Add a copy" onClick={() => change(key, 1)}>
                    +
                  </button>
                </span>
              </li>
            );
          })}
          {shown.length === 0 && <li className="muted">No cards match.</li>}
        </ul>
        <DeckOdds game={game} counts={counts} />
        <div className="modal-buttons">
          <span className="muted small">{fs.writable ? `Saved as decks/${deck.file ?? (slug(name) || 'deck')}.json` : 'Read-only demo: kept for this session only'}</span>
          <span className="spacer" />
          <button onClick={() => onClose(null)}>Cancel</button>
          <button className="primary" disabled={busy || total === 0} onClick={save}>
            {fs.writable ? 'Save deck' : 'Use deck'}
          </button>
        </div>
      </div>
    </div>
  );
}
