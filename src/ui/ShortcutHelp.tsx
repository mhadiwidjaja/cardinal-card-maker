import { useEffect } from 'react';
import { keys } from './keys';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Everywhere',
    keys: [
      ['Ctrl+S', 'Save all changes'],
      ['Ctrl+K', 'Search all actions (command bar)'],
      ['Alt+1 … Alt+6', 'Cards, Templates, Playtest, Statistics, Export, Game settings'],
      [`Ctrl+${String.fromCharCode(92)}`, 'Hide or show the sidebar'],
      ['Esc', 'Close a dialog or menu'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo (in the current tab)'],
      ['?', 'Show this list'],
    ],
  },
  {
    title: 'Cards',
    keys: [
      ['Arrows, Tab, Enter', 'Move between cells, edit a cell'],
      ['Alt+Enter', 'New line in rules text'],
      ['Ctrl+C / Ctrl+V', 'Copy and paste cells (works with Excel)'],
      ['Ctrl+D', 'Fill down'],
      ['Ctrl+H', 'Find and replace in this set'],
      ['Ctrl+J', 'Open or close the sheet (spreadsheet drawer)'],
      ['↑ ↓ in the card list', 'Previous / next card'],
      ['Esc', 'Cancel editing'],
    ],
  },
  {
    title: 'Templates',
    keys: [
      ['Arrows', 'Nudge the selected layer (Shift: 10 px)'],
      ['Delete', 'Delete the selected layer'],
    ],
  },
  {
    title: 'Playtest',
    keys: [
      ['D / S / N / U', 'Draw, shuffle your deck, next turn, untap your cards'],
      ['T / F', 'Tap or flip the card under the pointer'],
      ['P / H / X', 'Play it, return it to hand, discard it'],
      ['+ / −', 'Add or remove a counter on it'],
      ['Double-click', 'Play from hand, or tap on the table'],
      ['Right-click', 'All actions for a card, a pile or the table'],
      ['Shift+drag', 'Move a whole pile (or drag it by its name)'],
    ],
  },
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal shortcut-help" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <div className="sh-grid">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h4>{g.title}</h4>
              <dl>
                {g.keys.map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{keys(k)}</kbd>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="muted small">The full guide is docs/user-guide.md in Cardinal's source code, and on its GitHub page.</p>
        <div className="modal-buttons">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
