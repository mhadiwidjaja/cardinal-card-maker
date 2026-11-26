// Starts each program that `npm run package` built (listed in build/programs.json) and checks
// that it serves the app with a bridge token, then stops it. Used by the release workflow on each system.
// The first start of a freshly built program can be slow (macOS scans new programs before they run,
// and slow CI machines take longer), so it waits up to a minute and shows the program's output on failure.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const list = path.join(root, 'build', 'programs.json');
if (!fs.existsSync(list)) throw new Error('No built programs: run "npm run package" first.');

const WAIT_SECONDS = 60;
const logFile = path.join(
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Cardinal')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Cardinal')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'cardinal'),
  'cardinal.log',
);

let port = 4699;
for (const { variant, run } of JSON.parse(fs.readFileSync(list, 'utf8'))) {
  port--;
  const started = Date.now();
  const child = spawn(run, ['--no-open', `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  let exited = null;
  child.on('exit', (code, signal) => (exited = signal ?? `code ${code}`));
  child.on('error', (e) => (exited = e.message));

  const fail = (msg) => {
    child.kill();
    console.error(`Smoke test failed for ${path.basename(run)} (${variant}): ${msg}`);
    console.error(`--- program output ---\n${output.trim() || '(none)'}`);
    try {
      console.error(`--- ${logFile} ---\n${fs.readFileSync(logFile, 'utf8').trim() || '(empty)'}`);
    } catch {
      console.error(`--- no log file at ${logFile} ---`);
    }
    process.exit(1);
  };

  let page = '';
  while (!page && exited === null && Date.now() - started < WAIT_SECONDS * 1000) {
    await new Promise((r) => setTimeout(r, 250));
    page = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) }).then((r) => (r.ok ? r.text() : ''), () => '');
  }
  if (!page && exited !== null) fail(`the program stopped before it answered (${exited})`);
  if (!page) fail(`the program did not answer within ${WAIT_SECONDS} seconds`);
  if (!/<meta name="card-maker-bridge" content="[0-9a-f]{48}">/.test(page)) fail('the page has no bridge token');
  const script = page.match(/src="\/(assets\/[^"]+\.js)"/)?.[1];
  if (!script || !(await fetch(`http://localhost:${port}/${script}`)).ok) fail(`the page's script ${script} is not served`);
  child.kill();
  console.log(`Smoke test passed: ${path.basename(run)} (${variant}) serves the app after ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}
