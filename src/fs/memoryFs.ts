import { ConflictError, FileNotFoundError, splitPath, type DirEntry, type FileStore, type WriteOptions } from './types';

export class MemoryFs implements FileStore {
  readonly key = '';
  private files = new Map<string, string | Blob>();

  constructor(
    readonly name: string,
    initial: Record<string, string | Blob> = {},
    readonly writable = true,
  ) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(splitPath(path).join('/'), content);
    }
  }

  async exists(path: string): Promise<boolean> {
    const p = splitPath(path).join('/');
    if (this.files.has(p)) return true;
    const prefix = p === '' ? '' : p + '/';
    for (const key of this.files.keys()) if (key.startsWith(prefix)) return true;
    return false;
  }

  /** A change counter per file stands in for a modification time. */
  async modified(path: string): Promise<number | null> {
    const p = splitPath(path).join('/');
    return this.files.has(p) ? (this.versions.get(p) ?? 0) : null;
  }
  private versions = new Map<string, number>();
  private bump(p: string) {
    this.versions.set(p, (this.versions.get(p) ?? 0) + 1);
  }

  async readText(path: string): Promise<string> {
    this.changedExternally.delete(splitPath(path).join('/'));
    const content = this.get(path);
    return typeof content === 'string' ? content : content.text();
  }

  async readBlob(path: string): Promise<Blob> {
    const content = this.get(path);
    return typeof content === 'string' ? new Blob([content]) : content;
  }

  async writeText(path: string, text: string, opts: WriteOptions = {}): Promise<void> {
    if (!this.writable) throw new Error(`${this.name} is read-only`);
    const p = splitPath(path).join('/');
    if (this.changedExternally.has(p) && !opts.force) throw new ConflictError(path);
    this.changedExternally.delete(p);
    const old = this.files.get(p);
    if (old !== undefined) this.files.set(p + '.bak', old);
    this.files.set(p, text);
    this.bump(p);
  }

  async writeBlob(path: string, data: Blob): Promise<void> {
    if (!this.writable) throw new Error(`${this.name} is read-only`);
    this.files.set(splitPath(path).join('/'), data);
    this.bump(splitPath(path).join('/'));
  }

  async remove(path: string): Promise<void> {
    if (!this.writable) throw new Error(`${this.name} is read-only`);
    const p = splitPath(path).join('/');
    const old = this.files.get(p);
    if (old === undefined) throw new FileNotFoundError(path);
    this.files.set(p + '.bak', old);
    this.files.delete(p);
  }

  externalWrite(path: string, text: string | Blob) {
    this.files.set(splitPath(path).join('/'), text);
    this.bump(splitPath(path).join('/'));
    this.changedExternally.add(splitPath(path).join('/'));
  }
  private changedExternally = new Set<string>();

  async list(path: string): Promise<DirEntry[]> {
    const parts = splitPath(path);
    const prefix = parts.length ? parts.join('/') + '/' : '';
    const entries = new Map<string, DirEntry>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length).split('/');
      const name = rest[0]!;
      entries.set(name, { name, kind: rest.length > 1 ? 'directory' : 'file' });
    }
    if (parts.length && entries.size === 0) throw new FileNotFoundError(path);
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private get(path: string): string | Blob {
    const content = this.files.get(splitPath(path).join('/'));
    if (content === undefined) throw new FileNotFoundError(path);
    return content;
  }
}
