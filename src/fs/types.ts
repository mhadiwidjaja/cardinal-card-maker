/**
 * A minimal file-system interface. The app only talks to files through this,
 * so the same loading code works on a real folder (browserFs) and in tests
 * or the built-in demo (memoryFs).
 *
 * Paths are always relative to the workspace root and use forward slashes,
 * e.g. "games/demo-game/game.json". No leading slash.
 */
export interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
}

export interface FileStore {
  readonly name: string;
  /**
   * Identifies the workspace between sessions, for the crash-recovery draft
   * (e.g. the folder's full path). '' means "never keep a draft" (the demo, tests).
   */
  readonly key: string;
  readonly writable: boolean;
  exists(path: string): Promise<boolean>;
  modified(path: string): Promise<number | null>;
  readText(path: string): Promise<string>;
  readBlob(path: string): Promise<Blob>;
  /**
   * Writes atomically and keeps the previous version as `<path>.bak`.
   * Throws ConflictError if the file changed on disk since this app last read
   * or wrote it, unless `force` is set.
   */
  writeText(path: string, text: string, opts?: WriteOptions): Promise<void>;
  /** Writes binary data (exports). No backup, no conflict check. */
  writeBlob(path: string, data: Blob): Promise<void>;
  /** Deletes a file, keeping its content as `<path>.bak`. */
  remove(path: string): Promise<void>;
  list(path: string): Promise<DirEntry[]>;
}

export interface WriteOptions {
  force?: boolean;
}

export class ConflictError extends Error {
  constructor(public readonly path: string) {
    super(`${path} was changed by another program since it was opened`);
    this.name = 'ConflictError';
  }
}

export class FileNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`File not found: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

export function splitPath(path: string): string[] {
  return path.split('/').filter((p) => p !== '' && p !== '.');
}

export function joinPath(...parts: string[]): string {
  return splitPath(parts.join('/')).join('/');
}
