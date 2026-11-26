// Starts each program that `npm run package` built (listed in build/programs.json) and checks
// that it serves the app with a bridge token, then stops it. Used by the release workflow on each system.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const list = path.join(root, 'build', 'programs.json');
if (!fs.existsSync(list)) throw new Error('No built programs: run "npm run package" first.');

let port = 4699;
for (const { variant, run } of JSON.parse(fs.readFileSync(list, 'utf8'))) {
  port--;
  const child = spawn(run, ['--no-open', `--port=${port}`], { stdio: 'ignore' });
  const fail = (msg) => {
    child.kill();
    console.error(`Smoke test failed for ${path.basename(run)}: ${msg}`);
    process.exit(1);
  };
  let page = '';
  for (let i = 0; i < 40 && !page; i++) {
    await new Promise((r) => setTimeout(r, 250));
    page = await fetch(`http://localhost:${port}/`).then((r) => (r.ok ? r.text() : ''), () => '');
  }
  if (!page) fail('the program did not answer within 10 seconds');
  if (!/<meta name="card-maker-bridge" content="[0-9a-f]{48}">/.test(page)) fail('the page has no bridge token');
  const script = page.match(/src="\/(assets\/[^"]+\.js)"/)?.[1];
  if (!script || !(await fetch(`http://localhost:${port}/${script}`)).ok) fail(`the page's script ${script} is not served`);
  child.kill();
  console.log(`Smoke test passed: ${path.basename(run)} (${variant}) serves the app.`);
}
