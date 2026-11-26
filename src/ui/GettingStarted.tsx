import { useEffect, useState } from 'react';
import type { Game, LayerPatch } from '../model/types';

type Flag = 'settings' | 'playtest' | 'export' | 'hidden';
const EVENT = 'card-maker:progress';
const flagKey = (game: string, f: Flag) => `card-maker:progress:${game}:${f}`;

function hasFlag(game: string, f: Flag): boolean {
  try {
    return localStorage.getItem(flagKey(game, f)) === '1';
  } catch {
    return false;
  }
}

export function markProgress(game: string, f: Flag) {
  try {
    if (localStorage.getItem(flagKey(game, f)) === '1') return;
    localStorage.setItem(flagKey(game, f), '1');
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

function hasFrameImage(game: Game): boolean {
  // Template files may hold partial layers (patches), so check loosely.
  const visit = (layers: LayerPatch[] | undefined): boolean =>
    (layers ?? []).some((l) => {
      const x = l as { type?: string; src?: unknown; layers?: LayerPatch[] };
      return (x.type === 'image' && typeof x.src === 'string' && x.src !== '' && !x.src.includes('{')) || visit(x.layers);
    });
  return Object.values(game.templates).some((t) => Object.values(t.faces).some((f) => visit(f.layers)));
}

const CARD_GOAL = 10;

export type StepTab = 'game' | 'templates' | 'cards' | 'playtest' | 'export';

interface Props {
  game: Game;
  gameKey: string;
  onGo: (tab: StepTab) => void;
}

export function GettingStarted({ game, gameKey, onGo }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  if (hasFlag(gameKey, 'hidden')) return null;

  const cards = game.sets.reduce((n, s) => n + s.cards.length, 0);
  const steps: { label: string; done: boolean; tab: StepTab; detail?: string }[] = [
    { label: 'Set the card size and fields', done: hasFlag(gameKey, 'settings'), tab: 'game' },
    { label: 'Put your frame artwork on a template', done: hasFrameImage(game), tab: 'templates' },
    { label: `Make ${CARD_GOAL} cards`, done: cards >= CARD_GOAL, tab: 'cards', detail: cards < CARD_GOAL ? `${cards}/${CARD_GOAL}` : undefined },
    { label: 'Playtest a game', done: hasFlag(gameKey, 'playtest'), tab: 'playtest' },
    { label: 'Export a print PDF', done: hasFlag(gameKey, 'export'), tab: 'export' },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  return (
    <div className="getting-started" aria-label="Getting started">
      <div className="gs-head">
        <span>Getting started</span>
        <span className="muted small">
          {done} of {steps.length}
        </span>
      </div>
      <div className="gs-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
        <div style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol>
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            <button className="link" onClick={() => onGo(s.tab)}>
              <span className="gs-check" aria-hidden>
                {s.done ? '✓' : '○'}
              </span>
              <span>
                {s.label}
                {s.detail && <span className="muted"> ({s.detail})</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <button className="link small muted" onClick={() => markProgress(gameKey, 'hidden')}>
        Hide this list
      </button>
    </div>
  );
}
