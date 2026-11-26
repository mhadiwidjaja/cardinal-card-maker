import { useEffect, useRef, useState } from 'react';
import { bridge, folderName, recentFolders, type BrowseResult, type Place } from '../fs/serverFs';

interface Props {
  title: string;
  action: string;
  onPick: (dir: string) => void;
  onCancel: () => void;
}

const KIND_LABEL = { workspace: 'workspace', game: 'game' } as const;

/** Removes quotes and stray spaces from a pasted path (e.g. from Explorer's "Copy as path"). */
export function cleanPath(input: string): string {
  return input.trim().replace(/^["']+|["']+$/g, '').trim();
}

export function FolderPicker({ title, action, onPick, onCancel }: Props) {
  const recent = recentFolders();
  const [places, setPlaces] = useState<Place[]>([]);
  const [view, setView] = useState<BrowseResult | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Only the newest request counts: a slow listing must never replace the
  // folder the user typed or clicked in the meantime.
  const seq = useRef(0);
  const [loading, setLoading] = useState(true);
  async function go(dir: string) {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const r = await bridge.browse(cleanPath(dir));
      if (mine !== seq.current) return;
      setView(r);
      setTyped(r.dir);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }

  useEffect(() => {
    bridge.places().then((p) => setPlaces(p.places), (e: Error) => setError(e.message));
    void go(recent[0] ?? '');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function newFolder() {
    if (!view) return;
    const name = window.prompt('Name of the new folder:', 'My Card Games');
    if (!name) return;
    try {
      const r = await bridge.mkdir(view.dir, name.trim());
      await go(r.dir);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal folder-picker" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form
          className="fp-path"
          onSubmit={(e) => {
            e.preventDefault();
            void go(typed);
          }}
        >
          <button type="button" disabled={!view?.parent} onClick={() => view?.parent && go(view.parent)} title="Up one folder" aria-label="Up one folder">
            ↑
          </button>
          <input
            type="text"
            value={typed}
            onChange={(e) => {
              seq.current++;
              setLoading(false);
              setTyped(e.target.value);
            }} aria-label="Folder path" title="Type or paste a folder path and press Enter" spellCheck={false} />
          <button type="submit">Go</button>
        </form>
        {error && <p className="fp-error">{error}</p>}
        <div className="fp-body">
          <nav className="fp-places" aria-label="Places">
            {recent.length > 0 && <div className="fp-heading">Recent</div>}
            {recent.map((d) => (
              <button key={d} className="fp-place" onClick={() => go(d)} title={d}>
                {folderName(d)}
              </button>
            ))}
            <div className="fp-heading">Places</div>
            {places.map((p) => (
              <button key={p.path} className="fp-place" onClick={() => go(p.path)} title={p.path}>
                {p.name}
              </button>
            ))}
          </nav>
          <ul className="fp-list">
            {view && view.folders.length === 0 && <li className="muted fp-empty">No folders in here.</li>}
            {view?.folders.map((f) => (
              <li key={f.name}>
                <button className="fp-folder" onClick={() => go(`${view.dir}${view.dir.endsWith('\\') || view.dir.endsWith('/') ? '' : '/'}${f.name}`)}>
                  <span aria-hidden>📁</span> {f.name}
                  {f.kind && <span className="badge">{KIND_LABEL[f.kind]}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="modal-buttons">
          {view?.kind && <span className="fp-ok">✓ This folder is a Cardinal {KIND_LABEL[view.kind]}</span>}
          <button onClick={newFolder} disabled={!view}>
            New folder…
          </button>
          <span className="spacer" />
          <button onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            disabled={!view || loading || cleanPath(typed) !== view.dir}
            title={view && cleanPath(typed) !== view.dir ? 'Press Go (or Enter) to open the typed folder first' : undefined}
            onClick={() => view && onPick(view.dir)}
          >
            {action} “{view ? folderName(view.dir) : '…'}”
          </button>
        </div>
      </div>
    </div>
  );
}
