// Checks that a release tag matches the version in package.json and that CHANGELOG.md has a
// section for it, then prints that section (the release notes):
//   node scripts/release-notes.mjs v0.1.0 > notes.md
// The release workflow runs it before building, so a forgotten version bump stops the release early.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tag = process.argv[2] ?? '';
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (tag !== `v${version}`) fail(`The tag "${tag}" doesn't match package.json, which says version ${version}. Tag v${version}, or change the version first.`);
const lines = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start < 0) fail(`CHANGELOG.md has no "## [${version}]" section. Describe this version there first.`);
const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
console.log(lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim());
