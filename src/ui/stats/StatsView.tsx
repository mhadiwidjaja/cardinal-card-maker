import { useMemo, useState } from 'react';
import { filterCards } from '../../model/cardOps';
import { countBy, crossCount, dimensionsFor, numericSummary, weightFn, type Dimension, type Entry } from '../../model/stats';
import type { Game, GameDef } from '../../model/types';
import { BalanceView } from './BalanceView';
import { BarList, ColumnChart, DataTable } from './charts';

interface Props {
  game: Game;
  onUpdateGame?: (fn: (def: GameDef) => GameDef) => void;
}

export function StatsView({ game, onUpdateGame }: Props) {
  const [setId, setSetId] = useState<string>('*');
  const [query, setQuery] = useState('');
  const [copies, setCopies] = useState(false);
  const hasQuantity = game.def.fields.some((f) => f.role === 'quantity');
  const dims = useMemo(() => dimensionsFor(game), [game]);

  const { entries, error } = useMemo(() => {
    const sets = setId === '*' ? game.sets : game.sets.filter((s) => s.id === setId);
    let err: string | null = null;
    const out: Entry[] = [];
    for (const set of sets) {
      const r = filterCards(game, set, query);
      if (r.error) err = r.error;
      for (const i of r.indices) out.push({ card: set.cards[i]!, set });
    }
    return { entries: out, error: err };
  }, [game, setId, query]);

  const weight = useMemo(() => weightFn(game, copies && hasQuantity), [game, copies, hasQuantity]);
  const unit = copies && hasQuantity ? 'copies' : 'cards';
  const totalCards = entries.length;
  const totalCopies = useMemo(() => entries.reduce((s, e) => s + weightFn(game, true)(e), 0), [entries, game]);
  const numericDims = dims.filter((d) => d.numeric).slice(0, 3);

  return (
    <div className="stats-view">
      <div className="stats-filters">
        <label>
          Set
          <select value={setId} onChange={(e) => setSetId(e.target.value)}>
            <option value="*">All sets</option>
            {game.sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.def.name}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          className={'filter' + (error ? ' bad' : '')}
          placeholder="Filter…   (or = template == 'unit')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          title={error ?? 'Words match any cell. Start with = to use an expression.'}
        />
        {hasQuantity && (
          <span className="seg" role="group" aria-label="Count">
            <button className={!copies ? 'active' : ''} onClick={() => setCopies(false)}>
              Cards
            </button>
            <button className={copies ? 'active' : ''} onClick={() => setCopies(true)} title="Weight each card by its quantity">
              Copies
            </button>
          </span>
        )}
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Cards</div>
          <div className="tile-value">{totalCards}</div>
        </div>
        {hasQuantity && (
          <div className="tile">
            <div className="tile-label">Copies</div>
            <div className="tile-value">{totalCopies}</div>
          </div>
        )}
        {numericDims.map((d) => {
          const s = numericSummary(game, entries, d.id, weight);
          return (
            <div className="tile" key={d.id}>
              <div className="tile-label">Average {d.label}</div>
              <div className="tile-value">{s ? fmt(s.mean) : '–'}</div>
              {s && (
                <div className="tile-sub">
                  median {fmt(s.median)} · range {fmt(s.min)}–{fmt(s.max)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {totalCards === 0 ? (
        <p className="muted pad">No cards match.</p>
      ) : (
        <div className="chart-grid">
          {dims.map((d) => (
            <ChartCard key={d.id} game={game} dim={d} dims={dims} entries={entries} weight={weight} unit={unit} />
          ))}
        </div>
      )}
      {totalCards > 0 && <BalanceView game={game} entries={entries} onUpdateGame={onUpdateGame} />}
    </div>
  );
}

function ChartCard({ game, dim, dims, entries, weight, unit }: { game: Game; dim: Dimension; dims: Dimension[]; entries: Entry[]; weight: (e: Entry) => number; unit: string }) {
  const [by, setBy] = useState<string>('');
  const [table, setTable] = useState(false);
  const byDim = dims.find((d) => d.id === by && d.id !== dim.id);
  const counts = useMemo(() => countBy(game, entries, dim, weight), [game, entries, dim, weight]);
  const cross = useMemo(() => (byDim ? crossCount(game, entries, dim, byDim, weight) : null), [game, entries, dim, byDim, weight]);

  return (
    <section className="chart-card">
      <header>
        <h3>{dim.numeric ? `${cap(dim.label)} curve` : `By ${dim.label}`}</h3>
        <span className="spacer" />
        {dim.numeric && (
          <select value={by} onChange={(e) => setBy(e.target.value)} title="Split each bar by another field">
            <option value="">No split</option>
            {dims
              .filter((d) => d.id !== dim.id && !d.numeric)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  Split by {d.label}
                </option>
              ))}
          </select>
        )}
        <button className={table ? 'active' : ''} onClick={() => setTable(!table)} title="Show the numbers as a table">
          Table
        </button>
      </header>
      {table ? (
        <DataTable dim={dim} counts={counts} cross={cross} unit={unit} />
      ) : dim.numeric ? (
        <ColumnChart dim={dim} counts={counts} cross={cross} seriesColors={byDim?.colors} unit={unit} />
      ) : (
        <BarList dim={dim} counts={counts} unit={unit} />
      )}
      {counts.blank > 0 && (
        <p className="chart-note">
          {counts.blank} {unit} without a {dim.label}
          {dim.split && ' · cards with several values count under each'}
        </p>
      )}
      {counts.blank === 0 && dim.split && <p className="chart-note">Cards with several values count under each.</p>}
    </section>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
