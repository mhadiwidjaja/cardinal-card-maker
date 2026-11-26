import { ConflictError, FileNotFoundError, splitPath, type DirEntry, type FileStore, type WriteOptions } from './types';

/**
 * FileStore for browsers without the File System Access API (Firefox, Zen).
 * The local Cardinal server reads and writes the files instead
 * (see server/fileBridge.ts). Same guarantees as BrowserFs: atomic writes,
 * `.bak` copies and conflict detection.
 */

const PREFIX = '/__card-maker/';
const TOKEN_HEADER = 'x-card-maker-token';

/** The token the server put into the page, or null when there is no bridge (e.g. a built copy). */
export function bridgeToken(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLMetaElement>('meta[name="card-maker-bridge"]')?.content || null;
}

export function isBridgeAvailable(): boolean {
  return bridgeToken() !== null;
}

async function call(op: string, params: Record<string, string>, init: RequestInit = {}): Promise<Response> {
  const token = bridgeToken();
  if (!token) throw new Error('This page was not opened by the Cardinal program. Start Cardinal, and use the page it opens.');
  let res: Response;
  try {
    res = await fetch(`${PREFIX}${op}?${new URLSearchParams(params)}`, { ...init, headers: { [TOKEN_HEADER]: token } });
  } catch {
    throw new Error('Lost contact with the Cardinal program. Is its window still open? If not, start Cardinal again.');
  }
  return res;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
  return body;
}

export interface Place {
  name: string;
  path: string;
}
export interface BrowseResult {
  dir: string;
  parent: string | null;
  kind: 'workspace' | 'game' | null;
  folders: { name: string; kind: 'workspace' | 'game' | null }[];
}

export const bridge = {
  places: async () => json<{ places: Place[]; sep: string }>(await call('places', {})),
  browse: async (dir: string) => json<BrowseResult>(await call('browse', { dir })),
  mkdir: async (dir: string, name: string) => json<{ dir: string }>(await call('mkdir', { dir, name }, { method: 'POST' })),
};

export function folderName(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

export class ServerFs implements FileStore {
  readonly writable = true;
  private seen = new Map<string, number>();

  constructor(readonly root: string) {}

  get name(): string {
    return folderName(this.root);
  }

  get key(): string {
    return this.root;
  }

  private p(path: string) {
    return { root: this.root, path: splitPath(path).join('/') };
  }

  async exists(path: string): Promise<boolean> {
    return (await json<{ exists: boolean }>(await call('exists', this.p(path)))).exists;
  }

  async modified(path: string): Promise<number | null> {
    return (await json<{ mtime?: number | null }>(await call('exists', this.p(path)))).mtime ?? null;
  }

  private async read(path: string): Promise<Response> {
    const res = await call('read', this.p(path));
    if (res.status === 404) throw new FileNotFoundError(path);
    if (!res.ok) await json(res);
    return res;
  }

  async readText(path: string): Promise<string> {
    const res = await this.read(path);
    this.seen.set(this.p(path).path, Number(res.headers.get('x-mtime')));
    return res.text();
  }

  async readBlob(path: string): Promise<Blob> {
    return (await this.read(path)).blob();
  }

  async writeText(path: string, text: string, opts: WriteOptions = {}): Promise<void> {
    const key = this.p(path).path;
    const seen = this.seen.get(key);
    const res = await call(
      'write',
      { ...this.p(path), expect: seen === undefined ? '' : String(seen), force: opts.force ? '1' : '' },
      { method: 'PUT', body: text },
    );
    if (res.status === 409) throw new ConflictError(path);
    this.seen.set(key, (await json<{ mtime: number }>(res)).mtime);
  }

  async writeBlob(path: string, data: Blob): Promise<void> {
    await json(await call('write', { ...this.p(path), plain: '1' }, { method: 'PUT', body: data }));
  }

  async remove(path: string): Promise<void> {
    const res = await call('remove', this.p(path), { method: 'POST' });
    if (res.status === 404) throw new FileNotFoundError(path);
    await json(res);
    this.seen.delete(this.p(path).path);
  }

  async list(path: string): Promise<DirEntry[]> {
    const res = await call('list', this.p(path));
    if (res.status === 404) throw new FileNotFoundError(path);
    return json<DirEntry[]>(res);
  }
}

const LAST_KEY = 'card-maker:lastFolderPath';
const RECENT_KEY = 'card-maker:recentFolders';

export function lastFolderPath(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function recentFolders(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberFolder(dir: string) {
  try {
    localStorage.setItem(LAST_KEY, dir);
    localStorage.setItem(RECENT_KEY, JSON.stringify([dir, ...recentFolders().filter((d) => d !== dir)].slice(0, 6)));
  } catch {
  }
}
