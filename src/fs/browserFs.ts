import { ConflictError, FileNotFoundError, splitPath, type DirEntry, type FileStore, type WriteOptions } from './types';

// The File System Access API's picker and permission calls are Chromium-only
// and not yet in TypeScript's DOM types.
type PermissionMode = 'read' | 'readwrite';
interface PermissionHandle {
  queryPermission(opts: { mode: PermissionMode }): Promise<PermissionState>;
  requestPermission(opts: { mode: PermissionMode }): Promise<PermissionState>;
}
declare global {
  interface Window {
    showDirectoryPicker?(opts?: { id?: string; mode?: PermissionMode }): Promise<FileSystemDirectoryHandle>;
  }
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) throw new Error('This browser cannot open folders. Use Chrome or Edge.');
  try {
    return await window.showDirectoryPicker({ id: 'card-maker-workspace', mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/**
 * Makes sure we may read and write the folder. Must be called from a click
 * handler when it may need to show the browser's permission prompt.
 */
export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as unknown as PermissionHandle;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

function isMissing(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError'));
}

export class BrowserFs implements FileStore {
  readonly writable = true;
  private seen = new Map<string, number>();

  /**
   * @param key identifies the folder for the recovery draft. The browser does
   * not tell us a folder's full path, so the default is its name.
   */
  constructor(
    private readonly root: FileSystemDirectoryHandle,
    readonly key = `browser:${root.name}`,
  ) {}

  get name(): string {
    return this.root.name;
  }

  /**
   * Asks for the entry by name (first as a file, then as a folder) instead of
   * listing the whole parent folder. On Windows the lookup ignores case, like
   * the server route does.
   */
  async exists(path: string): Promise<boolean> {
    const parts = splitPath(path);
    if (parts.length === 0) return true;
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.dir(parts.slice(0, -1));
    } catch (e) {
      if (e instanceof FileNotFoundError) return false;
      throw e;
    }
    const last = parts[parts.length - 1]!;
    for (const get of [() => dir.getFileHandle(last), () => dir.getDirectoryHandle(last)]) {
      try {
        await get();
        return true;
      } catch (e) {
        if (!isMissing(e)) throw e;
      }
    }
    return false;
  }

  async modified(path: string): Promise<number | null> {
    try {
      return (await this.file(path)).lastModified;
    } catch (e) {
      if (e instanceof FileNotFoundError || isMissing(e)) return null;
      throw e;
    }
  }

  async readText(path: string): Promise<string> {
    const file = await this.file(path);
    this.seen.set(splitPath(path).join('/'), file.lastModified);
    return file.text();
  }

  async readBlob(path: string): Promise<Blob> {
    return this.file(path);
  }

  async writeText(path: string, text: string, opts: WriteOptions = {}): Promise<void> {
    const parts = splitPath(path);
    const key = parts.join('/');
    const dir = await this.dir(parts.slice(0, -1), true);
    const name = parts[parts.length - 1]!;

    try {
      const old = await (await dir.getFileHandle(name)).getFile();
      const seen = this.seen.get(key);
      if (!opts.force && seen !== undefined && old.lastModified !== seen) throw new ConflictError(path);
      const bak = await (await dir.getFileHandle(name + '.bak', { create: true })).createWritable();
      await bak.write(old);
      await bak.close();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }

    // createWritable writes to a temporary swap file; close() replaces the
    // real file in one step, so a crash mid-write cannot corrupt it.
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    this.seen.set(key, (await handle.getFile()).lastModified);
  }

  async writeBlob(path: string, data: Blob): Promise<void> {
    const parts = splitPath(path);
    const dir = await this.dir(parts.slice(0, -1), true);
    const writable = await (await dir.getFileHandle(parts[parts.length - 1]!, { create: true })).createWritable();
    await writable.write(data);
    await writable.close();
  }

  async remove(path: string): Promise<void> {
    const parts = splitPath(path);
    const dir = await this.dir(parts.slice(0, -1));
    const name = parts[parts.length - 1]!;
    const old = await this.file(path);
    const bak = await (await dir.getFileHandle(name + '.bak', { create: true })).createWritable();
    await bak.write(old);
    await bak.close();
    await dir.removeEntry(name);
    this.seen.delete(parts.join('/'));
  }

  async list(path: string): Promise<DirEntry[]> {
    const dir = await this.dir(splitPath(path));
    const entries: DirEntry[] = [];
    for await (const handle of dir.values()) entries.push({ name: handle.name, kind: handle.kind });
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async dir(parts: string[], create = false): Promise<FileSystemDirectoryHandle> {
    let dir = this.root;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) {
          throw new FileNotFoundError(parts.join('/'));
        }
        throw e;
      }
    }
    return dir;
  }

  private async file(path: string): Promise<File> {
    const parts = splitPath(path);
    const dir = await this.dir(parts.slice(0, -1));
    try {
      return await (await dir.getFileHandle(parts[parts.length - 1]!)).getFile();
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) {
        throw new FileNotFoundError(path);
      }
      throw e;
    }
  }
}
