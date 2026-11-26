import { FileNotFoundError, splitPath, type DirEntry, type FileStore, type WriteOptions } from '../fs/types';
import { loadWorkspace } from '../model/load';
import type { Workspace } from '../model/types';
import { dirtyFile, dirtyKey, gameKey, type Dirty, type DirtyMap } from './dirty';

/**
 * Crash recovery. While there are unsaved edits, the app keeps a "draft" in
 * the browser's storage (see fs/draftStore.ts): the text each changed file
 * would get on Save. It never touches the real files. After a crash or power
 * cut the draft can be restored: the workspace is loaded as if the drafted
 * files had been saved, and those files are marked unsaved, so the normal
 * Save writes them.
 *
 * Everything here is plain logic, tested with MemoryFs (draft.test.ts).
 */

export interface DraftFile {
  path: string;
  text: string | null;
  /** Hash of the file's text on disk when the edits started; null if it did not exist. */
  base: string | null;
}

export interface Draft {
  formatVersion: 1;
  key: string;
  savedAt: number;
  dirty: Dirty[];
  files: DraftFile[];
}

export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length}:${h.toString(16)}`;
}

export function buildDraft(key: string, ws: Workspace, dirty: Iterable<Dirty>, bases: Map<string, string>, now = Date.now()): Draft | null {
  const entries: Dirty[] = [];
  const files: DraftFile[] = [];
  for (const d of dirty) {
    const game = ws.games.find((g) => gameKey(g) === d.game);
    const file = game && dirtyFile(game, d);
    if (!file) continue;
    entries.push(d);
    files.push({ ...file, base: bases.get(file.path) ?? null });
  }
  return entries.length ? { formatVersion: 1, key, savedAt: now, dirty: entries, files } : null;
}

export function changedOnDisk(draft: Draft, bases: Map<string, string>): string[] {
  return draft.files.filter((f) => (bases.get(f.path) ?? null) !== f.base).map((f) => f.path);
}

export async function loadRecording(fs: FileStore): Promise<{ workspace: Workspace; bases: Map<string, string> }> {
  const recorder = new ReadRecorder(fs);
  return { workspace: await loadWorkspace(recorder), bases: recorder.bases };
}

export async function restoreDraft(fs: FileStore, draft: Draft): Promise<{ workspace: Workspace; bases: Map<string, string>; dirty: DirtyMap }> {
  const recorder = new ReadRecorder(fs);
  const workspace = await loadWorkspace(new DraftOverlay(recorder, draft));
  const dirty: DirtyMap = new Map(draft.dirty.map((d) => [dirtyKey(d), { ...d }]));
  return { workspace, bases: recorder.bases, dirty };
}

export class ReadRecorder implements FileStore {
  readonly bases = new Map<string, string>();
  constructor(private readonly inner: FileStore) {}
  get name() {
    return this.inner.name;
  }
  get key() {
    return this.inner.key;
  }
  get writable() {
    return this.inner.writable;
  }
  exists(path: string) {
    return this.inner.exists(path);
  }
  modified(path: string) {
    return this.inner.modified(path);
  }
  async readText(path: string) {
    const text = await this.inner.readText(path);
    this.bases.set(splitPath(path).join('/'), hashText(text));
    return text;
  }
  readBlob(path: string) {
    return this.inner.readBlob(path);
  }
  writeText(path: string, text: string, opts?: WriteOptions) {
    return this.inner.writeText(path, text, opts);
  }
  writeBlob(path: string, data: Blob) {
    return this.inner.writeBlob(path, data);
  }
  remove(path: string) {
    return this.inner.remove(path);
  }
  list(path: string) {
    return this.inner.list(path);
  }
}

export class DraftOverlay implements FileStore {
  readonly writable = false;
  private files = new Map<string, string | null>();

  constructor(
    private readonly inner: FileStore,
    draft: Draft,
  ) {
    for (const f of draft.files) this.files.set(splitPath(f.path).join('/'), f.text);
  }

  get name() {
    return this.inner.name;
  }
  get key() {
    return this.inner.key;
  }

  async exists(path: string): Promise<boolean> {
    const p = splitPath(path).join('/');
    if (this.files.has(p)) return this.files.get(p) !== null;
    if (this.childrenOf(p).size) return true;
    return this.inner.exists(path);
  }

  async modified(path: string): Promise<number | null> {
    const p = splitPath(path).join('/');
    if (this.files.has(p)) return this.files.get(p) === null ? null : 0;
    return this.inner.modified(path);
  }

  async readText(path: string): Promise<string> {
    const p = splitPath(path).join('/');
    if (!this.files.has(p)) return this.inner.readText(path);
    // Still read the real file, so the store knows its current version and
    // its conflict check keeps working when the restored edits are saved.
    await this.inner.readText(path).catch((e: unknown) => {
      if (!(e instanceof FileNotFoundError)) throw e;
    });
    const text = this.files.get(p);
    if (text == null) throw new FileNotFoundError(path);
    return text;
  }

  async readBlob(path: string): Promise<Blob> {
    const p = splitPath(path).join('/');
    return this.files.has(p) ? new Blob([await this.readText(path)]) : this.inner.readBlob(path);
  }

  async list(path: string): Promise<DirEntry[]> {
    const p = splitPath(path).join('/');
    const extra = this.childrenOf(p);
    let entries: DirEntry[] = [];
    try {
      entries = await this.inner.list(path);
    } catch (e) {
      if (!(e instanceof FileNotFoundError) || extra.size === 0) throw e;
    }
    const byName = new Map(entries.map((e) => [e.name, e]));
    for (const [name, kind] of extra) byName.set(name, { name, kind });
    for (const [file, text] of this.files) {
      if (text === null && parentOf(file) === p) byName.delete(file.slice(p ? p.length + 1 : 0));
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async writeText(): Promise<void> {
    throw new Error('The recovery view is read-only');
  }
  async writeBlob(): Promise<void> {
    throw new Error('The recovery view is read-only');
  }
  async remove(): Promise<void> {
    throw new Error('The recovery view is read-only');
  }

  private childrenOf(dir: string): Map<string, DirEntry['kind']> {
    const out = new Map<string, DirEntry['kind']>();
    const prefix = dir ? dir + '/' : '';
    for (const [file, text] of this.files) {
      if (text === null || !file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length).split('/');
      out.set(rest[0]!, rest.length > 1 ? 'directory' : 'file');
    }
    return out;
  }
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}
