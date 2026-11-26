import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cardProblems } from '../../model/cardOps';
import type { CardSet, Game } from '../../model/types';
import { cardKey } from '../../playtest/decks';
import type { AssetStore } from '../../render/assets';
import { useCardImages } from '../playtest/useCardImages';

interface Props {
  game: Game;
  set: CardSet;
  rows: number[];
  focusCard: number | null;
  onFocusCard: (index: number) => void;
  assets: AssetStore;
  assetVersion: number;
}

const THUMB_PX = 72;

export function CardList({ game, set, rows, focusCard, onFocusCard, assets, assetVersion }: Props) {
  const nameField = game.def.fields.find((f) => f.identifying)?.id ?? 'name';
  const tf = game.def.fields.find((f) => f.source === 'templates')?.id;
  const listRef = useRef<HTMLUListElement>(null);
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const keys = rows.map((i) => cardKey(set, set.cards[i]!));
  const keyList = keys.join('\n');
  const ordered = [...keys.filter((k) => visible.has(k)), ...keys.filter((k) => !visible.has(k))];
  const images = useCardImages(game, assets, ordered, assetVersion, { widthPx: THUMB_PX, backs: false });
  const problems = useMemo(() => set.cards.map((c) => cardProblems(game, c).size), [game, set.cards]);

  // Rows on screen render first; the rest follow in list order.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const shown = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const k = (e.target as HTMLElement).dataset.key!;
          if (e.isIntersecting) shown.add(k);
          else shown.delete(k);
        }
        setVisible(new Set(shown));
      },
      { root: list, rootMargin: '200px 0px' },
    );
    list.querySelectorAll<HTMLElement>('li[data-key]').forEach((li) => io.observe(li));
    return () => io.disconnect();
  }, [keyList]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [focusCard]);

  const key = (e: KeyboardEvent) => {
    const at = focusCard === null ? -1 : rows.indexOf(focusCard);
    const go = (pos: number) => {
      const i = rows[Math.max(0, Math.min(rows.length - 1, pos))];
      if (i !== undefined) onFocusCard(i);
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <ul className="card-list" role="listbox" aria-label="Cards" tabIndex={0} onKeyDown={key} ref={listRef}>
      {rows.map((i) => {
        const card = set.cards[i]!;
        const img = images.get(cardKey(set, card));
        return (
          <li key={card.id + ':' + i} data-key={cardKey(set, card)} role="option" aria-selected={i === focusCard} className={i === focusCard ? 'on' : ''} onClick={() => onFocusCard(i)}>
            <span className="cl-thumb">{img ? <img src={img.front} alt="" /> : null}</span>
            <span className="cl-text">
              <span className="cl-name">{card.values[nameField] || card.id}</span>
              <span className="cl-meta">
                {String(i + 1).padStart(3, '0')}
                {tf && card.values[tf] ? ` · ${card.values[tf]}` : ''}
              </span>
            </span>
            {problems[i]! > 0 && (
              <span className="cl-problem" title={`${problems[i]} value(s) need a look`}>
                {problems[i]}
              </span>
            )}
          </li>
        );
      })}
      {rows.length === 0 && <li className="muted cl-empty">No cards{set.cards.length ? ' match the filter' : ' yet'}.</li>}
    </ul>
  );
}
