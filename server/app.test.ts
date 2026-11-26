import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { appHandler, sessionWatch, withToken, type Files } from './app.ts';

const files: Files = async (rel) =>
  ({
    'index.html': Buffer.from('<html><head><title>x</title></head><body></body></html>'),
    'assets/app-1234.js': Buffer.from('console.log(1)'),
  })[rel] ?? null;

let server: Server;
let port = 0;

function get(path: string, host = `localhost:${port}`): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  const handler = appHandler(files, 'secret-token');
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('app server', () => {
  it('serves the page with the bridge token, never cached', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.body).toContain('<meta name="card-maker-bridge" content="secret-token">');
    expect(r.headers['cache-control']).toBe('no-cache');
  });

  it('serves built files with long caching and the right type', async () => {
    const r = await get('/assets/app-1234.js');
    expect(r.body).toBe('console.log(1)');
    expect(r.headers['content-type']).toMatch(/^text\/javascript/);
    expect(r.headers['cache-control']).toMatch(/immutable/);
    expect((await get('/missing.js')).status).toBe(404);
  });

  it('answers only requests addressed to localhost', async () => {
    const r = await get('/', `evil.example:${port}`);
    expect(r.status).toBe(403);
    expect(r.body).not.toContain('secret-token');
  });

  it('says hello so a second start finds the running copy', async () => {
    expect(JSON.parse((await get('/__card-maker/hello')).body)).toEqual({ app: 'card-maker' });
  });

  it('puts the token in the head', () => {
    const head = '<head><meta name="card-maker-bridge" content="abc"><meta name="card-maker-session" content="/__card-maker/session"></head>';
    expect(withToken('<head></head>', 'abc')).toBe(head);
    expect(withToken('<head><meta name="card-maker-bridge" content="old"></head>', 'abc')).toBe(head);
  });
});

describe('app windows', () => {
  it('quits only after the last window has been closed for a while', () => {
    vi.useFakeTimers();
    let idle = 0;
    const s = sessionWatch(8000, () => idle++);
    expect(s.seen).toBe(false);
    s.open();
    s.open();
    s.close();
    vi.advanceTimersByTime(10000);
    expect(idle).toBe(0);
    s.close();
    vi.advanceTimersByTime(5000);
    s.open();
    vi.advanceTimersByTime(10000);
    expect(idle).toBe(0);
    s.close();
    vi.advanceTimersByTime(8000);
    expect(idle).toBe(1);
    expect(s.seen).toBe(true);
    vi.useRealTimers();
  });

  it('counts a page that keeps the session connection open', async () => {
    let opened = 0;
    let closed = 0;
    const handler = appHandler(files, 't', { open: () => opened++, close: () => closed++, seen: false });
    const srv = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const p = (srv.address() as AddressInfo).port;
    const req = request({ host: '127.0.0.1', port: p, path: '/__card-maker/session', headers: { host: `localhost:${p}` } });
    const res = await new Promise<IncomingMessage>((r) => req.on('response', r).end());
    expect(res.headers['content-type']).toBe('text/event-stream');
    await new Promise((r) => setTimeout(r, 50));
    expect(opened).toBe(1);
    req.destroy();
    await new Promise((r) => setTimeout(r, 100));
    expect(closed).toBe(1);
    await new Promise<void>((r) => srv.close(() => r()));
  });
});
