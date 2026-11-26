import { useMemo, useState } from 'react';
import { filterCards } from '../../model/cardOps';
import type { Game } from '../../model/types';
import { cardKey } from '../../playtest/decks';
import { atLeast, cardsSeen } from '../../playtest/odds';
import { playtestConfig } from '../../playtest/table';

interface Props {
  game: Game;
  counts: Map<string, number>;
}

const TURNS = [1, 2, 3, 4, 5, 6];
const pct = (p: number) => (p >= 0.9995 ? '100%' : p < 0.0005 ? '0%' : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`);

export function DeckOdds({ game, counts }: Props) {
  const config = playtestConfig(game.def.playtest);
  const [query, setQuery] = useState('');
  const [need, setNeed] = useState(1);
  const [first, setFirst] = useState(true);

  const { hits, error } = useMemo(() => {
    let n = 0;
    let err: string | null = null;
    if (!query.trim()) return { hits: 0, error: null };
    for (const set of game.sets) {
      const r = filterCards(game, set, query);
      if (r.error) err = r.error;
      for (const i of r.indices) n += counts.get(cardKey(set, set.cards[i]!)) ?? 0;
    }
    return { hits: err ? 0 : n, error: err };
  }, [game, counts, query]);
  const deck = [...counts.values()].reduce((a, b) => a + b, 0);

  return (
    <details className="deck-odds">
      <summary>Draw odds</summary>
      <div className="odds-controls">
        <input
          type="search"
          className={error ? 'bad' : ''}
          placeholder="Cards that count…   (or = cost <= 2)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Cards that count"
          title={error ?? 'Words match any field. Start with = to use an expression, as in the Cards tab filter.'}
        />
        <label>
          at least <input type="number" className="num" min={1} max={20} value={need} onChange={(e) => setNeed(Math.max(1, Number(e.target.value) || 1))} aria-label="At least" />
        </label>
        <label>
          <input type="checkbox" checked={first} onChange={(e) => setFirst(e.target.checked)} /> going first (no draw on turn 1)
        </label>
      </div>
      {query.trim() === '' ? (
        <p className="muted small">Type which cards count, e.g. a name, a type, or = cost &lt;= 2.</p>
      ) : (
        <>
          <p className="small" aria-live="polite">
            <b>{hits}</b> of the {deck} cards count · hand of {config.handSize}, {config.drawPerTurn} draw per turn
          </p>
          <table className="odds-table">
            <thead>
              <tr>
                <th>Turn</th>
                {TURNS.map((t) => (
                  <th key={t}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Cards seen</th>
                {TURNS.map((t) => (
                  <td key={t}>{Math.min(deck, cardsSeen(config.handSize, config.drawPerTurn, t, first))}</td>
                ))}
              </tr>
              <tr>
                <th>Chance</th>
                {TURNS.map((t) => (
                  <td key={t}>
                    <b>{pct(atLeast(deck, hits, cardsSeen(config.handSize, config.drawPerTurn, t, first), need))}</b>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="muted small">Exact odds for a shuffled deck without mulligans, counting only draws (no searching or extra draws).</p>
        </>
      )}
    </details>
  );
}
