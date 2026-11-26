import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { CommandProvider } from './ui/commands';
import './ui/app.css';
import './ui/editor.css';
import './ui/grid.css';
import './ui/stats/stats.css';
import './ui/export/export.css';
import './ui/game/game.css';
// The design language last, so its tokens and base styles win (docs/design.md).
import './ui/theme.css';

// The downloadable app quits when its last window closes; this open connection is how it knows a window is still there.
const session = document.querySelector<HTMLMetaElement>('meta[name="card-maker-session"]')?.content;
if (session) new EventSource(session);

const DevSheet = lazy(() => import('./ui/DevSheet').then((m) => ({ default: m.DevSheet })));
const devSheet = import.meta.env.DEV && new URLSearchParams(window.location.search).has('sheet');

createRoot(document.getElementById('root')!).render(<StrictMode>{devSheet ? <Suspense fallback={null}><DevSheet /></Suspense> : (
  <CommandProvider>
    <App />
  </CommandProvider>
)}</StrictMode>);
