import { useState } from 'react';
import { costOptions, DEFAULT_PRICES, type CostInput, type ShopPrices } from '../../export/cost';
import { readStored, writeStored } from '../stored';

interface Props {
  storageKey: string;
  input: CostInput;
}

interface Stored {
  currency: string;
  prices: ShopPrices;
}

function load(key: string): Stored {
  const s = readStored<Partial<Stored> | null>(key, null);
  if (s?.prices) return { currency: s.currency ?? 'Rp', prices: { ...DEFAULT_PRICES, ...s.prices, sheet: { ...DEFAULT_PRICES.sheet, ...s.prices.sheet } } };
  return { currency: 'Rp', prices: DEFAULT_PRICES };
}

export function CostPlanner({ storageKey, input }: Props) {
  const [state, setState] = useState<Stored>(() => load(storageKey));
  const set = (next: Stored) => {
    setState(next);
    writeStored(storageKey, next);
  };
  const p = state.prices;
  const setPrice = (patch: Partial<ShopPrices>) => set({ ...state, prices: { ...p, ...patch } });
  const opts = costOptions(input, p);
  const money = (n: number) => `${state.currency} ${Math.round(n).toLocaleString()}`;
  const num = (label: string, value: number, onChange: (v: number) => void, title?: string) => (
    <label className="cost-price" title={title}>
      {label}
      <input type="number" min={0} step="any" value={value || ''} placeholder="0" onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} aria-label={label} />
    </label>
  );

  return (
    <details className="cost-planner">
      <summary>Print cost</summary>
      <p className="muted small">Enter your print shop's prices once (kept in this browser). Leave a price empty if the shop doesn't offer it.</p>
      <div className="cost-prices">
        <label className="cost-price">
          Currency
          <input type="text" value={state.currency} onChange={(e) => set({ ...state, currency: e.target.value })} aria-label="Currency" style={{ width: 60 }} />
        </label>
        {num('A4 sheet', p.sheet.A4 ?? 0, (v) => setPrice({ sheet: { ...p.sheet, A4: v } }))}
        {num('A3 sheet', p.sheet.A3 ?? 0, (v) => setPrice({ sheet: { ...p.sheet, A3: v } }))}
        {num('+ back side, per sheet', p.backExtra, (v) => setPrice({ backExtra: v }))}
        {num('Cutting, per sheet', p.cutPerSheet, (v) => setPrice({ cutPerSheet: v }))}
        {num('Per card (card by card)', p.perCard, (v) => setPrice({ perCard: v }), 'For shops that print and cut each card from a one-card-per-page PDF')}
        {num('Fixed per order', p.fixed, (v) => setPrice({ fixed: v }), 'Setup, delivery and so on')}
      </div>
      {opts.length === 0 ? (
        <p className="muted small">Enter at least one price to compare.</p>
      ) : (
        <table className="cost-table">
          <thead>
            <tr>
              <th>Layout</th>
              <th>Cards per sheet</th>
              <th>Sheets</th>
              <th>Empty slots</th>
              <th>Total</th>
              <th>Per card</th>
            </tr>
          </thead>
          <tbody>
            {opts.map((o, i) => (
              <tr key={o.label} className={i === 0 ? 'best' : ''}>
                <td>
                  {o.label}
                  {i === 0 && opts.length > 1 && <span className="badge">cheapest</span>}
                </td>
                <td>{o.perSheet}</td>
                <td>{o.sheets}</td>
                <td>{o.emptySlots}</td>
                <td>{money(o.total)}</td>
                <td>{money(o.perCopy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {opts.length > 1 && opts[0]!.total < opts[opts.length - 1]!.total && (
        <p className="small">
          {opts[0]!.label} saves {Math.round((1 - opts[0]!.total / opts[opts.length - 1]!.total) * 100)}% against {opts[opts.length - 1]!.label}.
        </p>
      )}
      <p className="muted small">
        For {input.copies} printed cards{input.backs ? ', double-sided' : ''}
        {input.bleed ? ', with bleed (cards need gaps, so fewer fit)' : ''}. Uses the copies, backs, bleed and margin chosen above.
      </p>
    </details>
  );
}
