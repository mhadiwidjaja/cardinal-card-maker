import { useEffect, useState } from 'react';
import type { FileStore } from '../../fs/types';
import { changedSince, createTag, errataText, listTags, loadTag, type CardChange, type PlaytestTag } from '../../model/playtestTags';
import type { Card, CardSet, Game } from '../../model/types';
import type { AssetStore } from '../../render/assets';
import { renderCard } from '../../render/renderCard';
import { download, slug } from '../download';
import { toast } from '../toast';
import { useEscape } from '../useEscape';

interface Props {
  game: Game;
  fs: FileStore;
  assets: AssetStore;
  unsaved: boolean;
  onClose: () => void;
}

const THUMB_PX = 150;

export function PlaytestRounds({ game, fs, assets, unsaved, onClose }: Props) {
  useEscape(onClose);
  const [tags, setTags] = useState<PlaytestTag[] | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string>('');
  const [compare, setCompare] = useState<{ tag: PlaytestTag; then: Game; changes: CardChange[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listTags(fs, game)
      .then((t) => {
        setTags(t);
        setSelected((s) => s || t[0]?.slug || '');
      })
      .catch((e: Error) => setError(e.message));
  }, [fs, game]);

  useEffect(() => {
    const tag = tags?.find((t) => t.slug === selected);
    if (!tag) return setCompare(null);
    let alive = true;
    loadTag(fs, game, tag.slug)
      .then((then) => alive && setCompare({ tag, then, changes: changedSince(then, game) }))
      .catch((e: Error) => alive && setError(`Could not open the snapshot: ${e.message}`));
    return () => {
      alive = false;
    };
  }, [fs, game, tags, selected]);

  async function snapshot() {
    setBusy(true);
    try {
      const tag = await createTag(fs, game, name || `Playtest ${(tags?.length ?? 0) + 1}`);
      const t = await listTags(fs, game);
      setTags(t);
      setSelected(tag.slug);
      setName('');
      toast(`Snapshot “${tag.name}” saved in ${game.path ? `${game.path}/` : ''}playtests/${tag.slug}`);
    } catch (e) {
      setError(`Could not save the snapshot: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const errata = compare ? errataText(game, compare.tag, compare.changes) : '';
  const reprint = compare?.changes.filter((c) => c.kind !== 'removed').length ?? 0;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal rounds" role="dialog" aria-label="Playtest rounds" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Playtest rounds</h3>
        <p className="muted small">
          Take a snapshot when you print cards for a playtest. Later, see what changed since then, print only those cards, and hand out the list of changes.
        </p>
        {error && <p className="banner error">{error}</p>}
        <div className="inline rounds-new">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Playtest ${(tags?.length ?? 0) + 1}`} aria-label="Snapshot name" disabled={!fs.writable} />
          <button onClick={snapshot} disabled={busy || !fs.writable || unsaved}>
            Take snapshot
          </button>
          {!fs.writable && <span className="muted small">The demo is read-only; copy it to a folder to take snapshots.</span>}
          {fs.writable && unsaved && <span className="warn-inline small">Save first: the snapshot copies the saved files.</span>}
        </div>

        {tags && tags.length > 0 && (
          <>
            <label className="inline">
              Changes since
              <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Compare with snapshot">
                {tags.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name} ({t.date.slice(0, 10)})
                  </option>
                ))}
              </select>
            </label>
            {compare && (
              <>
                <p aria-live="polite">
                  {compare.changes.length === 0 ? (
                    <strong>✓ Nothing changed since “{compare.tag.name}”.</strong>
                  ) : (
                    <>
                      <strong>{reprint} card(s) to reprint</strong>
                      {compare.changes.some((c) => c.kind === 'removed') && <>, {compare.changes.filter((c) => c.kind === 'removed').length} removed</>}. To print just these, choose “Changed since {compare.tag.name}” under <em>Cards from</em> in the
                      Export tab.
                    </>
                  )}
                </p>
                {compare.changes.length > 0 && (
                  <div className="inline">
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(errata).then(
                          () => toast('List of changes copied'),
                          () => setError('Could not copy; use Download instead.'),
                        )
                      }
                    >
                      Copy list of changes
                    </button>
                    <button onClick={() => download(`${slug(game.def.name)}-changes-since-${compare.tag.slug}.txt`, errata, 'text/plain')}>Download list</button>
                  </div>
                )}
                <ul className="rounds-list">
                  {compare.changes.map((c) => (
                    <li key={`${c.setId}/${c.cardId}`}>
                      <div className="rounds-pics">
                        {c.then && <Thumb game={compare.then} set={c.then.set} card={c.then.card} assets={assets} label="before" />}
                        {c.now && <Thumb game={game} set={c.now.set} card={c.now.card} assets={assets} label="now" />}
                      </div>
                      <div>
                        <strong>{c.name}</strong> <span className="muted small">{c.kind === 'added' ? 'new card' : c.kind === 'removed' ? 'removed' : c.looks && !c.fields.length ? 'new look' : ''}</span>
                        <ul>
                          {c.fields.map((f) => (
                            <li key={f.field}>
                              <code>{f.field}</code> {f.from || '(empty)'} → <b>{f.to || '(empty)'}</b>
                            </li>
                          ))}
                          {c.looks && c.fields.length > 0 && <li className="muted">and a new look (template changed)</li>}
                        </ul>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <div className="modal-buttons">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Thumb({ game, set, card, assets, label }: { game: Game; set: CardSet; card: Card; assets: AssetStore; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const canvas = document.createElement('canvas');
    renderCard(canvas, { game, set, card, face: 'front', dpi: (THUMB_PX / game.def.card.widthMm) * 25.4, bleed: false, mode: 'export' }, assets).then(() => alive && setUrl(canvas.toDataURL('image/png')));
    return () => {
      alive = false;
    };
  }, [game, set, card, assets]);
  return (
    <figure>
      {url ? <img src={url} alt={`${label}`} /> : <div className="rounds-ph" />}
      <figcaption>{label}</figcaption>
    </figure>
  );
}
