import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import * as sea from 'node:sea';
import { APP_NAME, appHandler, DEFAULT_PORT, embedded, HELLO, onDisk, sessionWatch, type Sessions } from './app.ts';
import { dataDir, openAppWindow, openBrowser, showMessage } from './launch.ts';

/**
 * Starts the downloadable app:
 *   <program> [--app | --browser] [--port=<n>] [--no-open] [--dist=<folder>]
 * `--app` (the "Cardinal" download) opens its own window and quits when the last one closes.
 * `--browser` (the "Cardinal Browser" download, and `npm run app`) opens a browser tab and runs
 * until its console window is closed. The downloads carry their mode in the asset `launch.json`.
 */

/** A closed window gets this long to come back (a reload) before the app quits. */
const IDLE_MS = 8000;
/** If no app window has connected by then, the default browser is tried; then the app gives up. */
const FIRST_WINDOW_MS = 25000;
const GIVE_UP_MS = 120000;

type Mode = 'app' | 'browser';

function builtInMode(): Mode {
  try {
    if (sea.isSea()) return (JSON.parse(sea.getAsset('launch.json', 'utf8')) as { mode?: Mode }).mode === 'app' ? 'app' : 'browser';
  } catch {}
  return 'browser';
}

// The app window build has no console, so everything said is also kept in a log next to its browser profile.
const logFile = path.join(dataDir(), 'cardinal.log');
function log(text: string) {
  console.log(text);
  try {
    appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`);
  } catch {}
}

async function runningAt(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://localhost:${port}${HELLO}`, { signal: AbortSignal.timeout(800) });
    return r.ok && ((await r.json()) as { app?: string }).app === 'card-maker';
  } catch {
    return false;
  }
}

function listen(handler: ReturnType<typeof appHandler>, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handler(req, res).catch((e: Error) => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(e.message);
      });
    });
    server.once('error', reject);
    server.listen(port, 'localhost', () => resolve(port));
  });
}

function show(mode: Mode, url: string) {
  if (mode === 'app' && openAppWindow(url)) return log(`Opened ${url} in its own window`);
  if (mode === 'app') log('No Edge or Chrome found for an app window; opening the default browser');
  openBrowser(url);
}

async function main() {
  const args = process.argv.slice(2);
  const mode: Mode = args.includes('--browser') ? 'browser' : args.includes('--app') ? 'app' : builtInMode();
  const open = !args.includes('--no-open');
  const portArg = args.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.slice(7)) : DEFAULT_PORT;
  const distArg = args.find((a) => a.startsWith('--dist='));
  const files = embedded() ?? onDisk(path.resolve(distArg ? distArg.slice(7) : path.join(process.cwd(), 'dist')));
  if (await runningAt(port)) {
    log(`${APP_NAME} is already running at http://localhost:${port}; opening another window.`);
    if (open) show(mode, `http://localhost:${port}/`);
    return;
  }
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(logFile, '');
  } catch {}
  if (!(await files('index.html'))) {
    showMessage('The app files are missing. Run "npm run build" first, or pass --dist=<folder>.');
    process.exit(1);
  }

  let sessions: Sessions | undefined;
  if (mode === 'app') {
    sessions = sessionWatch(IDLE_MS, () => {
      log('The last window was closed; stopping.');
      process.exit(0);
    });
  }
  const handler = appHandler(files, randomBytes(24).toString('hex'), sessions);
  let used = 0;
  for (let p = port; p < port + 10 && !used; p++) {
    try {
      used = await listen(handler, p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    }
  }
  if (!used) {
    showMessage(`${APP_NAME} could not start: ports ${port} to ${port + 9} are all in use. Close the program using them, or start with --port=<number>.`);
    process.exit(1);
  }
  const url = `http://localhost:${used}/`;
  if (mode === 'browser') {
    console.log(`\n  ${APP_NAME} is running at ${url}\n`);
    if (used !== port) console.log(`  (Port ${port} was busy. Recent folders are remembered per address, so they may be missing this time.)\n`);
    console.log('  Keep this window open while you work. Close it, or press Ctrl+C, to stop.\n');
  } else log(`Running at ${url}`);
  if (!open) return;
  show(mode, url);
  if (sessions) {
    const s = sessions;
    setTimeout(() => {
      if (s.seen) return;
      log('No window connected; trying the default browser.');
      openBrowser(url);
      setTimeout(() => {
        if (s.seen) return;
        showMessage(`${APP_NAME} could not open a window. Open ${url} in your browser, or use the Cardinal Browser download.`);
        setTimeout(() => process.exit(1), 15000);
      }, GIVE_UP_MS - FIRST_WINDOW_MS);
    }, FIRST_WINDOW_MS);
  }
}

main().catch((e: Error) => {
  log(e.stack ?? e.message);
  showMessage(`${APP_NAME} stopped because of an error: ${e.message}`);
  setTimeout(() => process.exit(1), 15000);
});
