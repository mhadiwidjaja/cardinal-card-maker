import { useEffect, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'info';
}

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();
let nextId = 1;

export function toast(text: string, kind: Toast['kind'] = 'ok') {
  const t = { id: nextId++, text, kind };
  for (const l of listeners) l(t);
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l: Listener = (t) => {
      setItems((list) => [...list.slice(-2), t]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), 4500);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}>
          {t.kind === 'ok' && <span aria-hidden>✓ </span>}
          {t.text}
        </div>
      ))}
    </div>
  );
}
