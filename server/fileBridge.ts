import { randomBytes } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * File bridge: lets browsers without the File System Access API (Firefox,
 * Zen, Safari) open real folders. The local server (the dev server, or the
 * downloadable app in main.ts) reads and writes the files on the page's behalf.
 *
 * Safety:
 *  - Only answers requests to localhost carrying a secret token that is put
 *    into the app page when it is served. Other websites can't read the page,
 *    so they can't learn the token. (A custom header also forces the browser
 *    to ask permission for cross-site requests, which we never grant.)
 *  - Every file path is resolved inside the opened folder; `..` can't escape.
 *  - Writes are atomic (temp file + rename) and keep `<file>.bak`, exactly
 *    like the Chrome/Edge code path.
 */

export const BRIDGE_PREFIX = '/__card-maker/';
export const TOKEN_HEADER = 'x-card-maker-token';

export interface BridgeOptions {
  token: string;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
};

export function insideRoot(root: string, rel: string): string {
  if (!path.isAbsolute(root)) throw new HttpError(400, 'Folder path must be absolute');
  const base = path.resolve(root);
  const full = path.resolve(base, rel.replace(/^[/\\]+/, ''));
  const r = path.relative(base, full);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new HttpError(403, `Path is outside the opened folder: ${rel}`);
  return full;
}

async function folderKind(dir: string): Promise<'workspace' | 'game' | null> {
  if (existsSync(path.join(dir, 'game.json'))) return 'game';
  if (existsSync(path.join(dir, 'games'))) return 'workspace';
  return null;
}

function places(): { name: string; path: string }[] {
  const home = homedir();
  const list = [{ name: 'Home', path: home }];
  for (const name of ['Documents', 'Desktop', 'Downloads', 'OneDrive']) {
    const p = path.join(home, name);
    if (existsSync(p)) list.push({ name, path: p });
  }
  if (process.platform === 'darwin') {
    const icloud = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
    if (existsSync(icloud)) list.push({ name: 'iCloud Drive', path: icloud });
    // External drives and USB sticks are mounted here on a Mac.
    if (existsSync('/Volumes')) list.push({ name: 'Drives', path: '/Volumes' });
  }
  if (process.platform === 'win32') {
    for (let c = 65; c <= 90; c++) {
      const drive = `${String.fromCharCode(c)}:\\`;
      if (existsSync(drive)) list.push({ name: `Drive ${String.fromCharCode(c)}:`, path: drive });
    }
  } else {
    list.push({ name: 'Computer', path: '/' });
  }
  return list;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function statOrNull(p: string) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

async function atomicWrite(file: string, data: Buffer) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, data);
  try {
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e;
  }
}

type Json = Record<string, unknown> | unknown[];

export async function handleBridge(req: IncomingMessage, res: ServerResponse, opts: BridgeOptions): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(BRIDGE_PREFIX)) return false;
  const op = url.pathname.slice(BRIDGE_PREFIX.length);
  const q = (k: string) => url.searchParams.get(k) ?? '';

  const send = (status: number, body: Json | Buffer, headers: Record<string, string> = {}) => {
    const isBuf = Buffer.isBuffer(body);
    res.writeHead(status, { 'content-type': isBuf ? 'application/octet-stream' : 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(isBuf ? body : JSON.stringify(body));
  };

  try {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new HttpError(403, 'Only available on localhost');
    if (req.headers[TOKEN_HEADER] !== opts.token) throw new HttpError(403, 'Missing or wrong token');

    switch (op) {
      case 'places':
        return send(200, { places: places(), sep: path.sep }), true;

      case 'browse': {
        const dir = path.resolve(q('dir') || homedir());
        const st = await statOrNull(dir);
        if (!st?.isDirectory()) throw new HttpError(404, `Folder not found: ${dir}`);
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        const folders = [];
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('$') || e.name === 'node_modules') continue;
          folders.push({ name: e.name, kind: await folderKind(path.join(dir, e.name)).catch(() => null) });
        }
        folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
        const parent = path.dirname(dir);
        return send(200, { dir, parent: parent === dir ? null : parent, kind: await folderKind(dir), folders }), true;
      }

      case 'mkdir': {
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
        const name = q('name').trim();
        if (!name || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') throw new HttpError(400, `Not a valid folder name: ${name}`);
        const full = insideRoot(q('dir'), name);
        await fsp.mkdir(full, { recursive: true });
        return send(200, { dir: full }), true;
      }
    }

    const root = q('root');
    const rootStat = await statOrNull(path.isAbsolute(root) ? root : '');
    if (!rootStat?.isDirectory()) throw new HttpError(404, `Folder not found: ${root}`);
    const file = insideRoot(root, q('path'));

    switch (op) {
      case 'exists': {
        // mtime (files only) lets the app notice images changed in other programs.
        const st = await statOrNull(file);
        return send(200, { exists: st !== null, mtime: st?.isFile() ? st.mtimeMs : null }), true;
      }

      case 'list': {
        const st = await statOrNull(file);
        if (!st?.isDirectory()) throw new HttpError(404, `Folder not found: ${q('path')}`);
        const entries = (await fsp.readdir(file, { withFileTypes: true }))
          .filter((e) => e.isDirectory() || e.isFile())
          .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return send(200, entries), true;
      }

      case 'read': {
        const st = await statOrNull(file);
        if (!st?.isFile()) throw new HttpError(404, `File not found: ${q('path')}`);
        const data = await fsp.readFile(file);
        return (
          send(200, data, {
            'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
            'x-mtime': String(st.mtimeMs),
          }),
          true
        );
      }

      case 'write': {
        if (req.method !== 'PUT') throw new HttpError(405, 'Use PUT');
        const data = await readBody(req);
        const plain = q('plain') === '1';
        const old = await statOrNull(file);
        if (old && !plain) {
          const expect = q('expect');
          if (q('force') !== '1' && expect !== '' && Number(expect) !== old.mtimeMs) {
            return send(409, { error: 'conflict', mtime: old.mtimeMs }), true;
          }
          await fsp.copyFile(file, `${file}.bak`);
        }
        await atomicWrite(file, data);
        return send(200, { mtime: (await fsp.stat(file)).mtimeMs }), true;
      }

      case 'remove': {
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
        const st = await statOrNull(file);
        if (!st?.isFile()) throw new HttpError(404, `File not found: ${q('path')}`);
        await fsp.copyFile(file, `${file}.bak`);
        await fsp.rm(file);
        return send(200, { ok: true }), true;
      }

      default:
        throw new HttpError(404, `Unknown operation: ${op}`);
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    send(status, { error: (e as Error).message });
    return true;
  }
}

export function fileBridge(): Plugin {
  const opts: BridgeOptions = { token: randomBytes(24).toString('hex') };
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    handleBridge(req, res, opts).then((handled) => !handled && next(), next);
  };
  return {
    name: 'card-maker-file-bridge',
    apply: 'serve',
    // Dev server only: a built page gets its token from the app server (app.ts)
    // when served, because a token baked in at build time would be known to everyone.
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'card-maker-bridge', content: opts.token }, injectTo: 'head' }];
    },
  };
}
