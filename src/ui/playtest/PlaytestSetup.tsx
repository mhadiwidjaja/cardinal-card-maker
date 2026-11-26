import type { CSSProperties } from 'react';
import { deckSize, type Deck } from '../../playtest/decks';
import { defaultSeats, SEAT_LABEL, SEATS, type Seat } from '../../playtest/layout';
import type { PlaytestConfig } from '../../playtest/table';
import { readStored } from '../stored';
import { keys } from '../keys';

export interface SeatSetup {
  name: string;
  seat: Seat;
  /** Deck id; an unknown id falls back to the first deck. */
  deck: string;
}

export const MAX_PLAYERS = 4;

export function readSetup(key: string): SeatSetup[] {
  const raw = readStored<unknown>(key, null);
  const list = Array.isArray(raw) ? raw.slice(0, MAX_PLAYERS) : [];
  const used = new Set<Seat>();
  const out: SeatSetup[] = [];
  for (const r of list) {
    const o = (typeof r === 'object' && r !== null ? r : {}) as Partial<SeatSetup>;
    const seat = SEATS.includes(o.seat as Seat) && !used.has(o.seat as Seat) ? (o.seat as Seat) : SEATS.find((s) => !used.has(s))!;
    used.add(seat);
    out.push({ name: typeof o.name === 'string' ? o.name : `Player ${out.length + 1}`, seat, deck: typeof o.deck === 'string' ? o.deck : '' });
  }
  return out.length ? out : [{ name: 'Player 1', seat: 'south', deck: '' }];
}

/** Grows or shrinks the list; new players take the free seats in the usual order for that many players. */
export function resizeSetup(players: SeatSetup[], n: number): SeatSetup[] {
  const kept = players.slice(0, n);
  const order = [...defaultSeats(n), ...SEATS];
  while (kept.length < n) {
    const seat = order.find((s) => !kept.some((p) => p.seat === s))!;
    kept.push({ name: `Player ${kept.length + 1}`, seat, deck: kept[0]?.deck ?? '' });
  }
  return kept;
}

/** Play goes clockwise round the table, starting with the first player in the list. */
export function turnOrder<T extends { seat: Seat }>(players: T[]): T[] {
  const first = SEATS.indexOf(players[0]?.seat ?? 'south');
  return [...players].sort((a, b) => ((SEATS.indexOf(a.seat) - first + 4) % 4) - ((SEATS.indexOf(b.seat) - first + 4) % 4));
}

interface Props {
  players: SeatSetup[];
  onChange: (players: SeatSetup[]) => void;
  decks: Deck[];
  deckFor: (id: string) => Deck | undefined;
  config: PlaytestConfig;
  onEdit: (player: number) => void;
  onNewDeck: () => void;
  onStart: () => void;
  onResume?: () => void;
  pending: number;
}

export function PlaytestSetup({ players, onChange, decks, deckFor, config, onEdit, onNewDeck, onStart, onResume, pending }: Props) {
  const set = (i: number, patch: Partial<SeatSetup>) => {
    const next = players.map((p, j) => (j === i ? { ...p, ...patch } : p));
    const other = patch.seat ? players.findIndex((p, j) => j !== i && p.seat === patch.seat) : -1;
    if (other >= 0) next[other] = { ...next[other]!, seat: players[i]!.seat };
    onChange(next);
  };
  const playable = players.some((p) => (deckFor(p.deck) ? deckSize(deckFor(p.deck)!) : 0) > 0);
  return (
    <div className="pt-intro">
      <h2>Playtest table</h2>
      <p>
        Up to {MAX_PLAYERS} players at this screen, one on each side of the table. Everyone gets their own deck, discard pile, hand of {config.handSize} and counters. Between turns the hands are hidden
        until the next player is ready.
      </p>
      <div className="pt-count" role="group" aria-label="Number of players">
        <span className="muted">Players</span>
        {[1, 2, 3, 4].map((n) => (
          <button key={n} aria-pressed={players.length === n} onClick={() => onChange(resizeSetup(players, n))}>
            {n}
          </button>
        ))}
      </div>
      <ol className="pt-seats-setup">
        {players.map((p, i) => {
          const d = deckFor(p.deck);
          return (
            <li key={i} style={{ '--seat': `var(--seat-${p.seat})` } as CSSProperties}>
              <span className="pt-dot" aria-hidden />
              <input aria-label={`Player ${i + 1} name`} value={p.name} maxLength={24} onChange={(e) => set(i, { name: e.target.value })} />
              <select aria-label={`Player ${i + 1} seat`} value={p.seat} onChange={(e) => set(i, { seat: e.target.value as Seat })}>
                {SEATS.map((s) => (
                  <option key={s} value={s}>
                    {SEAT_LABEL[s]}
                  </option>
                ))}
              </select>
              <select className="pt-deck-pick" aria-label={`Player ${i + 1} deck`} value={d?.id ?? ''} onChange={(e) => set(i, { deck: e.target.value })}>
                {decks.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {deckSize(x)} cards
                  </option>
                ))}
              </select>
              <button onClick={() => onEdit(i)} disabled={!d} title="Change which cards are in this deck">
                Edit…
              </button>
            </li>
          );
        })}
      </ol>
      <p className="pt-new-deck">
        <button onClick={onNewDeck} title="Build a new deck from this game's cards">
          New deck…
        </button>
      </p>
      <div className="pt-intro-actions">
        <button className="primary" onClick={onStart} disabled={!playable} title="Shuffle every deck and deal the opening hands (Enter)">
          Start game
        </button>
        {onResume && <button onClick={onResume}>Back to the game</button>}
        {pending > 0 && <span className="muted small">Drawing card pictures ({pending} left)…</span>}
      </div>
      <ol className="muted pt-tips">
        {players.length > 1 && <li>Play goes clockwise, starting with {players[0]!.name || 'Player 1'}. Cards on the table turn to face the player who played them.</li>}
        <li>Drag cards between your hand, the table and the piles. Drag a pile by its name, or with Shift, to move it.</li>
        <li>Double-click a card in your hand to play it; double-click a card on the table to tap it.</li>
        <li>Right-click a card, a pile or the table for everything else, such as putting another deck on the table. {keys('Ctrl+Z')} undoes anything.</li>
      </ol>
      <p className="muted small">Hand size, cards drawn per turn and counters (like life) are set under Game settings → Playtest table.</p>
    </div>
  );
}
