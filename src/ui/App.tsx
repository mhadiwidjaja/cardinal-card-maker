import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrowserFs, ensurePermission, isFileSystemAccessSupported, pickDirectory } from '../fs/browserFs';
import { backupWorkspace } from '../fs/backup';
import { copyTree } from '../fs/copy';
import { loadLastWorkspace, saveLastWorkspace } from '../fs/handleStore';
import { bridge, folderName, isBridgeAvailable, lastFolderPath, recentFolders, rememberFolder, ServerFs } from '../fs/serverFs';
import { demoWorkspaceFs } from '../model/demo';
import { AssetStore } from '../render/assets';
import { clearMeasureCache } from '../render/renderCard';
import { CardsView } from './CardsView';
import { IssueList } from './IssueList';
import { gameKey, useProject, type Recovery } from './store';
import { joinPath, type FileStore } from '../fs/types';
import { setColumns } from '../model/cardOps';
import type { CardSet } from '../model/types';
import { slug } from './download';
import { NewGameDialog } from './game/NewGameDialog';
import { newGame } from '../model/gameOps';
import { FolderPicker } from './FolderPicker';
import { toast, Toasts } from './toast';
import { GettingStarted, markProgress } from './GettingStarted';
import { ShortcutHelp } from './ShortcutHelp';
import { ResizeHandle, usePanelWidth, type PanelSize } from './ResizeHandle';
import { CommandBar, useCommands, type Command } from './commands';
import { LogoMark } from './LogoMark';
import { RailIcon } from './RailIcon';
import { readStored, writeStored } from './stored';
import { keys } from './keys';

const VIEWS = {
  TemplatesView: () => import('./editor/TemplatesView'),
  StatsView: () => import('./stats/StatsView'),
  ExportView: () => import('./export/ExportView'),
  GameView: () => import('./game/GameView'),
  PlaytestView: () => import('./playtest/PlaytestView'),
};
const TemplatesView = lazy(() => VIEWS.TemplatesView().then((m) => ({ default: m.TemplatesView })));
const StatsView = lazy(() => VIEWS.StatsView().then((m) => ({ default: m.StatsView })));
const ExportView = lazy(() => VIEWS.ExportView().then((m) => ({ default: m.ExportView })));
const GameView = lazy(() => VIEWS.GameView().then((m) => ({ default: m.GameView })));
const PlaytestView = lazy(() => VIEWS.PlaytestView().then((m) => ({ default: m.PlaytestView })));

const SIDEBAR_KEYS = keys(`Ctrl+${String.fromCharCode(92)}`);
const SIDEBAR: PanelSize = { initial: 240, min: 160, max: 520 };

const DEMO_FOLDER = 'Cardinal demo';

type Tab = 'cards' | 'templates' | 'playtest' | 'stats' | 'export' | 'game';
// Most-used first, settings last (serial position effect).
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'cards', label: 'Cards', hint: 'Edit your cards in a spreadsheet with a live preview' },
  { id: 'templates', label: 'Templates', hint: 'Design how each kind of card looks' },
  { id: 'playtest', label: 'Playtest', hint: 'Shuffle a deck and play test games' },
  { id: 'stats', label: 'Statistics', hint: 'Cost curve and counts for any field' },
  { id: 'export', label: 'Export', hint: 'Print PDF, PNG images, Tabletop Simulator' },
  { id: 'game', label: 'Game settings', hint: 'Card size, fields, icons, keywords, fonts' },
];
const SIDEBAR_HIDDEN = 'card-maker:sidebar-hidden';
const RAIL_LABEL: Record<Tab, string> = { cards: 'Cards', templates: 'Templates', playtest: 'Playtest', stats: 'Stats', export: 'Export', game: 'Settings' };

type Recent = { kind: 'handle'; handle: FileSystemDirectoryHandle } | { kind: 'path'; path: string };
const recentName = (r: Recent) => (r.kind === 'handle' ? r.handle.name : folderName(r.path));

export function App() {
  const project = useProject();
  const { fs, workspace, busy, error } = project;
  const [selection, setSelection] = useState({ game: 0, set: 0 });
  const [sidebarW, setSidebarW] = usePanelWidth('sidebar', SIDEBAR);
  const [tab, setTab] = useState<Tab>('cards');
  // Views keep their state (e.g. undo history) once opened, so they stay mounted.
  const [visited, setVisited] = useState<Set<Tab>>(new Set(['cards']));
  useEffect(() => setVisited((v) => (v.has(tab) ? v : new Set([...v, tab]))), [tab]);
  const [assetVersion, setAssetVersion] = useState(0);
  const [picker, setPicker] = useState<null | 'open' | 'copy'>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [commandBar, setCommandBar] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => readStored<number>(SIDEBAR_HIDDEN, 0) === 1);
  const toggleSidebar = () =>
    setSidebarHidden((h) => {
      writeStored(SIDEBAR_HIDDEN, h ? 0 : 1);
      return !h;
    });

  const params = useMemo(() => new URLSearchParams(window.location.search), []);

  // The other tabs load after startup, so the first switch to one is instant.
  useEffect(() => {
    const t = setTimeout(() => Object.values(VIEWS).forEach((load) => load().catch(() => {})), 1500);
    return () => clearTimeout(t);
  }, []);
  // Chrome/Edge open folders themselves. Other browsers (Firefox, Zen) go through the local server.
  // (?bridge forces the server route in Chrome, for testing.)
  const native = isFileSystemAccessSupported() && !(import.meta.env.DEV && params.has('bridge'));
  const viaServer = !native && isBridgeAvailable();
  const canOpen = native || viaServer;
  const [last, setLast] = useState<Recent | null>(null);

  // StrictMode runs effects twice in development; opening twice would replace the first view (and any edit made in it).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (native) loadLastWorkspace().then((h) => h && setLast({ kind: 'handle', handle: h }));
    else if (viaServer) {
      const p = lastFolderPath();
      if (p) setLast({ kind: 'path', path: p });
    }
    if (params.has('demo')) void project.open(demoWorkspaceFs());
    // Development/testing only: ?opfs opens an editable copy of the demo in the
    // browser's private storage (no folder picker needed, used by e2e tests).
    if (import.meta.env.DEV && params.has('opfs')) {
      void (async () => {
        const root = await navigator.storage.getDirectory();
        const store = new BrowserFs(root, 'opfs:dev');
        if (params.has('fresh')) for (const e of await store.list('')) await root.removeEntry(e.name, { recursive: true });
        if ((await store.list('')).length === 0) await copyTree(demoWorkspaceFs(), store);
        await project.open(store);
      })();
    }
    const t = params.get('tab') as Tab | null;
    if (t) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One asset cache per game; rebuilt when a workspace is opened or reloaded.
  // (Edits don't rebuild it: game identity changes, but the files don't.)
  const gameKeys = workspace?.games.map(gameKey).join('|') ?? '';
  const assetStores = useMemo(() => {
    const map = new Map<string, AssetStore>();
    if (fs && workspace) for (const g of workspace.games) map.set(gameKey(g), new AssetStore(fs, g));
    clearMeasureCache();
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs, gameKeys, workspace?.def]);
  if (workspace) for (const g of workspace.games) assetStores.get(gameKey(g))?.updateGame(g);
  const [creatingGame, setCreatingGame] = useState(false);

  // When the window regains focus, pick up images changed in other programs.
  // Only images whose file changed are reloaded, and views redraw only if one did.
  useEffect(() => {
    const onFocus = async () => {
      let changed = false;
      for (const a of assetStores.values()) {
        try {
          if (await a.refreshChanged()) changed = true;
        } catch {
          // A folder that can't be read right now: try again on the next focus.
        }
      }
      if (changed) setAssetVersion((v) => v + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [assetStores]);

  async function save() {
    const n = project.dirtyCount;
    if (!n) return;
    const r = await project.save();
    if (!r.ok) return;
    const saved = n === 1 ? 'Saved' : `Saved ${n} files`;
    toast(r.backup ? `${saved}. The files as they were before are backed up in ${r.backup.folder}.` : saved);
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  const toggleSidebarRef = useRef(toggleSidebar);
  toggleSidebarRef.current = toggleSidebar;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandBar((o) => !o);
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'Backslash') {
        e.preventDefault();
        toggleSidebarRef.current();
      } else if (e.altKey && !e.ctrlKey && /^Digit[1-6]$/.test(e.code)) {
        e.preventDefault();
        setTab(TABS[Number(e.code.slice(5)) - 1]!.id);
      } else if (e.key === '?' && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) {
        setHelp(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const confirmLeave = () => !project.dirtyCount || window.confirm('You have unsaved changes. Open another folder anyway? (Your changes will be lost.)');

  async function openStore(store: FileStore) {
    setSelection({ game: 0, set: 0 });
    await project.open(store);
  }

  async function openFolder() {
    if (!confirmLeave()) return;
    if (viaServer) return setPicker('open');
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      await saveLastWorkspace(handle);
      setLast({ kind: 'handle', handle });
      await openStore(new BrowserFs(handle));
    } catch (e) {
      project.setError((e as Error).message);
    }
  }

  async function openPath(path: string) {
    rememberFolder(path);
    setLast({ kind: 'path', path });
    await openStore(new ServerFs(path));
  }

  async function reopen(r: Recent) {
    if (!confirmLeave()) return;
    try {
      if (r.kind === 'path') return await openPath(r.path);
      if (!(await ensurePermission(r.handle))) {
        project.setError(`Permission to open "${r.handle.name}" was not granted.`);
        return;
      }
      await openStore(new BrowserFs(r.handle));
    } catch (e) {
      project.setError((e as Error).message);
    }
  }

  /**
   * Copies the demo into a folder. A folder that already has files gets a new
   * "Cardinal demo" folder inside it instead, so nothing is mixed in or overwritten.
   */
  async function copyDemoInto(target: FileStore, inSubfolder: (name: string) => Promise<FileStore>, remember: (store: FileStore) => Promise<void> | void) {
    if ((await target.list('')).length) {
      if (!window.confirm(`“${target.name}” already has files in it. Put the demo in a new folder “${DEMO_FOLDER}” inside it?`)) return;
      target = await inSubfolder(DEMO_FOLDER);
      if ((await target.list('').catch(() => [])).length) {
        project.setError(`“${target.name}” already exists and isn’t empty. Pick an empty folder for the demo.`);
        return;
      }
    }
    const n = await copyTree(demoWorkspaceFs(), target);
    await remember(target);
    await openStore(target);
    toast(`Copied ${n} files into “${target.name}”. This copy is yours to edit.`);
  }

  async function copyDemo() {
    if (viaServer) return setPicker('copy');
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      let chosen = handle;
      await copyDemoInto(
        new BrowserFs(handle),
        async (name) => new BrowserFs((chosen = await handle.getDirectoryHandle(name, { create: true }))),
        async () => {
          await saveLastWorkspace(chosen);
          setLast({ kind: 'handle', handle: chosen });
        },
      );
    } catch (e) {
      project.setError((e as Error).message);
    }
  }

  async function backUp() {
    if (!fs) return;
    try {
      if (project.dirtyCount && window.confirm('Save your changes first, so they are included in the backup?')) await project.save();
      const r = await backupWorkspace(fs);
      toast(`Backed up ${r.files} files to ${r.folder}`);
    } catch (e) {
      project.setError(`Backup failed: ${(e as Error).message}`);
    }
  }

  function newSet(gi: number) {
    const g = workspace?.games[gi];
    if (!g) return;
    const name = window.prompt('Name of the new set:', 'New Set');
    if (!name) return;
    let id = slug(name);
    while (g.sets.some((s) => s.id === id)) id += '-2';
    const set: CardSet = { id, path: joinPath(g.path, 'sets', id), def: { formatVersion: 1, name }, columns: [], cards: [] };
    set.columns = setColumns(g, set);
    project.addSet(gameKey(g), set);
    setSelection({ game: gi, set: g.sets.length });
    setTab('cards');
  }

  const game = workspace?.games[selection.game];
  const set = game?.sets[selection.set];
  const assets = game ? assetStores.get(gameKey(game)) : undefined;
  useEffect(() => {
    if (tab === 'game' && game && fs?.writable) markProgress(gameKey(game), 'settings');
  }, [tab, game, fs]);

  const globalCommands: Command[] = [
    ...TABS.map((t, i) => ({ id: `go-${t.id}`, group: 'Go to', label: t.label, keys: `Alt+${i + 1}`, run: () => setTab(t.id), keywords: t.hint })),
    { id: 'save', group: 'File', label: 'Save all changes', keys: 'Ctrl+S', run: () => void save(), disabled: !project.dirtyCount || !fs?.writable },
    { id: 'open', group: 'File', label: 'Open folder…', run: () => void openFolder(), disabled: !canOpen },
    { id: 'demo', group: 'File', label: 'Open the demo', run: () => void openStore(demoWorkspaceFs()) },
    ...(fs?.writable ? [{ id: 'backup', group: 'File', label: 'Back up now', run: () => void backUp() }] : []),
    { id: 'reload', group: 'File', label: 'Reload from disk', run: () => void project.reload(), disabled: !fs },
    ...(fs && !fs.writable ? [{ id: 'copy-demo', group: 'File', label: 'Copy demo to a folder…', run: () => void copyDemo() }] : []),
    { id: 'sidebar', group: 'View', label: sidebarHidden ? 'Show the sidebar' : 'Hide the sidebar', keys: SIDEBAR_KEYS, run: toggleSidebar },
    { id: 'shortcuts', group: 'Help', label: 'Keyboard shortcuts', keys: '?', run: () => setHelp(true) },
    ...(fs?.writable && game ? [{ id: 'new-set', group: 'File', label: `New set in ${game.def.name}`, run: () => newSet(selection.game) }] : []),
    ...(workspace?.games.flatMap((g, gi) => g.sets.map((s, si) => ({ id: `set-${gi}-${si}`, group: 'Go to', label: `${g.def.name} / ${s.def.name}`, run: () => setSelection({ game: gi, set: si }) }))) ?? []),
  ];
  useCommands('app', workspace ? globalCommands : []);

  const recents: Recent[] = viaServer ? recentFolders().map((path) => ({ kind: 'path', path })) : last ? [last] : [];

  return (
    <div className={'app' + (sidebarHidden && workspace ? ' no-sidebar' : '')}>
      <header className="toolbar">
        <h1>
          <LogoMark />
          Cardinal
        </h1>
        {fs && workspace && (
          <div className="ws-menu">
            <button className="ws-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} title="Open another folder, back up, reload">
              <span aria-hidden>📁</span> {workspace.name}
              {!fs.writable && <span className="badge">read-only</span>} <span aria-hidden>▾</span>
            </button>
            {menuOpen && (
              <WorkspaceMenu close={() => setMenuOpen(false)}>
                <button role="menuitem" onClick={openFolder} disabled={!canOpen || busy}>
                  Open folder…
                </button>
                {recents
                  .filter((r) => r.kind === 'handle' || r.path !== (fs instanceof ServerFs ? fs.root : ''))
                  .slice(0, 4)
                  .map((r) => (
                    <button role="menuitem" key={r.kind === 'path' ? r.path : 'handle'} onClick={() => reopen(r)} disabled={busy} title={r.kind === 'path' ? r.path : undefined}>
                      Reopen “{recentName(r)}”
                    </button>
                  ))}
                <button role="menuitem" onClick={() => openStore(demoWorkspaceFs())} disabled={busy}>
                  Open the demo
                </button>
                <hr />
                {fs.writable && (
                  <button role="menuitem" onClick={backUp} disabled={busy} title="Copy all game, template and card files into a dated folder in backups/">
                    Back up now
                  </button>
                )}
                <button role="menuitem" onClick={() => project.reload()} disabled={busy} title="Read all files again from disk">
                  Reload from disk
                </button>
              </WorkspaceMenu>
            )}
          </div>
        )}
        {game && (
          <span className="crumbs" aria-label="You are in">
            <span className="slash">/</span>
            <b>{game.def.name}</b>
            {set && tab === 'cards' && (
              <>
                <span className="slash">/</span>
                <span>{set.def.name}</span>
              </>
            )}
          </span>
        )}
        {fs && !fs.writable && (
          <button onClick={copyDemo} disabled={!canOpen || busy} title="Copy the demo into a folder so you can edit it">
            Copy demo to a folder…
          </button>
        )}
        <span className="spacer" />
        {workspace && (
          <button className="command-trigger" onClick={() => setCommandBar(true)} title={keys('Every action in one searchable list (Ctrl+K)')}>
            <span>Search actions…</span>
            <kbd>{keys('Ctrl K')}</kbd>
          </button>
        )}
        <button className="icon-button" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          ?
        </button>
        {fs && workspace && (
          <button className={'save-button' + (project.dirtyCount ? ' primary' : '')} onClick={save} disabled={busy || !project.dirtyCount} title={keys('Save all changes (Ctrl+S)')}>
            {project.dirtyCount ? `Save (${project.dirtyCount})` : '✓ Saved'}
          </button>
        )}
      </header>

      {creatingGame && workspace && (
        <NewGameDialog
          existing={workspace.games.map((g) => g.id)}
          onCancel={() => setCreatingGame(false)}
          onCreate={(name, size) => {
            let id = slug(name);
            while (workspace.games.some((g) => g.id === id)) id += '-2';
            project.addGame(newGame(name, id, joinPath('games', id), size));
            setSelection({ game: workspace.games.length, set: 0 });
            setCreatingGame(false);
            setTab('game');
          }}
        />
      )}
      {picker && (
        <FolderPicker
          title={picker === 'open' ? 'Open a folder' : 'Choose a folder for your copy of the demo'}
          action={picker === 'open' ? 'Open' : 'Copy into'}
          onCancel={() => setPicker(null)}
          onPick={async (dir) => {
            setPicker(null);
            try {
              if (picker === 'open') await openPath(dir);
              else
                await copyDemoInto(
                  new ServerFs(dir),
                  async (name) => new ServerFs((await bridge.mkdir(dir, name)).dir),
                  (store) => openPathMemo((store as ServerFs).root),
                );
            } catch (e) {
              project.setError((e as Error).message);
            }
          }}
        />
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {commandBar && <CommandBar onClose={() => setCommandBar(false)} />}
      {project.recovery && (
        <RecoveryBanner recovery={project.recovery} busy={busy} primary={!project.dirtyCount} onRestore={project.restoreRecovery} onDiscard={project.discardRecovery} />
      )}
      {error && (
        <p className="banner error" role="alert">
          {error}{' '}
          <button onClick={() => project.setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </p>
      )}

      {!workspace ? (
        <Welcome
          canOpen={canOpen}
          busy={busy}
          last={last}
          recents={recents}
          onOpen={openFolder}
          onReopen={reopen}
          onDemo={() => openStore(demoWorkspaceFs())}
        />
      ) : (
        <div className="body">
          <div className="rail">
          <nav className="rail-tabs" role="tablist" aria-label="Modes" aria-orientation="vertical">
            {TABS.map((t, i) => {
              const dirty =
                game && ((t.id === 'cards' && project.isDirty(gameKey(game), 'cards')) || (t.id === 'templates' && project.isDirty(gameKey(game), 'templates')) || (t.id === 'game' && project.isDirty(gameKey(game), 'game')));
              return (
                <button key={t.id} role="tab" aria-selected={t.id === tab} aria-label={t.label} className={'tab' + (t.id === tab ? ' active' : '')} onClick={() => setTab(t.id)} title={keys(`${t.label} (Alt+${i + 1}): ${t.hint}`)}>
                  <RailIcon name={t.id} />
                  <span className="rail-label">{RAIL_LABEL[t.id]}</span>
                  {dirty && <span className="dot" title="Unsaved changes" />}
                </button>
              );
            })}
          </nav>
          <button className="rail-toggle" onClick={toggleSidebar} aria-pressed={!sidebarHidden} aria-label="Games and sets" title={`${sidebarHidden ? 'Show' : 'Hide'} games and sets (${SIDEBAR_KEYS})`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
              <path d="M9 4.5v15" />
              <path d={sidebarHidden ? 'M13 9.5l2.5 2.5-2.5 2.5' : 'M16 9.5L13.5 12l2.5 2.5'} />
            </svg>
            <span className="rail-label">{sidebarHidden ? 'Show sets' : 'Hide sets'}</span>
          </button>
          </div>
          <nav className="sidebar" aria-label="Games and sets" style={{ width: sidebarW }}>
            {workspace.games.length === 0 && <p className="muted">No games found.</p>}
            {workspace.games.map((g, gi) => (
              <div key={gameKey(g)} className={'game' + (gi === selection.game ? ' current' : '')}>
                <div className="game-name">
                  {g.def.name}
                  {project.isDirty(gameKey(g)) && <span className="dot" title="Unsaved changes" />}
                </div>
                <div className="muted small">
                  {g.def.card.widthMm}×{g.def.card.heightMm} mm · {Object.keys(g.templates).length} templates
                </div>
                {g.sets.length === 0 && <div className="muted small">No sets yet</div>}
                {g.sets.map((s, si) => (
                  <button
                    key={s.id}
                    className={'set' + (gi === selection.game && si === selection.set ? ' selected' : '')}
                    aria-current={gi === selection.game && si === selection.set ? 'true' : undefined}
                    onClick={() => setSelection({ game: gi, set: si })}
                  >
                    {s.def.name} <span className="muted">{s.cards.length}</span>
                  </button>
                ))}
                {fs?.writable && (
                  <button className="link small" onClick={() => newSet(gi)}>
                    + New set
                  </button>
                )}
                {fs?.writable && gi === selection.game && <GettingStarted game={g} gameKey={gameKey(g)} onGo={(t) => setTab(t)} />}
              </div>
            ))}
            {fs?.writable && (
              <button
                className="link small"
                disabled={workspace.games.some((g) => g.path === '')}
                title={workspace.games.some((g) => g.path === '') ? 'This folder is a single game. Open the folder above it to keep several games.' : 'Create another game in this workspace'}
                onClick={() => setCreatingGame(true)}
              >
                + New game
              </button>
            )}
            <IssueList issues={workspace.issues} />
          </nav>
          <ResizeHandle panel="left" width={sidebarW} size={SIDEBAR} onWidth={setSidebarW} label="Sidebar width" />
          <div className="main">
            {game && assets ? (
              <>
                <div className="tab-body" hidden={tab !== 'cards'}>
                  {set ? (
                    <CardsView key={`${gameKey(game)}/${set.id}`} game={game} set={set} assets={assets} assetVersion={assetVersion} project={project} active={tab === 'cards'} />
                  ) : (
                    <main className="content empty-state">
                      <p>This game has no sets yet. A set holds a list of cards.</p>
                      <button className="primary" onClick={() => newSet(selection.game)}>
                        + New set
                      </button>
                    </main>
                  )}
                </div>
                {tab === 'stats' && (
                  <div className="tab-body">
                    <Lazy>
                      <StatsView key={gameKey(game)} game={game} onUpdateGame={fs?.writable ? (fn) => project.updateGameDef(gameKey(game), fn) : undefined} />
                    </Lazy>
                  </div>
                )}
                {visited.has('playtest') && fs && (
                  <div className="tab-body" hidden={tab !== 'playtest'}>
                    <Lazy>
                      <PlaytestView key={gameKey(game)} game={game} fs={fs} assets={assets} assetVersion={assetVersion} active={tab === 'playtest'} unsaved={project.isDirty(gameKey(game))} />
                    </Lazy>
                  </div>
                )}
                {visited.has('game') && fs && (
                  <div className="tab-body" hidden={tab !== 'game'}>
                    <Lazy>
                      <GameView key={gameKey(game)} game={game} fs={fs} assets={assets} project={project} onAssetsChanged={() => setAssetVersion((v) => v + 1)} active={tab === 'game'} />
                    </Lazy>
                  </div>
                )}
                {visited.has('export') && fs && (
                  <div className="tab-body" hidden={tab !== 'export'}>
                    <Lazy>
                      <ExportView key={gameKey(game)} game={game} assets={assets} fs={fs} active={tab === 'export'} />
                    </Lazy>
                  </div>
                )}
                {visited.has('templates') && (
                  <div className="tab-body" hidden={tab !== 'templates'}>
                    <Lazy>
                      <TemplatesView key={gameKey(game)} game={game} assets={assets} assetVersion={assetVersion} project={project} active={tab === 'templates'} />
                    </Lazy>
                  </div>
                )}
              </>
            ) : (
              <main className="content">
                <p className="muted">Pick a game on the left.</p>
              </main>
            )}
          </div>
        </div>
      )}
      {workspace && (
        <footer className="status-line" aria-label="Status">
          {game && <span className="slug">{game.def.name}</span>}
          {set && (
            <>
              <span className="slug">{set.def.name}</span>
              <span className="mono">{set.cards.length} cards</span>
            </>
          )}
          <span className={project.dirtyCount ? 'attn' : 'muted'}>{!fs?.writable ? 'Read-only demo' : project.dirtyCount ? `${project.dirtyCount} unsaved file(s)` : 'All saved'}</span>
          <span className="spacer" />
          <span className="muted">
            <kbd>{keys('Ctrl K')}</kbd> actions · <kbd>?</kbd> shortcuts
          </span>
        </footer>
      )}
      <Toasts />
    </div>
  );

  function openPathMemo(dir: string) {
    rememberFolder(dir);
    setLast({ kind: 'path', path: dir });
  }
}

function RecoveryBanner(props: { recovery: Recovery; busy: boolean; primary: boolean; onRestore: () => void; onDiscard: () => void }) {
  const { draft, changed } = props.recovery;
  const n = draft.files.length;
  const when = new Date(draft.savedAt).toLocaleString();
  return (
    <div className="banner recovery" role="status">
      <span>
        Unsaved changes from {when} were recovered: {n === 1 ? '1 file' : `${n} files`} ({draft.files.map((f) => f.path.split('/').pop()).join(', ')}).
        {changed.length > 0 && (
          <b>
            {' '}
            Changed on disk since then: {changed.join(', ')}. Restoring and saving would replace those changes (a backup is made on the first save).
          </b>
        )}
      </span>
      <button className={props.primary ? 'primary' : undefined} onClick={props.onRestore} disabled={props.busy}>
        Restore
      </button>
      <button onClick={props.onDiscard} disabled={props.busy}>
        Discard
      </button>
    </div>
  );
}

function WorkspaceMenu({ close, children }: { close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.parentElement?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [close]);
  return (
    <div className="ws-dropdown" role="menu" ref={ref} onClick={close}>
      {children}
    </div>
  );
}

function Welcome(props: {
  canOpen: boolean;
  busy: boolean;
  last: Recent | null;
  recents: Recent[];
  onOpen: () => void;
  onReopen: (r: Recent) => void;
  onDemo: () => void;
}) {
  const { canOpen, busy, last, recents, onOpen, onReopen, onDemo } = props;
  return (
    <main className="welcome">
      <div className="welcome-card">
        <div className="welcome-brand">
          <LogoMark className="welcome-logo" />
          <div>
            <b>Cardinal</b>
            <span>Card Maker</span>
          </div>
        </div>
        <h2>Design, test and print your own card games</h2>
        <p className="muted">Cardinal works on plain folders on your computer: your cards stay in files you can open in Excel, back up and share.</p>
        {!canOpen && (
          <p className="banner error">
            This page wasn’t opened by the Cardinal program, and this browser can’t open folders by itself. Start Cardinal and use the page it opens, or use Chrome or Edge. You
            can still look at the demo.
          </p>
        )}
        <div className="welcome-actions">
          {last && canOpen && (
            <button className="primary big" onClick={() => onReopen(last)} disabled={busy}>
              Continue with “{recentName(last)}”
            </button>
          )}
          <button className={'big' + (last ? '' : ' primary')} onClick={onOpen} disabled={!canOpen || busy}>
            Open a folder…
          </button>
          <button className="big" onClick={onDemo} disabled={busy}>
            Try the demo
          </button>
        </div>
        {recents.length > 1 && (
          <div className="welcome-recent">
            <h3>Recent folders</h3>
            <ul>
              {recents.slice(1).map((r) => (
                <li key={r.kind === 'path' ? r.path : 'h'}>
                  <button className="link" onClick={() => onReopen(r)} title={r.kind === 'path' ? r.path : undefined}>
                    {recentName(r)}
                  </button>
                  {r.kind === 'path' && <span className="muted small"> {r.path}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <details className="welcome-help">
          <summary>Which folder should I open?</summary>
          <p>
            Open a <b>workspace</b> folder (it contains a <code>games/</code> folder with one folder per game), or a single <b>game</b> folder (it contains{' '}
            <code>game.json</code>). For a fresh start, open an empty folder, then click <b>+ New game</b>. Or open the demo and copy it to a folder to experiment.
          </p>
        </details>
      </div>
    </main>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p className="muted content">Loading…</p>}>{children}</Suspense>;
}
