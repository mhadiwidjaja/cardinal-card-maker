import { lintWording, type LintFinding } from '../../model/lint';
import type { Game } from '../../model/types';
import { useEscape } from '../useEscape';

interface Props {
  game: Game;
  onShow: (setId: string, cardId: string) => void;
  currentSet: string;
  onClose: () => void;
}

const TITLES: Record<LintFinding['kind'], string> = {
  'keyword-typo': 'Misspelled keywords',
  'keyword-case': 'Keywords written differently',
  'two-wordings': 'Same effect, different wording',
  style: 'House style',
  spacing: 'Spacing',
};

export function WordingDialog({ game, onShow, currentSet, onClose }: Props) {
  useEscape(onClose);
  const findings = lintWording(game);
  const kinds = Object.keys(TITLES) as LintFinding['kind'][];

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal wording" role="dialog" aria-label="Wording check" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Wording check</h3>
        <p className="muted small">
          Looks through the rules text of every card for misspelled keywords (they get no reminder text), the same effect worded two ways, and your house style rules
          (<code>style</code> in game.json). Click a card to go to it; use Replace… to fix many at once.
        </p>
        {findings.length === 0 ? (
          <p>
            <strong>✓ Nothing to report.</strong>
          </p>
        ) : (
          kinds
            .filter((k) => findings.some((f) => f.kind === k))
            .map((k) => (
              <section key={k}>
                <h4>{TITLES[k]}</h4>
                <ul className="wording-list">
                  {findings
                    .filter((f) => f.kind === k)
                    .map((f, i) => (
                      <li key={i}>
                        {f.message}
                        {f.kind !== 'two-wordings' && f.suggestion && <span className="muted"> → {f.suggestion}</span>}
                        <div className="wording-cards">
                          {f.cards.map((c) =>
                            c.setId === currentSet ? (
                              <button key={`${c.cardId}:${c.field}`} className="link" onClick={() => onShow(c.setId, c.cardId)}>
                                {c.name}
                              </button>
                            ) : (
                              <span key={`${c.cardId}:${c.field}`} className="muted">
                                {c.name}
                              </span>
                            ),
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              </section>
            ))
        )}
        <div className="modal-buttons">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
