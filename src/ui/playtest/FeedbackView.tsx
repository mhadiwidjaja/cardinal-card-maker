import { useEffect, useState } from 'react';
import { FEEDBACK_VOTES } from '../../export/gallery';
import type { FileStore } from '../../fs/types';
import { keepFeedback, loadFeedback, parseFeedback, summarizeFeedback, type FeedbackFile } from '../../model/feedback';
import type { Game } from '../../model/types';
import { toast } from '../toast';
import { useEscape } from '../useEscape';

interface Props {
  game: Game;
  fs: FileStore;
  onClose: () => void;
}

export function FeedbackView({ game, fs, onClose }: Props) {
  useEscape(onClose);
  const [files, setFiles] = useState<FeedbackFile[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [memory, setMemory] = useState<FeedbackFile[]>([]);

  useEffect(() => {
    loadFeedback(fs, game).then((r) => {
      setFiles(r.files);
      setProblems(r.problems);
    });
  }, [fs, game, version]);

  async function importFiles(list: FileList | null) {
    if (!list) return;
    const bad: string[] = [];
    let n = 0;
    for (const f of [...list]) {
      const text = await f.text();
      try {
        if (fs.writable) await keepFeedback(fs, game, f.name, text);
        else setMemory((m) => [...m, parseFeedback(text)]);
        n++;
      } catch (e) {
        bad.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setProblems(bad);
    setVersion((v) => v + 1);
    if (n) toast(fs.writable ? `Added ${n} feedback file(s) to ${game.path ? `${game.path}/` : ''}feedback/` : `Read ${n} feedback file(s) (the demo keeps them until you close the page)`);
  }

  const all = [...files, ...memory];
  const summary = summarizeFeedback(all);
  const reviewers = new Set(all.map((f) => f.reviewer.toLowerCase())).size;
  const nameField = game.def.fields.find((f) => f.identifying)?.id ?? 'name';
  const nameOf = (key: string) => {
    const [setId, cardId] = key.split('/');
    const card = game.sets.find((s) => s.id === setId)?.cards.find((c) => c.id === cardId);
    return card ? card.values[nameField] || card.id : `${key} (no longer in the set)`;
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal feedback-view" role="dialog" aria-label="Playtester feedback" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Playtester feedback</h3>
        <p className="muted small">
          Export a <strong>Gallery page</strong> (Export tab) and send it to your playtesters. They rate cards in their browser and press <em>Send feedback</em>; add the files
          they send you here. A newer file from the same person replaces their older one.
        </p>
        <label className="file-button">
          Add feedback files…
          <input type="file" accept=".json,application/json" multiple onChange={(e) => void importFiles(e.target.files).finally(() => (e.target.value = ''))} />
        </label>
        {problems.length > 0 && (
          <ul className="warnings">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {summary.length === 0 ? (
          <p className="muted">No feedback yet.</p>
        ) : (
          <>
            <p aria-live="polite">
              {reviewers} playtester(s), {summary.length} card(s) rated.
            </p>
            <div className="table-wrap">
              <table className="feedback-table">
                <thead>
                  <tr>
                    <th>Card</th>
                    {FEEDBACK_VOTES.map(([id, label]) => (
                      <th key={id}>{label}</th>
                    ))}
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((c) => (
                    <tr key={c.key}>
                      <td>{nameOf(c.key)}</td>
                      {FEEDBACK_VOTES.map(([id]) => (
                        <td key={id} className={c.votes[id] && c.votes[id] * 2 >= c.reviewers && id !== 'fun' ? 'hot' : ''}>
                          {c.votes[id] || ''}
                        </td>
                      ))}
                      <td>
                        {c.notes.map((n, i) => (
                          <div key={i}>
                            <b>{n.reviewer}:</b> {n.text}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">Orange: at least half of the people who rated the card said so.</p>
          </>
        )}
        <div className="modal-buttons">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
