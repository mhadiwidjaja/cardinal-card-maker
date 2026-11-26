import { useEffect, useRef, useState } from 'react';
import { hasFace, onWhite } from '../../export/exporters';
import { findCard } from '../../playtest/decks';
import type { Card, Game, GameDef, TemplateDef } from '../../model/types';
import type { AssetStore } from '../../render/assets';
import { renderCard } from '../../render/renderCard';

export interface CardImages {
  front: string;
  back: string | null;
  frontLandscape: boolean;
  backLandscape: boolean;
}

interface Entry {
  card: Card;
  templates: Record<string, TemplateDef>;
  def: GameDef;
  version: number;
  images: CardImages;
}

const WIDTH_PX = 360;

async function toUrl(game: Game, card: Card, set: Parameters<typeof renderCard>[1]['set'], face: string, assets: AssetStore, widthPx = WIDTH_PX): Promise<{ url: string; landscape: boolean }> {
  const canvas = document.createElement('canvas');
  const dpi = (widthPx / game.def.card.widthMm) * 25.4;
  const res = await renderCard(canvas, { game, set, card, face, dpi, bleed: false, mode: 'export' }, assets);
  const white = onWhite(canvas);
  const blob =
    white instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>((r) => white.toBlob(r, 'image/jpeg', 0.9))
      : await white.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return { url: blob ? URL.createObjectURL(blob) : '', landscape: res.landscape };
}

export function useCardImages(game: Game, assets: AssetStore, keys: string[], version: number, opts: { widthPx?: number; backs?: boolean } = {}): Map<string, CardImages> {
  const widthPx = opts.widthPx ?? WIDTH_PX;
  const backs = opts.backs ?? true;
  const cache = useRef(new Map<string, Entry>());
  const [, setTick] = useState(0);
  const wanted = [...new Set(keys)].join('\n');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const key of wanted ? wanted.split('\n') : []) {
        if (cancelled) return;
        const found = findCard(game, key);
        if (!found) continue;
        const old = cache.current.get(key);
        if (old && old.card === found.card && old.templates === game.templates && old.def === game.def && old.version === version) continue;
        try {
          const f = await toUrl(game, found.card, found.set, 'front', assets, widthPx);
          const b = backs && hasFace(game, found.card, 'back') ? await toUrl(game, found.card, found.set, 'back', assets, widthPx) : null;
          if (old) {
            URL.revokeObjectURL(old.images.front);
            if (old.images.back) URL.revokeObjectURL(old.images.back);
          }
          cache.current.set(key, { card: found.card, templates: game.templates, def: game.def, version, images: { front: f.url, back: b?.url ?? null, frontLandscape: f.landscape, backLandscape: b?.landscape ?? false } });
          if (!cancelled) setTick((t) => t + 1);
        } catch {
          // A card that can't be drawn shows as a blank card; the Cards tab explains why.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game, assets, wanted, version, widthPx, backs]);

  useEffect(() => {
    const c = cache.current;
    return () => {
      for (const e of c.values()) {
        URL.revokeObjectURL(e.images.front);
        if (e.images.back) URL.revokeObjectURL(e.images.back);
      }
      c.clear();
    };
  }, []);

  const out = new Map<string, CardImages>();
  for (const [k, e] of cache.current) out.set(k, e.images);
  return out;
}
