import { useEffect, useRef, useState } from 'react';
import { demoWorkspaceFs } from '../model/demo';
import { loadWorkspace } from '../model/load';
import type { Workspace } from '../model/types';
import { AssetStore } from '../render/assets';
import { renderCard, type RenderWarning } from '../render/renderCard';
import { installGoldenHook } from './golden';

/**
 * Development aid: http://localhost:5173/?sheet renders every demo card (and
 * one back) in a grid, so renderer changes can be checked at a glance.
 * `&mode=export` hides preview-only placeholders; `&face=back` shows backs.
 * `&golden` instead installs the hook the golden-image browser test uses (golden.ts).
 */
export function DevSheet() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') === 'export' ? 'export' : 'preview';
  const face = params.get('face') ?? 'front';
  const golden = params.has('golden');
  const [goldenReady, setGoldenReady] = useState(false);

  useEffect(() => {
    if (golden) void installGoldenHook().then(() => setGoldenReady(true));
    else loadWorkspace(demoWorkspaceFs()).then(setWs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (golden) return <p className="golden-status">{goldenReady ? 'Golden-image test hook ready.' : 'Loading…'}</p>;
  if (!ws) return <p>Loading…</p>;
  const game = ws.games[0]!;
  const set = game.sets[0]!;
  const assets = new AssetStore(demoWorkspaceFs(), game);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, background: '#888' }}>
      {set.cards.map((card) => (
        <Tile key={card.id} render={(c) => renderCard(c, { game, set, card, face, bleed: false, mode, dpi: 100 }, assets).then((r) => r.warnings)} />
      ))}
    </div>
  );
}

function Tile({ render }: { render: (c: HTMLCanvasElement) => Promise<RenderWarning[]> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [warnings, setWarnings] = useState<RenderWarning[]>([]);
  useEffect(() => {
    if (ref.current) render(ref.current).then(setWarnings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ width: 248, font: '10px sans-serif', color: '#300' }}>
      <canvas ref={ref} style={{ width: 248, display: 'block' }} />
      {warnings.map((w, i) => (
        <div key={i}>
          {w.layer}: {w.message}
        </div>
      ))}
    </div>
  );
}
