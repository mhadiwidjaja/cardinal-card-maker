// Builds the downloads for the system this runs on, each one program with the page inside it,
// zipped with a short read-me and the licences:
//   "Cardinal"          opens in its own window and quits when the window closes
//                       (Windows: no console window; Mac: Cardinal.app)
//   "Cardinal Browser"  opens in the default browser and runs until its console window is closed
//   npm run package        (runs `npm run build` first)
// Result: release/<name>-<os>-<arch>.zip and release/<name>-browser-<os>-<arch>.zip, and
// build/programs.json for scripts/smoke.mjs. Each system builds its own (see
// .github/workflows/release.yml); Node can't build a Mac program on Windows.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { build } from 'rolldown';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const NAME = pkg.productName;
const SLUG = pkg.name;
const OS = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform] ?? process.platform;
const ARCH = process.arch === 'arm64' ? (OS === 'mac' ? 'apple-silicon' : 'arm64') : OS === 'mac' ? 'intel' : process.arch;
const NL = OS === 'windows' ? '\r\n' : '\n';

const out = (...p) => path.join(root, ...p);
const dist = out('dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('dist/index.html is missing: run "npm run build" first.');
try {
  fs.rmSync(out('build'), { recursive: true, force: true });
} catch (e) {
  throw new Error(`Could not clear build/ (${e.code}). Is a copy of ${NAME} from build/ still running? Close it and try again.`);
}
fs.mkdirSync(out('build'), { recursive: true });

await build({ input: out('server', 'main.ts'), platform: 'node', logLevel: 'warn', output: { file: out('build', 'app.cjs'), format: 'cjs' } });

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}
const pageAssets = Object.fromEntries(walk(dist).map((rel) => [rel, path.join(dist, rel)]));

/** Makes a Windows program start without a console window (PE header "subsystem": 2 = GUI, 3 = console). */
function withoutConsole(file) {
  const b = fs.readFileSync(file);
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error(`${file} is not a Windows program`);
  b.writeUInt16LE(2, pe + 24 + 68);
  fs.writeFileSync(file, b);
}

/** Builds one program in build/<id>/ and returns its path (on a Mac, the app variant's path is the .app bundle). */
async function buildProgram(v) {
  const dir = out('build', v.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'launch.json'), JSON.stringify({ mode: v.mode }));
  const exe = path.join(dir, OS === 'windows' ? `${v.name}.exe` : OS === 'mac' && v.mode === 'app' ? NAME : OS === 'mac' ? v.name : v.slug);
  const config = {
    main: out('build', 'app.cjs'),
    output: exe,
    disableExperimentalSEAWarning: true,
    useCodeCache: true,
    assets: { ...pageAssets, 'launch.json': path.join(dir, 'launch.json') },
  };
  if (OS === 'windows') {
    // The icon, name and console setting go onto a copy of Node before the app is put inside, so the app's data is never rewritten.
    const base = path.join(dir, 'node-base.exe');
    fs.copyFileSync(process.execPath, base);
    const { rcedit } = await import('rcedit');
    await rcedit(base, {
      icon: out('icons', 'cardinal.ico'),
      'file-version': pkg.version,
      'product-version': pkg.version,
      'version-string': {
        ProductName: NAME,
        FileDescription: v.mode === 'app' ? `${NAME}: Card Maker` : `${NAME}: Card Maker (opens in your browser)`,
        CompanyName: `The ${NAME} authors`,
        LegalCopyright: `Copyright (c) 2026 The ${NAME} authors. MIT License.`,
        OriginalFilename: path.basename(exe),
        InternalName: v.name,
      },
    });
    if (v.mode === 'app') withoutConsole(base);
    config.executable = base;
  }
  fs.writeFileSync(path.join(dir, 'sea-config.json'), JSON.stringify(config, null, 2));
  execFileSync(process.execPath, ['--build-sea', path.join(dir, 'sea-config.json')], { stdio: 'inherit' });
  if (OS !== 'mac') return { program: exe, run: exe };
  if (v.mode !== 'app') {
    // macOS only runs signed programs; an ad-hoc signature is enough for a program people download themselves.
    execFileSync('codesign', ['--sign', '-', '--force', exe], { stdio: 'inherit' });
    return { program: exe, run: exe };
  }
  const app = path.join(dir, `${NAME}.app`);
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
  fs.renameSync(exe, path.join(app, 'Contents', 'MacOS', NAME));
  fs.copyFileSync(out('icons', 'cardinal.icns'), path.join(app, 'Contents', 'Resources', 'cardinal.icns'));
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), infoPlist());
  execFileSync('codesign', ['--sign', '-', '--force', app], { stdio: 'inherit' });
  return { program: app, run: path.join(app, 'Contents', 'MacOS', NAME) };
}

function infoPlist() {
  const entries = {
    CFBundleName: NAME,
    CFBundleDisplayName: NAME,
    CFBundleIdentifier: 'app.cardinal.cardmaker',
    CFBundleExecutable: NAME,
    CFBundleIconFile: 'cardinal',
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: pkg.version,
    CFBundleVersion: pkg.version,
    LSMinimumSystemVersion: '13.5',
    NSHighResolutionCapable: true,
    // No Dock icon of its own: the program only serves the page, and the browser window it opens is what the user sees.
    LSUIElement: true,
  };
  const value = (v) => (v === true ? '<true/>' : `<string>${v}</string>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    ...Object.entries(entries).map(([k, v]) => `  <key>${k}</key>${value(v)}`),
    '</dict></plist>',
    '',
  ].join('\n');
}

function licenceText(dir) {
  const f = fs.readdirSync(dir).find((n) => /^(licen[cs]e|copying|ofl)/i.test(n));
  return f ? fs.readFileSync(path.join(dir, f), 'utf8').trim() : null;
}

function thirdParty() {
  const seen = new Map();
  const visit = (name) => {
    if (seen.has(name)) return;
    const dir = out('node_modules', ...name.split('/'));
    if (!fs.existsSync(dir)) return;
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    seen.set(name, { version: p.version, license: p.license, text: licenceText(dir) });
    Object.keys(p.dependencies ?? {}).forEach(visit);
  };
  Object.keys(pkg.dependencies).forEach(visit);
  const parts = [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([name, d]) => `${name} ${d.version} (${d.license})\n\n${d.text ?? `Licence: ${d.license}`}`);
  // The release workflow downloads Node's own licence (it lists Node's bundled libraries too) and passes its path.
  const file = process.env.NODE_LICENSE_FILE;
  const node = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : `See https://github.com/nodejs/node/blob/${process.version}/LICENSE`;
  parts.unshift(`Node.js ${process.version} (MIT and others): the program is built on it.\n\n${node}`);
  return `${NAME} includes the following software.\n\n` + parts.join('\n\n' + '='.repeat(72) + '\n\n') + '\n';
}

const FIRST_START = {
  windows: ['The first time, Windows may say "Windows protected your PC" because the program', 'is not signed by a paid certificate. Click "More info", then "Run anyway".'],
  mac: [
    'The first time, macOS says it cannot check the program for malware, because it',
    'is not notarised by Apple (that needs a paid developer account). To allow it:',
    '  1. Double-click it once and click "Done" (or "Cancel").',
    '  2. Open System Settings > Privacy & Security, scroll down and click "Open Anyway".',
    '  3. Double-click it again and confirm with "Open".',
    'Or, in Terminal:  xattr -dr com.apple.quarantine <drag the unzipped folder here>',
  ],
  linux: [],
}[OS];

function readme(v, program) {
  const file = path.basename(program);
  const start =
    v.mode === 'app'
      ? [
          `Double-click "${file}". ${NAME} opens in its own window. Close the window to quit.`,
          '',
          OS === 'windows'
            ? 'The window is drawn by Microsoft Edge, which is part of Windows (or Chrome, if Edge'
            : 'The window is drawn by Google Chrome or Microsoft Edge if one is installed (otherwise',
          OS === 'windows'
            ? 'is missing). It uses its own profile, separate from your own browsing.'
            : 'it opens in your default browser). It uses its own profile, separate from your browsing.',
          `Would you rather use your own browser, such as Firefox or Zen? Get "${NAME} Browser".`,
        ]
      : [
          OS === 'linux'
            ? `Run ./${file} from a terminal. ${NAME} opens in your default browser.`
            : `Double-click "${file}". A ${OS === 'mac' ? 'Terminal' : 'black'} window opens and ${NAME} opens in your default browser.`,
          `Keep that window open while you work; ${OS === 'linux' ? 'press Ctrl+C' : 'close it'} to stop.`,
          'Any modern browser works: Chrome, Edge, Firefox, Safari or Zen.',
        ];
  return [
    `${v.name} ${pkg.version} for ${OS === 'mac' ? `Mac (${ARCH === 'intel' ? 'Intel' : 'Apple silicon'})` : `${OS} (${ARCH})`}`,
    '',
    'Nothing to install: this one program is the whole app. It runs only on your',
    'computer and never sends anything over the internet.',
    '',
    ...start,
    ...(FIRST_START.length ? ['', ...FIRST_START] : []),
    '',
    'Your projects are ordinary folders of JSON, CSV and image files.',
    '',
    `Help: the "?" button in the app, or the user guide at ${pkg.homepage ?? 'the project page'}.`,
    '',
  ].join(NL);
}

const VARIANTS = [
  { id: 'app', name: NAME, slug: SLUG, mode: 'app' },
  { id: 'browser', name: `${NAME} Browser`, slug: `${SLUG}-browser`, mode: 'browser' },
];
const licences = new TextEncoder().encode(thirdParty());
const programs = [];
fs.mkdirSync(out('release'), { recursive: true });
for (const v of VARIANTS) {
  const { program, run } = await buildProgram(v);
  programs.push({ variant: v.id, mode: v.mode, run });
  const folder = `${v.slug}-${OS}-${ARCH}`;
  const exec = 0o100755 << 16;
  const files = {
    [`${folder}/READ ME FIRST.txt`]: new TextEncoder().encode(readme(v, program)),
    [`${folder}/LICENSE.txt`]: fs.readFileSync(out('LICENSE')),
    [`${folder}/THIRD-PARTY LICENSES.txt`]: licences,
  };
  const base = path.dirname(program);
  const inProgram = fs.statSync(program).isDirectory() ? walk(program).map((rel) => path.join(program, rel)) : [program];
  for (const file of inProgram) {
    const runnable = OS !== 'windows' && (file === run || (fs.statSync(file).mode & 0o111) !== 0);
    files[`${folder}/${path.relative(base, file).split(path.sep).join('/')}`] = [fs.readFileSync(file), { os: 3, attrs: runnable ? exec : 0o100644 << 16 }];
  }
  const zip = out('release', `${folder}.zip`);
  fs.writeFileSync(zip, zipSync(files, { level: 9 }));
  console.log(`${path.relative(root, zip)}  ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB`);
}
fs.writeFileSync(out('build', 'programs.json'), JSON.stringify(programs, null, 2));
