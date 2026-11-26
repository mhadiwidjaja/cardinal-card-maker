import { useRef, useState } from 'react';
import { hasFace, type ExportItem } from '../../export/exporters';
import type { Game } from '../../model/types';
import type { AssetStore } from '../../render/assets';
import { checkFace, gamutMask, type PrintIssue } from '../../render/preflight';
import { renderCard } from '../../render/renderCard';

interface Props {
  game: Game;
  items: ExportItem[];
  assets: AssetStore;
  gamut: ((r: number, g: number, b: number) => number) | null;
  profileName: string | null;
}

interface CardResult {
  label: string;
  issues: PrintIssue[];
  gamutPreview?: string;
}

/** Resolution for checking; facts don't depend on it, and colours only need a sample. */
const CHECK_DPI = 100;
/** A colour issue is reported when more of the card than this is out of the press's range. */
const GAMUT_MIN_RATIO = 0.005;

export function PrintCheck({ game, items, assets, gamut, profileName }: Props) {
  const [results, setResults] = useState<CardResult[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const cancel = useRef(false);
  const nameField = game.def.fields.find((f) => f.identifying)?.id ?? 'name';

  async function run() {
    cancel.current = false;
    const out: CardResult[] = [];
    for (let i = 0; i < items.length && !cancel.current; i++) {
      const it = items[i]!;
      const name = it.card.values[nameField] || it.card.id;
      setProgress(`${i + 1}/${items.length} · ${name}`);
      for (const face of ['front', 'back']) {
        if (face === 'back' && !hasFace(game, it.card, 'back')) continue;
        const canvas = document.createElement('canvas');
        const res = await renderCard(canvas, { game, set: it.set, card: it.card, face, dpi: CHECK_DPI, bleed: true, mode: 'export' }, assets);
        const issues = checkFace(game, res.boxes, res.landscape);
        let gamutPreview: string | undefined;
        if (gamut) {
          const ctx = canvas.getContext('2d')!;
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const { ratio, mask } = gamutMask(img.data, gamut);
          if (ratio > GAMUT_MIN_RATIO) {
            issues.push({
              kind: 'colour',
              level: ratio > 0.05 ? 'error' : 'warning',
              message: `${(ratio * 100).toFixed(1)}% of the card uses colours ${profileName ?? 'the press'} can't print closely; they will print duller (magenta in the picture)`,
            });
            for (let p = 0; p < mask.length; p++) {
              if (!mask[p]) continue;
              img.data.set([255, 0, 255, 255], p * 4);
            }
            ctx.putImageData(img, 0, 0);
            gamutPreview = canvas.toDataURL('image/png');
          }
        }
        if (issues.length) out.push({ label: face === 'front' ? name : `${name} (${face})`, issues, gamutPreview });
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    setProgress(null);
    setResults(out);
  }

  const errors = results?.reduce((n, r) => n + r.issues.filter((i) => i.level === 'error').length, 0) ?? 0;
  const warnings = results?.reduce((n, r) => n + r.issues.filter((i) => i.level === 'warning').length, 0) ?? 0;

  return (
    <section className="print-check">
      <h3>Print check</h3>
      <p className="muted small">
        Finds what a print shop would print exactly as it is: art with too few pixels, text shrunk too small, text past the safe zone, very thin lines
        {gamut ? `, and colours ${profileName ?? 'the profile'} can't print.` : '. To also check colours, choose CMYK with your print shop’s profile above.'}
      </p>
      <div className="inline">
        <button onClick={run} disabled={progress !== null || !items.length}>
          Check {items.length} cards for print
        </button>
        {progress && (
          <>
            <span className="muted small">{progress}</span>
            <button onClick={() => (cancel.current = true)}>Stop</button>
          </>
        )}
      </div>
      {results && (
        <div className="pc-results" aria-live="polite">
          <p>
            {results.length === 0 ? (
              <strong>✓ No print problems found.</strong>
            ) : (
              <>
                <strong>{errors} problem(s)</strong> and <strong>{warnings} warning(s)</strong> on {results.length} card face(s).
              </>
            )}
          </p>
          <ul className="pc-list">
            {results.map((r) => (
              <li key={r.label}>
                <strong>{r.label}</strong>
                <ul>
                  {r.issues.map((i, k) => (
                    <li key={k} className={i.level}>
                      {i.layer && <code>{i.layer}</code>} {i.message}
                    </li>
                  ))}
                </ul>
                {r.gamutPreview && <img className="pc-gamut" src={r.gamutPreview} alt={`${r.label}: colours out of the press's range in magenta`} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
