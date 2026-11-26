import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { readStored, writeStored } from './stored';

export interface PanelSize {
  initial: number;
  min: number;
  max: number;
}

const KEY = 'card-maker:panel:';
const KEEP_FOR_MAIN = 320;

export function clampWidth(width: number, size: PanelSize, windowWidth: number): number {
  const max = Math.max(size.min, Math.min(size.max, windowWidth - KEEP_FOR_MAIN));
  return Math.round(Math.max(size.min, Math.min(max, width)));
}

function readWidth(id: string, size: PanelSize): number {
  const v = Number(readStored(KEY + id, 0));
  return Number.isFinite(v) && v > 0 ? clampWidth(v, size, window.innerWidth) : size.initial;
}

function storeWidth(id: string, width: number | null) {
  writeStored(KEY + id, width ?? undefined);
}

export function usePanelWidth(id: string, size: PanelSize): [number, (w: number | null) => void] {
  const [width, setWidth] = useState(() => readWidth(id, size));
  const set = useCallback(
    (w: number | null) => {
      const next = w === null ? size.initial : clampWidth(w, size, window.innerWidth);
      setWidth(next);
      storeWidth(id, w === null ? null : next);
    },
    [id, size],
  );
  return [width, set];
}

interface HandleProps {
  panel: 'left' | 'right';
  width: number;
  size: PanelSize;
  onWidth: (w: number | null) => void;
  label: string;
}

export function ResizeHandle({ panel, width, size, onWidth, label }: HandleProps) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);
  const sign = panel === 'left' ? 1 : -1;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
    setActive(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onWidth(drag.current.width + sign * (e.clientX - drag.current.x));
  };
  const up = () => {
    drag.current = null;
    setActive(false);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') onWidth(width - sign * step);
    else if (e.key === 'ArrowRight') onWidth(width + sign * step);
    else if (e.key === 'Home' || e.key === 'Enter') onWidth(null);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={'resize-handle' + (active ? ' active' : '')}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={size.min}
      aria-valuemax={size.max}
      tabIndex={0}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onWidth(null)}
      onKeyDown={key}
    />
  );
}
