import { promises as fsp } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import * as sea from 'node:sea';
import { BRIDGE_PREFIX, handleBridge, insideRoot } from './fileBridge.ts';

/**
 * Serves the built page and the file bridge for the downloadable app
 * (started by main.ts). Inside the single-file program (Node's "single
 * executable application") the page comes from embedded assets; run with
 * Node it reads a `dist` folder instead.
 */

export const APP_NAME = 'Cardinal';
/** Fixed, because the browser keeps recent folders and recovery drafts per address. */
export const DEFAULT_PORT = 4673;
export const HELLO = `${BRIDGE_PREFIX}hello`;
/** Each open window keeps a connection here, so the app knows when its last window has closed. */
export const SESSION = `${BRIDGE_PREFIX}session`;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

export type Files = (rel: string) => Promise<Buffer | null>;

export function embedded(): Files | null {
  if (!sea.isSea()) return null;
  const known = new Set(sea.getAssetKeys());
  return async (rel) => (known.has(rel) ? Buffer.from(sea.getAsset(rel)) : null);
}

export function onDisk(root: string): Files {
  return async (rel) => {
    try {
      return await fsp.readFile(insideRoot(root, rel));
    } catch {
      return null;
    }
  };
}

export function withToken(html: string, token: string): string {
  return html
    .replace(/<meta name="card-maker-(bridge|session)"[^>]*>/g, '')
    .replace('</head>', `<meta name="card-maker-bridge" content="${token}"><meta name="card-maker-session" content="${SESSION}"></head>`);
}

export interface Sessions {
  open(): void;
  close(): void;
  /** True once any window has connected. */
  readonly seen: boolean;
}

/** Counts open windows and calls `onIdle` when none has been open for `idleMs` (a reload reconnects well within that). */
export function sessionWatch(idleMs: number, onIdle: () => void): Sessions {
  let open = 0;
  let seen = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    open() {
      open++;
      seen = true;
      clearTimeout(timer);
    },
    close() {
      open = Math.max(0, open - 1);
      if (open === 0) timer = setTimeout(onIdle, idleMs);
    },
    get seen() {
      return seen;
    },
  };
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

export function appHandler(files: Files, token: string, sessions?: Sessions) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    // Another site that points its own name at 127.0.0.1 must not get the page, which holds the token.
    if (!LOCAL.has((req.headers.host ?? '').replace(/:\d+$/, ''))) {
      res.writeHead(403).end('Only available on localhost');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === HELLO) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ app: 'card-maker' }));
      return;
    }
    if (url.pathname === SESSION) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(': open\n\n');
      // A comment now and then keeps the connection from being dropped as idle.
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      sessions?.open();
      req.on('close', () => {
        clearInterval(ping);
        sessions?.close();
      });
      return;
    }
    if (await handleBridge(req, res, { token })) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const body = await files(rel);
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(rel).toLowerCase();
    const page = rel === 'index.html';
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      // File names under assets/ change with their content, so they can be kept.
      'cache-control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : page ? withToken(body.toString('utf8'), token) : body);
  };
}
