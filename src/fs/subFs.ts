import { joinPath, type DirEntry, type FileStore } from './types';

export class SubFs implements FileStore {
  readonly key = '';
  readonly writable = false;

  constructor(
    private readonly base: FileStore,
    private readonly prefix: string,
  ) {}

  get name(): string {
    return this.prefix.split('/').pop() ?? this.prefix;
  }

  private p(path: string): string {
    return joinPath(this.prefix, path);
  }

  exists(path: string): Promise<boolean> {
    return this.base.exists(this.p(path));
  }
  modified(path: string): Promise<number | null> {
    return this.base.modified(this.p(path));
  }
  readText(path: string): Promise<string> {
    return this.base.readText(this.p(path));
  }
  readBlob(path: string): Promise<Blob> {
    return this.base.readBlob(this.p(path));
  }
  list(path: string): Promise<DirEntry[]> {
    return this.base.list(this.p(path));
  }
  async writeText(): Promise<void> {
    throw new Error('A snapshot is read-only');
  }
  async writeBlob(): Promise<void> {
    throw new Error('A snapshot is read-only');
  }
  async remove(): Promise<void> {
    throw new Error('A snapshot is read-only');
  }
}
