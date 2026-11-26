import { useMemo, useState } from 'react';
import { costField, fitBalance, formulaTerm, learnedTerms, type BalanceRow } from '../../model/balance';
import type { Entry } from '../../model/stats';
import type { Game, GameDef } from '../../model/types';

interface Props {
  game: Game;
  entries: Entry[];
  onUpdateGame?: (fn: (def: GameDef) => GameDef) => void;
}

const OFF_BY = 0.75;
const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export function BalanceView({ game, entries, onUpdateGame }: Props) {
  const saved = game.def.balance?.value ?? '';
  const [mode, setMode] = useState<'learn' | 'formula'>(saved ? 'formula' : 'learn');
  const [formula, setFormula] = useState(saved || 'attack + health');
  const cost = costField(game);
  const nameField = game.def.fields.find((f) => f.identifying)?.id ?? 'name';

  const fit = useMemo(() => {
    const terms = mode === 'learn' ? learnedTerms(game, entries) : [formulaTerm(game, formula)];
    return fitBalance(game, entries, terms);
  }, [game, entries, mode, formula]);

  if (!cost) return null;
  const name = (r: BalanceRow) => r.entry.card.values[nameField] || r.entry.card.id;
  const off = 'error' in fit ? [] : fit.rows.filter((r) => Math.abs(r.residual) >= OFF_BY).sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));

  return (
    <section className="stats-card balance">
      <h3>Balance: is each card priced right?</h3>
      <p className="muted small">
        Works out what the <code>{cost}</code> of a card “should” be from what it does, using all the cards shown, and lists the ones far from that. A guide for
        where to look, not a verdict: card text the formula can't see still counts.
      </p>
      <div className="inline balance-mode" role="group" aria-label="Balance model">
        <label>
          <input type="radio" checked={mode === 'learn'} onChange={() => setMode('learn')} /> Learn from my cards (number fields, keywords, card kinds)
        </label>
        <label>
          <input type="radio" checked={mode === 'formula'} onChange={() => setMode('formula')} /> My value formula
        </label>
        {mode === 'formula' && (
          <>
            <input type="text" className="balance-formula" value={formula} onChange={(e) => setFormula(e.target.value)} aria-label="Value formula" title="An expression like in templates, e.g. attack + health * 0.8 + if(contains(rules, 'Swift'), 1, 0)" />
            {onUpdateGame && formula !== saved && (
              <button onClick={() => onUpdateGame((d) => ({ ...d, balance: { ...d.balance, value: formula } }))} title="Keep this formula in game.json">
                Save formula
              </button>
            )}
          </>
        )}
      </div>
      {'error' in fit ? (
        <p className="muted">{fit.error}</p>
      ) : (
        <div className="balance-body">
          <Scatter rows={fit.rows} name={name} />
          <div>
            <p>
              The model explains <strong>{Math.round(fit.r2 * 100)}%</strong> of the cost differences across {fit.rows.length} cards.
            </p>
            <table className="balance-worth">
              <thead>
                <tr>
                  <th>{mode === 'learn' ? 'Each point of' : 'Term'}</th>
                  <th>is worth</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="muted">base cost</td>
                  <td>{fmt(fit.intercept)}</td>
                </tr>
                {fit.worth.map((w) => (
                  <tr key={w.term.id}>
                    <td>{w.term.label}</td>
                    <td>{(w.worth >= 0 ? '+' : '') + fmt(w.worth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h4>Stand out ({off.length})</h4>
            {off.length === 0 ? (
              <p className="muted small">Every card is within {OFF_BY} of its expected cost.</p>
            ) : (
              <ul className="balance-off">
                {off.map((r) => (
                  <li key={`${r.entry.set.id}/${r.entry.card.id}`} className={r.residual < 0 ? 'cheap' : 'dear'}>
                    <strong>{name(r)}</strong> costs {fmt(r.cost)}, cards like it cost {fmt(r.predicted)}:{' '}
                    {r.residual < 0 ? `${fmt(-r.residual)} cheaper (maybe too strong)` : `${fmt(r.residual)} dearer (maybe too weak)`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Scatter({ rows, name }: { rows: BalanceRow[]; name: (r: BalanceRow) => string }) {
  const W = 260;
  const H = 220;
  const pad = 28;
  const vals = rows.flatMap((r) => [r.cost, r.predicted]);
  const lo = Math.floor(Math.min(0, ...vals));
  const hi = Math.ceil(Math.max(1, ...vals));
  const x = (v: number) => pad + ((v - lo) / (hi - lo)) * (W - pad - 8);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - pad - 8);
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((_t, i, a) => a.length <= 11 || i % 2 === 0);
  return (
    <svg className="balance-scatter" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Expected cost against actual cost">
      <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} className="diag" />
      {ticks.map((t) => (
        <g key={t}>
          <text x={x(t)} y={H - pad + 14} textAnchor="middle">
            {t}
          </text>
          <text x={pad - 6} y={y(t) + 4} textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      <text x={(W + pad) / 2} y={H - 2} textAnchor="middle" className="axis">
        expected cost
      </text>
      <text x={10} y={(H - pad) / 2} textAnchor="middle" className="axis" transform={`rotate(-90 10 ${(H - pad) / 2})`}>
        actual cost
      </text>
      {rows.map((r) => (
        <circle key={`${r.entry.set.id}/${r.entry.card.id}`} cx={x(r.predicted)} cy={y(r.cost)} r={4.5} className={Math.abs(r.residual) >= OFF_BY ? (r.residual < 0 ? 'cheap' : 'dear') : ''}>
          <title>
            {name(r)}: costs {fmt(r.cost)}, expected {fmt(r.predicted)}
          </title>
        </circle>
      ))}
    </svg>
  );
}
