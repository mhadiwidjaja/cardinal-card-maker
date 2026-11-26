import { useState } from 'react';
import { CARD_PRESETS } from '../../model/gameOps';

interface Props {
  existing: string[];
  onCreate: (name: string, size: { w: number; h: number }) => void;
  onCancel: () => void;
}

export function NewGameDialog({ onCreate, onCancel }: Props) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState(0);
  const [w, setW] = useState(63);
  const [h, setH] = useState(88);
  const custom = preset === -1;
  const size = custom ? { w, h } : CARD_PRESETS[preset]!;
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New game</h3>
        <div className="export-row">
          <label>Name</label>
          <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My Card Game" />
        </div>
        <div className="export-row">
          <label>Card size</label>
          <div className="inline">
            <select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
              {CARD_PRESETS.map((p, i) => (
                <option key={p.name} value={i}>
                  {p.name}
                </option>
              ))}
              <option value={-1}>Custom…</option>
            </select>
            {custom && (
              <>
                <input type="number" className="num" value={w} onChange={(e) => setW(e.target.valueAsNumber || 0)} /> ×
                <input type="number" className="num" value={h} onChange={(e) => setH(e.target.valueAsNumber || 0)} /> mm
              </>
            )}
          </div>
        </div>
        <p className="muted small">
          You get starter fields (name, cost, type, rarity, rules, art, count), a basic card template, a card back and an empty “Core Set”. Change all of it under Game settings
          and Templates. Files are written when you save.
        </p>
        <div className="modal-buttons">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!name.trim() || size.w <= 0 || size.h <= 0} onClick={() => onCreate(name.trim(), { w: size.w, h: size.h })}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
