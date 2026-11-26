// Draws the program icons from the logo (docs/images/cardinal.svg) with the installed Edge:
//   node scripts/icons.mjs
// Writes icons/cardinal.ico (Windows program icon), icons/cardinal.icns (Mac app icon) and
// icons/cardinal-256.png. Run it again after changing the logo; the results are kept in the
// repository so release builds need no browser.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const svg = fs.readFileSync(path.join(root, 'docs', 'images', 'cardinal.svg'), 'utf8');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const SIZES = [...ICO_SIZES, 512, 1024];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const images = await page.evaluate(
  async ({ svg, sizes }) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    return sizes.map((s) => {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, s, s);
      return { size: s, rgba: Array.from(ctx.getImageData(0, 0, s, s).data), png: c.toDataURL('image/png').split(',')[1] };
    });
  },
  { svg, sizes: SIZES },
);
await browser.close();

/** A 32-bit Windows bitmap as stored in an .ico: bottom-up BGRA rows, then a 1-bit AND mask. */
function dib({ size, rgba }) {
  const maskRow = Math.ceil(size / 32) * 4;
  const buf = Buffer.alloc(40 + size * size * 4 + maskRow * size);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8); // Height counts the colour rows and the mask rows.
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4;
      const dst = 40 + (y * size + x) * 4;
      buf[dst] = rgba[src + 2];
      buf[dst + 1] = rgba[src + 1];
      buf[dst + 2] = rgba[src];
      buf[dst + 3] = rgba[src + 3];
    }
  }
  return buf;
}

// Sizes below 256 as bitmaps, which every Windows version and tool reads; 256 as PNG, as Windows expects.
const entries = images.filter((im) => ICO_SIZES.includes(im.size)).map((im) => ({ size: im.size, data: im.size === 256 ? Buffer.from(im.png, 'base64') : dib(im) }));
const header = Buffer.alloc(6 + 16 * entries.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach((e, i) => {
  const at = 6 + i * 16;
  header[at] = e.size === 256 ? 0 : e.size;
  header[at + 1] = e.size === 256 ? 0 : e.size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(e.data.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += e.data.length;
});

const out = path.join(root, 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'cardinal.ico'), Buffer.concat([header, ...entries.map((e) => e.data)]));
const png = (size) => Buffer.from(images.find((im) => im.size === size).png, 'base64');
fs.writeFileSync(path.join(out, 'cardinal-256.png'), png(256));

// .icns: a list of (type, length, PNG) blocks. The ic11 to ic14 types are the double-resolution (Retina) versions.
const ICNS = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
const blocks = Object.entries(ICNS).map(([type, size]) => {
  const data = png(size);
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1');
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
});
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'latin1');
icnsHead.writeUInt32BE(8 + blocks.reduce((n, b) => n + b.length, 0), 4);
fs.writeFileSync(path.join(out, 'cardinal.icns'), Buffer.concat([icnsHead, ...blocks]));
console.log(`icons/cardinal.ico (${ICO_SIZES.join(', ')} px), icons/cardinal.icns and icons/cardinal-256.png`);
