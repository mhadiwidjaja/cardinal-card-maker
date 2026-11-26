import { useEffect, useState } from 'react';
import { neverShown, stressCards } from '../../model/stress';
import type { Game } from '../../model/types';
import type { AssetStore } from '../../render/assets';
import { checkFace, type PrintIssue } from '../../render/preflight';
import { renderCard } from '../../render/renderCard';
import { useEscape } from '../useEscape';

interface Props {
  game: Game;
  templateId: string;
  assets: AssetStore;
  onClose: () => void;
}

interface Shot {
  label: string;
  url: string;
  issues: PrintIssue[];
}

const THUMB_PX = 230;

export function StressTest({ game, templateId, assets, onClose }: Props) {
  useEscape(onClose);
  const [shots, setShots] = useState<Shot[]>([]);
  const [total, setTotal] = useState(0);
  const hidden = neverShown(game, templateId);

  useEffect(() => {
    let alive = true;
    const cards = stressCards(game, templateId);
    setTotal(cards.length);
    setShots([]);
    (async () => {
      const dpi = (THUMB_PX / game.def.card.widthMm) * 25.4;
      for (const s of cards) {
        const canvas = document.createElement('canvas');
        const res = await renderCard(canvas, { game, card: s.card, face: 'front', dpi, bleed: false, mode: 'preview', templateId }, assets);
        // Only problems the content causes: overflow, and text that had to shrink too far.
        // (Text that is small by design, safe-zone and art issues are the same on every card; the print check lists those.)
        const shrunk = new Set(res.boxes.filter((b) => b.check?.fontSize !== undefined && b.check.designSize !== undefined && b.check.fontSize < b.check.designSize - 0.01).map((b) => b.id));
        const issues = checkFace(game, res.boxes, res.landscape).filter((i) => i.kind === 'overflow' || (i.kind === 'text-size' && i.layer !== undefined && shrunk.has(i.layer)));
        const shot = { label: s.label, url: canvas.toDataURL('image/png'), issues };
        if (!alive) return;
        setShots((list) => [...list, shot]);
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => {
      alive = false;
    };
  }, [game, templateId, assets]);

  const bad = shots.filter((s) => s.issues.length).length;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal stress-test" role="dialog" aria-label="Stress test" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Stress test: {game.templates[templateId]?.name ?? templateId}</h3>
        <p className="muted small">
          Made-up cards that push this template: the longest texts in the set, empty fields, and every combination of the choices it changes with.
          Nothing here is saved.
        </p>
        <p aria-live="polite">
          {shots.length < total ? `Drawing ${shots.length + 1} of ${total}…` : bad ? <strong className="error">{bad} of {total} break the layout.</strong> : <strong>✓ All {total} fit.</strong>}
        </p>
        {hidden.length > 0 && (
          <p className="warn-inline small">
            Never shown by any card yet (check them with the combinations below or a sample card):{' '}
            {hidden.map((h, i) => (
              <span key={h.layer}>
                {i ? ', ' : ''}
                <code>{h.layer}</code> <span className="muted">(if {h.showIf})</span>
              </span>
            ))}
          </p>
        )}
        <div className="stress-grid">
          {shots.map((s) => (
            <figure key={s.label} className={s.issues.length ? 'bad' : ''}>
              <img src={s.url} alt={s.label} />
              <figcaption>
                {s.label}
                {s.issues.map((i, k) => (
                  <div key={k} className={i.level}>
                    {i.layer && <code>{i.layer}</code>} {i.message}
                  </div>
                ))}
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="modal-buttons">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
