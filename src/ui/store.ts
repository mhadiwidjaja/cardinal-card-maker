import { useCallback, useEffect, useRef, useState } from 'react';
import { ConflictError, type FileStore } from '../fs/types';
import { backupWorkspace } from '../fs/backup';
import { clearDraft, loadDraft, saveDraft } from '../fs/draftStore';
import { templatePath } from '../model/save';
import type { CardSet, Game, GameDef, TemplateDef, Workspace } from '../model/types';
import { afterSave, dirtyFile, dirtyKey, gameKey, withDirty, type Dirty, type DirtyMap } from './dirty';
import { buildDraft, changedOnDisk, hashText, loadRecording, restoreDraft, type Draft } from './draft';

/**
 * App-wide project state: the open workspace, edits made in the app, and
 * which files need saving. Edits update the in-memory workspace right away
 * (so every view shows them); nothing is written until Save.
 *
 * Unsaved edits are also kept as a recovery draft in the browser (draft.ts),
 * about 2 seconds after the last edit, so a crash or power cut doesn't lose them.
 */

export { gameKey };

const DRAFT_DELAY_MS = 2000;

export interface Recovery {
  draft: Draft;
  changed: string[];
}

const keepsDrafts = (fs: FileStore | null): fs is FileStore => !!fs && fs.writable && fs.key !== '';

export interface Project {
  fs: FileStore | null;
  workspace: Workspace | null;
  busy: boolean;
  error: string | null;
  dirtyCount: number;
  isDirty: (game: string, what?: 'templates' | 'cards' | 'game') => boolean;
  open: (fs: FileStore) => Promise<void>;
  reload: () => Promise<void>;
  setTemplates: (game: string, templates: Record<string, TemplateDef>, changed: string[], deleted?: string[]) => void;
  setSet: (game: string, set: CardSet, what?: 'cards' | 'set') => void;
  addSet: (game: string, set: CardSet) => void;
  setGameDef: (game: string, def: GameDef) => void;
  updateGameDef: (game: string, fn: (def: GameDef) => GameDef) => void;
  addGame: (game: Game) => void;
  save: () => Promise<SaveResult>;
  setError: (e: string | null) => void;
  recovery: Recovery | null;
  restoreRecovery: () => Promise<void>;
  discardRecovery: () => Promise<void>;
}

export interface SaveResult {
  ok: boolean;
  backup?: { folder: string; files: number };
}

export function useProject(): Project {
  const [fs, setFs] = useState<FileStore | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const openSeq = useRef(0);
  const savedSinceOpen = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<DirtyMap>(new Map());
  const wsRef = useRef<Workspace | null>(null);
  wsRef.current = workspace;
  const dirtyRef = useRef<DirtyMap>(dirty);
  dirtyRef.current = dirty;
  // The first save after opening a workspace first copies its files into
  // backups/<date>/, so the state before this session's edits is kept.
  const backupDone = useRef(false);
  const fsRef = useRef<FileStore | null>(fs);
  fsRef.current = fs;
  const bases = useRef(new Map<string, string>());
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  // Draft writes and deletes run one after another, so a late write can't undo a clear.
  const draftQueue = useRef<Promise<void>>(Promise.resolve());
  const queueDraft = useCallback((op: () => Promise<void>) => {
    draftQueue.current = draftQueue.current.then(op, op);
  }, []);

  const markDirty = useCallback((items: Dirty[]) => {
    setDirty((prev) => withDirty(prev, items));
  }, []);

  const updateGame = useCallback((key: string, fn: (g: Game) => Game) => {
    setWorkspace((ws) => (ws ? { ...ws, games: ws.games.map((g) => (gameKey(g) === key ? fn(g) : g)) } : ws));
  }, []);

  const open = useCallback(async (store: FileStore) => {
    setBusy(true);
    setError(null);
    // Opening while there are unsaved edits only happens after the user agreed
    // to throw them away, so their draft goes too.
    const prev = fsRef.current;
    if (keepsDrafts(prev) && dirtyRef.current.size) queueDraft(() => clearDraft(prev.key));
    try {
      const { workspace: ws, bases: b } = await loadRecording(store);
      setWorkspace(ws);
      setFs(store);
      setDirty(new Map());
      setRecovery(null);
      bases.current = b;
      backupDone.current = false;
      const seq = ++openSeq.current;
      savedSinceOpen.current = false;
      setBusy(false);
      // Look for a recovery draft in the background: it must never hold up editing or saving.
      // A late answer is dropped if another folder was opened or a save already cleared it.
      if (keepsDrafts(store)) {
        void (async () => {
          await draftQueue.current;
          const draft = await loadDraft(store.key);
          if (draft && seq === openSeq.current && !savedSinceOpen.current) setRecovery({ draft, changed: changedOnDisk(draft, b) });
        })();
      }
    } catch (e) {
      setError(`Could not open ${store.name}: ${(e as Error).message}`);
      setBusy(false);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!fs) return;
    if (dirty.size && !window.confirm('Reloading throws away unsaved changes. Continue?')) return;
    await open(fs);
  }, [fs, dirty, open]);

  const setTemplates = useCallback(
    (game: string, templates: Record<string, TemplateDef>, changed: string[], deleted: string[] = []) => {
      const g = wsRef.current?.games.find((x) => gameKey(x) === game);
      updateGame(game, (x) => ({ ...x, templates }));
      markDirty([
        ...changed.map((id) => ({ kind: 'template', game, id }) as Dirty),
        ...deleted.map((id) => ({ kind: 'templateDelete', game, id, path: g ? templatePath(g, id) : '' }) as Dirty),
      ]);
      if (deleted.length) {
        setDirty((prev) => {
          const next = new Map(prev);
          for (const id of deleted) next.delete(dirtyKey({ kind: 'template', game, id }));
          return next;
        });
      }
    },
    [updateGame, markDirty],
  );

  const setSet = useCallback(
    (game: string, set: CardSet, what: 'cards' | 'set' = 'cards') => {
      updateGame(game, (g) => ({ ...g, sets: g.sets.map((s) => (s.id === set.id ? set : s)) }));
      markDirty([{ kind: what, game, set: set.id }]);
    },
    [updateGame, markDirty],
  );

  const addSet = useCallback(
    (game: string, set: CardSet) => {
      updateGame(game, (g) => ({ ...g, sets: [...g.sets, set] }));
      markDirty([
        { kind: 'set', game, set: set.id },
        { kind: 'cards', game, set: set.id },
      ]);
    },
    [updateGame, markDirty],
  );

  const setGameDef = useCallback(
    (game: string, def: GameDef) => {
      updateGame(game, (g) => ({ ...g, def }));
      markDirty([{ kind: 'game', game }]);
    },
    [updateGame, markDirty],
  );

  const updateGameDef = useCallback(
    (game: string, fn: (def: GameDef) => GameDef) => {
      updateGame(game, (g) => ({ ...g, def: fn(JSON.parse(JSON.stringify(g.def)) as GameDef) }));
      markDirty([{ kind: 'game', game }]);
    },
    [updateGame, markDirty],
  );

  const addGame = useCallback(
    (game: Game) => {
      setWorkspace((ws) => (ws ? { ...ws, games: [...ws.games, game] } : ws));
      const key = gameKey(game);
      markDirty([
        { kind: 'game', game: key },
        ...Object.keys(game.templates).map((id) => ({ kind: 'template', game: key, id }) as Dirty),
        ...game.sets.flatMap((s) => [{ kind: 'set', game: key, set: s.id } as Dirty, { kind: 'cards', game: key, set: s.id } as Dirty]),
      ]);
    },
    [markDirty],
  );

  const save = useCallback(async (): Promise<SaveResult> => {
    if (!fs || !wsRef.current) return { ok: false };
    if (!fs.writable) {
      setError('This workspace is read-only (the built-in demo). Use “Copy demo to folder…” to get an editable copy.');
      return { ok: false };
    }
    setBusy(true);
    // Automatic backup, once per open. A failed backup never blocks the save.
    let backup: SaveResult['backup'];
    let backupError: string | null = null;
    if (!backupDone.current) {
      backupDone.current = true;
      try {
        const r = await backupWorkspace(fs);
        if (r.files) backup = r;
      } catch (e) {
        backupError = `Your changes were saved, but the automatic backup failed: ${(e as Error).message}`;
      }
    }
    // Write the entries that were marked when Save was clicked. Each file's
    // content comes from the latest workspace at the moment it is written, and
    // afterwards only entries that were not edited again meanwhile are unmarked.
    const toWrite = new Map(dirtyRef.current);
    const written: DirtyMap = new Map();
    const latestGame = (d: Dirty) => wsRef.current?.games.find((g) => gameKey(g) === d.game);
    const noteWritten = (file: { path: string; text: string | null } | null) => {
      if (!file) return;
      if (file.text === null) bases.current.delete(file.path);
      else bases.current.set(file.path, hashText(file.text));
    };
    for (const [key, d] of toWrite) {
      const game = latestGame(d);
      if (!game) continue;
      try {
        noteWritten(await writeOne(fs, game, d));
        written.set(key, d);
      } catch (e) {
        if (e instanceof ConflictError && window.confirm(`${e.path} was changed by another program since it was opened.\n\nOverwrite it with your version? (The old file is kept as ${e.path}.bak)`)) {
          try {
            noteWritten(await writeOne(fs, latestGame(d) ?? game, d, true));
            written.set(key, d);
            continue;
          } catch (e2) {
            setError(`Could not save ${e.path}: ${(e2 as Error).message}`);
          }
        } else if (!(e instanceof ConflictError)) {
          setError(`Could not save: ${(e as Error).message}`);
        }
      }
    }
    const ok = written.size === toWrite.size;
    setDirty((current) => afterSave(current, written));
    setBusy(false);
    if (ok) setError(backupError);
    if (ok) savedSinceOpen.current = true;
    if (ok && keepsDrafts(fs)) queueDraft(() => clearDraft(fs.key));
    return { ok, backup };
  }, [fs, queueDraft]);

  // While a recovered draft waits for Restore or Discard, it is left alone.
  // Hiding the page (another tab, a minimised window) writes the draft at once instead of waiting for the delay.
  useEffect(() => {
    if (!keepsDrafts(fs) || recovery || dirty.size === 0) return;
    const write = () => {
      window.clearTimeout(timer);
      const ws = wsRef.current;
      const draft = ws && buildDraft(fs.key, ws, dirtyRef.current.values(), bases.current);
      if (draft) queueDraft(() => saveDraft(draft));
    };
    const timer = window.setTimeout(write, DRAFT_DELAY_MS);
    const onHide = () => document.visibilityState === 'hidden' && write();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [fs, workspace, dirty, recovery, queueDraft]);

  const restoreRecovery = useCallback(async () => {
    if (!fs || !recovery) return;
    if (dirtyRef.current.size && !window.confirm('Restoring replaces the changes you made since opening this folder. Continue?')) return;
    setBusy(true);
    try {
      const r = await restoreDraft(fs, recovery.draft);
      setWorkspace(r.workspace);
      bases.current = r.bases;
      setDirty(r.dirty);
      setRecovery(null);
    } catch (e) {
      setError(`Could not restore the unsaved changes: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [fs, recovery]);

  const discardRecovery = useCallback(async () => {
    if (!fs || !recovery) return;
    const key = fs.key;
    queueDraft(() => clearDraft(key));
    setRecovery(null);
    await draftQueue.current;
  }, [fs, recovery, queueDraft]);

  useEffect(() => {
    if (dirty.size === 0) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty.size]);

  const isDirty = useCallback(
    (game: string, what?: 'templates' | 'cards' | 'game') => {
      for (const d of dirty.values()) {
        if (d.game !== game) continue;
        if (!what) return true;
        if (what === 'templates' && (d.kind === 'template' || d.kind === 'templateDelete')) return true;
        if (what === 'cards' && (d.kind === 'cards' || d.kind === 'set')) return true;
        if (what === 'game' && d.kind === 'game') return true;
      }
      return false;
    },
    [dirty],
  );

  return {
    fs,
    workspace,
    busy,
    error,
    dirtyCount: dirty.size,
    isDirty,
    open,
    reload,
    setTemplates,
    setSet,
    addSet,
    setGameDef,
    updateGameDef,
    addGame,
    save,
    setError,
    recovery,
    restoreRecovery,
    discardRecovery,
  };
}

async function writeOne(fs: FileStore, game: Game, d: Dirty, force = false): Promise<{ path: string; text: string | null } | null> {
  const file = dirtyFile(game, d);
  if (!file) return null;
  if (file.text === null) {
    if (await fs.exists(file.path)) await fs.remove(file.path);
  } else {
    await fs.writeText(file.path, file.text, { force });
  }
  return file;
}
