import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleBridge, insideRoot, TOKEN_HEADER } from './fileBridge';

const token = 'test-token';
let server: Server;
let base = '';
let root = '';

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'cm-bridge-'));
  writeFileSync(path.join(root, 'game.json'), '{"a":1}');
  server = createServer((req, res) => {
    handleBridge(req, res, { token }).then((ok) => !ok && res.writeHead(404).end());
  });
  await new Promise<void>((r) => server.listen(0, 'localhost', r));
  const addr = server.address();
  base = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}/__card-maker/`;
});
afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

const call = (op: string, params: Record<string, string>, init: RequestInit = {}, tok = token) =>
  fetch(`${base}${op}?${new URLSearchParams(params)}`, { ...init, headers: { [TOKEN_HEADER]: tok } });

describe('file bridge', () => {
  it('refuses requests without the token', async () => {
    expect((await call('places', {}, {}, 'wrong')).status).toBe(403);
  });

  it('keeps paths inside the opened folder', () => {
    expect(() => insideRoot(root, '../secret.txt')).toThrow(/outside/);
    expect(() => insideRoot(root, 'a/../../x')).toThrow(/outside/);
    expect(insideRoot(root, 'games/x.json')).toBe(path.join(root, 'games', 'x.json'));
    expect(() => insideRoot('relative/dir', 'x')).toThrow(/absolute/);
  });

  it('reads, lists and reports missing files', async () => {
    const r = await call('read', { root, path: 'game.json' });
    expect(await r.text()).toBe('{"a":1}');
    expect(Number(r.headers.get('x-mtime'))).toBeGreaterThan(0);
    expect((await call('read', { root, path: 'nope.json' })).status).toBe(404);
    expect(await (await call('list', { root, path: '' })).json()).toEqual([{ name: 'game.json', kind: 'file' }]);
    const ex = await (await call('exists', { root, path: 'game.json' })).json();
    expect(ex.exists).toBe(true);
    expect(ex.mtime).toBe(Number(r.headers.get('x-mtime')));
    expect(await (await call('exists', { root, path: 'nope.json' })).json()).toEqual({ exists: false, mtime: null });
  });

  it('writes with a .bak copy and detects outside changes', async () => {
    const r = await call('read', { root, path: 'game.json' });
    const mtime = r.headers.get('x-mtime')!;
    const w = await call('write', { root, path: 'game.json', expect: mtime }, { method: 'PUT', body: '{"a":2}' });
    expect(w.status).toBe(200);
    expect(readFileSync(path.join(root, 'game.json'), 'utf8')).toBe('{"a":2}');
    expect(readFileSync(path.join(root, 'game.json.bak'), 'utf8')).toBe('{"a":1}');

    const newMtime = String((await w.json()).mtime);
    writeFileSync(path.join(root, 'game.json'), '{"a":3}');
    utimesSync(path.join(root, 'game.json'), new Date(), new Date(Date.now() + 5000));
    const conflict = await call('write', { root, path: 'game.json', expect: newMtime }, { method: 'PUT', body: 'x' });
    expect(conflict.status).toBe(409);
    expect(readFileSync(path.join(root, 'game.json'), 'utf8')).toBe('{"a":3}');
    expect((await call('write', { root, path: 'game.json', expect: newMtime, force: '1' }, { method: 'PUT', body: '{"a":4}' })).status).toBe(200);
  });

  it('creates folders for new files and removes with a backup', async () => {
    await call('write', { root, path: 'sets/core/cards.csv' }, { method: 'PUT', body: 'id\n' });
    expect(readFileSync(path.join(root, 'sets', 'core', 'cards.csv'), 'utf8')).toBe('id\n');
    expect((await call('remove', { root, path: 'sets/core/cards.csv' }, { method: 'POST' })).status).toBe(200);
    expect(existsSync(path.join(root, 'sets', 'core', 'cards.csv'))).toBe(false);
    expect(existsSync(path.join(root, 'sets', 'core', 'cards.csv.bak'))).toBe(true);
  });

  it('browses folders and marks game folders', async () => {
    const b = await (await call('browse', { dir: path.dirname(root) })).json();
    expect(b.folders).toContainEqual({ name: path.basename(root), kind: 'game' });
    const m = await call('mkdir', { dir: root, name: 'new folder' }, { method: 'POST' });
    expect(m.status).toBe(200);
    expect(existsSync(path.join(root, 'new folder'))).toBe(true);
    expect((await call('mkdir', { dir: root, name: '../x' }, { method: 'POST' })).status).toBe(400);
  });
});
