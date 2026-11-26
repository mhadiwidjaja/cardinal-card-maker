import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keys } from './keys';

export interface Command {
  id: string;
  group: string;
  label: string;
  run: () => void;
  keys?: string;
  disabled?: boolean;
  keywords?: string;
}

interface Registry {
  set: (scope: string, commands: Command[] | null) => void;
  all: () => Command[];
  subscribe: (fn: () => void) => () => void;
}

const Ctx = createContext<Registry | null>(null);

export function CommandProvider({ children }: { children: ReactNode }) {
  const registry = useMemo<Registry>(() => {
    const scopes = new Map<string, Command[]>();
    const listeners = new Set<() => void>();
    return {
      set(scope, commands) {
        if (commands) scopes.set(scope, commands);
        else scopes.delete(scope);
        for (const l of listeners) l();
      },
      all: () => [...scopes.values()].flat(),
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  }, []);
  return <Ctx.Provider value={registry}>{children}</Ctx.Provider>;
}

/** Registers a view's commands while `active` (e.g. while its tab is shown). */
export function useCommands(scope: string, commands: Command[], active = true) {
  const registry = useContext(Ctx);
  const latest = useRef(commands);
  latest.current = commands;
  // Commands close over fresh state every render, so wrap them to always call the latest version.
  const stable = useMemo(
    () =>
      commands.map((c, i) => ({
        ...c,
        run: () => latest.current[i]?.run(),
      })),
    // Re-register when what is shown changes (labels, disabled, count), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commands.map((c) => `${c.id}:${c.label}:${c.disabled ? 1 : 0}:${c.keys ?? ''}`).join('|')],
  );
  useEffect(() => {
    if (!registry) return;
    registry.set(scope, active ? stable : null);
    return () => registry.set(scope, null);
  }, [registry, scope, stable, active]);
}

/**
 * How well a query matches a text: every query character must appear in
 * order. Word starts and consecutive characters score higher. Null = no match.
 */
export function matchScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return 0;
  const isStart = (i: number) => i === 0 || /[\s/·:(–-]/.test(t[i - 1]!);
  // Greedy matching from each place the first letter occurs; keep the best.
  let best: number | null = null;
  for (let first = t.indexOf(q[0]!); first !== -1; first = t.indexOf(q[0]!, first + 1)) {
    let score = isStart(first) ? 4 : 0;
    let prev = first;
    let ok = true;
    for (const ch of q.slice(1)) {
      const found = t.indexOf(ch, prev + 1);
      if (found === -1) {
        ok = false;
        break;
      }
      score += found === prev + 1 ? 5 : isStart(found) ? 4 : 0;
      prev = found;
    }
    if (ok) {
      const s = score - first * 0.05 - t.length * 0.01;
      if (best === null || s > best) best = s;
    }
  }
  return best;
}

export function CommandBar({ onClose }: { onClose: () => void }) {
  const registry = useContext(Ctx);
  const [, refresh] = useState(0);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => registry?.subscribe(() => refresh((n) => n + 1)), [registry]);

  const all = registry?.all() ?? [];
  const shown = query.trim()
    ? all
        .map((c) => ({ c, s: matchScore(query, `${c.group} ${c.label} ${c.keywords ?? ''}`) }))
        .filter((x): x is { c: Command; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.c)
    : all;
  const at = Math.min(index, Math.max(0, shown.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  }, [at, query]);

  const run = (c: Command | undefined) => {
    if (!c || c.disabled) return;
    onClose();
    // Let the bar close first, so a command that opens a dialog gets the focus.
    setTimeout(c.run, 0);
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal command-bar" role="dialog" aria-label="Command bar" onClick={(e) => e.stopPropagation()}>
        <input
          type="search"
          autoFocus
          placeholder="Search actions…"
          aria-label="Search actions"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(shown.length - 1, i + 1));
            else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1));
            else if (e.key === 'Enter') run(shown[at]);
            else if (e.key === 'Escape') onClose();
            else return;
            e.preventDefault();
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={shown[at] ? `cmd-${shown[at]!.id}` : undefined}
        />
        <ul className="command-list" id="command-list" role="listbox" ref={listRef}>
          {shown.map((c, i) => (
            <li
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              aria-selected={i === at}
              aria-disabled={c.disabled || undefined}
              className={i === at ? 'on' : ''}
              onMouseMove={() => setIndex(i)}
              onClick={() => run(c)}
            >
              <span className="cmd-group">{c.group}</span>
              <span className="cmd-label">{c.label}</span>
              {c.keys && <span className="cmd-key">{keys(c.keys)}</span>}
            </li>
          ))}
          {shown.length === 0 && <li className="muted">No action matches “{query}”.</li>}
        </ul>
        <div className="command-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> choose
          </span>
          <span>
            <kbd>Enter</kbd> run
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
          <span className="spacer" />
          <span>Actions of the tab you are in, plus everywhere</span>
        </div>
      </div>
    </div>
  );
}
