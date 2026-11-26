// Browser tests: drive the real app in the installed Microsoft Edge.
// Needs the dev server running (npm run dev). Run with: npm run e2e
import { existsSync } from 'node:fs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';

const BASE = process.env.CM_URL ?? 'http://localhost:5173/';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** True once the app has written a recovery draft to IndexedDB (runs in the page). */
const draftStored = () =>
  new Promise((resolve) => {
    const req = indexedDB.open('card-maker-drafts', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('drafts');
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const count = req.result.transaction('drafts').objectStore('drafts').count();
      count.onsuccess = () => {
        req.result.close();
        resolve(count.result > 0);
      };
      count.onerror = () => resolve(false);
    };
  });

/** Retries a check for a few seconds: some browsers (WebKit) update the page a moment after a key press. */
async function until(check, message, ms = 3000) {
  for (const end = Date.now() + ms; ; ) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(message);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Thrown by a test that can't run in this browser; counted apart from failures. */
class Skip extends Error {}

async function newPage(browser, query) {
  // Playwright's WebKit for Windows can't write to browser-private storage (OPFS); Safari on a Mac can.
  if (process.env.CM_BROWSER === 'webkit' && query.includes('opfs')) throw new Skip('needs browser-private storage, which WebKit on Windows lacks');
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept(page.__dialogAnswer ?? undefined));
  await page.goto(BASE + query);
  return { page, errors };
}

const numIn = (page, label, i) => page.locator(`.prop:has(> label:text-is("${label}")) input.num`).nth(i);

test('template editor: drag a layer, then undo', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=templates');
  await page.locator('.tpl-list li', { hasText: /^Unit/ }).click();
  await page.locator('.layer-list li', { hasText: 'statsText' }).click();
  const x = numIn(page, 'Position', 0);
  const before = Number(await x.inputValue());
  const box = await page.locator('.g-box.sel').boundingBox();
  assert(box, 'selected box visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40, { steps: 8 });
  await page.mouse.up();
  const after = Number(await x.inputValue());
  assert(after < before - 20, `x should decrease after drag (before ${before}, after ${after})`);
  await page.keyboard.press('Control+z');
  await until(async () => Number(await x.inputValue()) === before, 'undo restores the position');
  await page.keyboard.press('Control+y');
  await until(async () => Number(await x.inputValue()) === after, 'redo re-applies the drag');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('template editor: edit a property of an inherited layer, reset it', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=templates');
  await page.locator('.tpl-list li', { hasText: /^Unit/ }).click();
  await page.locator('.layer-list li', { hasText: /^.?name/ }).first().click();
  const size = page.locator('.prop:has(> label:text-is("Font")) input.num').first();
  await size.fill('60');
  assert(await page.locator('.prop.over > label:text-is("Font")').count() === 1, 'Font row marked as overridden');
  await page.locator('.prop:has(> label:text-is("Font")) .reset').click();
  assert((await size.inputValue()) === '46', 'reset restores the inherited size');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('template editor: add and delete a layer', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=templates');
  await page.locator('.layer-list li').first().waitFor();
  const count = () => page.locator('.layer-list li').count();
  const n = await count();
  await page.locator('.layer-list select').selectOption('text');
  assert((await count()) === n + 1, 'layer added');
  await page.keyboard.press('Delete');
  assert((await count()) === n, 'layer deleted with the Delete key');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('save writes template files with a .bak copy', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh&tab=templates');
  await page.locator('.tpl-list li', { hasText: /^Unit/ }).click();
  await page.locator('.layer-list li', { hasText: 'statsText' }).click();
  await numIn(page, 'Position', 0).fill('500');
  await page.getByRole('button', { name: /Save \(\d+\)/ }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await (await (await root.getDirectoryHandle('games')).getDirectoryHandle('demo-game')).getDirectoryHandle('templates'));
    const read = async (n) => (await (await dir.getFileHandle(n)).getFile()).text();
    return { unit: await read('unit.json'), bak: await read('unit.json.bak') };
  });
  assert(JSON.parse(files.unit).faces.front.layers.some((l) => l.id === 'statsText' && l.rect[0] === 500), 'new x saved');
  assert(!files.bak.includes('500'), '.bak holds the previous version');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

const readOpfs = (page, path) =>
  page.evaluate(async (p) => {
    let dir = await navigator.storage.getDirectory();
    const parts = p.split('/');
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text();
  }, path);

const cell = (page, r, c) => page.locator(`td[data-pos="${r}:${c}"]`);

test('grid: type into a cell, preview follows, undo, save to CSV', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await cell(page, 0, 1).click();
  await page.keyboard.type('Blaze Scout');
  await page.keyboard.press('Enter');
  assert((await cell(page, 0, 1).innerText()) === 'Blaze Scout', 'cell shows typed text');
  assert(await cell(page, 1, 1).evaluate((td) => td.classList.contains('focus')), 'Enter moves down');
  await page.keyboard.press('Control+z');
  assert((await cell(page, 0, 1).innerText()) === 'Ember Scout', 'undo restores the cell');
  await page.keyboard.press('Control+y');
  await page.getByRole('button', { name: /Save \(\d+\)/ }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  const csv = await readOpfs(page, 'games/demo-game/sets/core/cards.csv');
  assert(csv.split('\r\n')[1].startsWith('c001,Blaze Scout,unit'), 'CSV saved: ' + csv.split('\r\n')[1]);
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('layout: Spreadsheet menu stays on screen, side panels resize and remember their width', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo');
  await page.getByRole('button', { name: /^More/ }).click();
  const menu = page.locator('.ws-dropdown[role="menu"]');
  const box = await menu.boundingBox();
  assert(box && box.x >= 0 && box.x + box.width <= 1500, 'menu inside the window: ' + JSON.stringify(box));
  // Nothing covers or clips the menu: the point at its left edge belongs to it.
  const onTop = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.ws-dropdown'), [box.x + 4, box.y + box.height / 2]);
  assert(onTop, 'left edge of the menu is visible');
  await page.keyboard.press('Escape');

  const pane = page.locator('.wb-inspector');
  const before = (await pane.boundingBox()).width;
  const handle = await page.getByRole('separator', { name: 'Inspector width' }).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 200, handle.y + 200, { steps: 6 });
  await page.mouse.up();
  const wider = (await pane.boundingBox()).width;
  assert(Math.abs(wider - before - 200) < 4, `preview grew by 200 px (${before} → ${wider})`);
  await page.reload();
  assert(Math.abs((await page.locator('.wb-inspector').boundingBox()).width - wider) < 2, 'width remembered after reload');
  await page.getByRole('separator', { name: 'Inspector width' }).dblclick();
  assert(Math.abs((await page.locator('.wb-inspector').boundingBox()).width - before) < 2, 'double-click resets the width');

  const sidebar = page.locator('.sidebar');
  const sb = (await sidebar.boundingBox()).width;
  await page.getByRole('separator', { name: 'Sidebar width' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert(Math.abs((await sidebar.boundingBox()).width - sb - 32) < 2, 'arrow keys widen the sidebar');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('print PDF: best-fit page orientation turns the page when it fits more cards', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=export');
  await page.locator('.export-kind', { hasText: 'Print PDF' }).click();
  const pageRow = page.locator('.export-row').filter({ has: page.locator('> label', { hasText: /^Page$/ }) });
  assert(/3 × 3 = 9 cards per page/.test(await pageRow.innerText()), 'no bleed: portrait, 9 per page');
  await page.getByRole('checkbox', { name: /Print bleed/ }).check();
  const text = await pageRow.innerText();
  assert(/4 × 2 = 8 cards per page \(portrait: 6\)/.test(text), 'with bleed: landscape fits 8: ' + text);
  assert(/flip on short edge/.test(await page.locator('.export-row option[value="duplex"]').textContent()), 'landscape duplex says short edge');
  await pageRow.locator('select').nth(1).selectOption('portrait');
  assert(/2 × 3 = 6 cards per page/.test(await pageRow.innerText()), 'portrait forced: 6 per page');
  assert((await page.locator('.export-row', { hasText: 'Quality' }).locator('input').inputValue()) === '600', '600 DPI by default');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('workbench: the inspector edits the selected card, the sheet drawer opens and closes', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await cell(page, 0, 1).waitFor();
  await page.locator('.card-list li', { hasText: 'Pyre Titan' }).click();
  assert((await page.locator('.wb-inspector').getByLabel('name').inputValue()) === 'Pyre Titan', 'inspector shows the card');
  const cost = page.locator('.wb-inspector').getByLabel('cost');
  await cost.fill('7');
  await cost.press('Enter');
  assert((await cell(page, 3, 3).innerText()) === '7', 'the sheet shows the new cost');
  await page.locator('.wb-inspector').getByRole('checkbox', { name: 'Water' }).check();
  assert((await cell(page, 3, 4).innerText()) === 'Fire, Water', 'multi-choice from checkboxes');
  await page.keyboard.press('Control+z');
  assert((await cell(page, 3, 4).innerText()) === 'Fire', 'one undo per change');
  await page.locator('.card-list').focus();
  await page.keyboard.press('ArrowDown');
  assert((await page.locator('.wb-inspector').getByLabel('name').inputValue()) === 'Tide Caller', 'arrow down selects the next card');
  await page.getByRole('button', { name: /Sheet/ }).click();
  assert((await page.locator('.grid-wrap').count()) === 0, 'sheet closed');
  await page.getByRole('button', { name: /Sheet/ }).click();
  await cell(page, 0, 1).waitFor();
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('grid: paste a block from Excel, extra rows become new cards', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await cell(page, 13, 1).click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Mudslinger X\tunit\r\nNew One\tspell\r\nNew Two\tunit\r\n');
    // Firefox empties clipboardData on synthetic events, so attach it directly.
    const ev = new ClipboardEvent('paste', { bubbles: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    document.querySelector('.grid').dispatchEvent(ev);
  });
  assert((await cell(page, 13, 1).innerText()) === 'Mudslinger X', 'pasted into existing row');
  assert((await page.locator('.grid tbody tr').count()) === 16, 'two cards added');
  assert((await cell(page, 15, 0).innerText()) === 'c016', 'new ids follow the pattern');
  assert((await cell(page, 15, 2).innerText()) === 'unit', 'pasted template');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('grid: invalid values are flagged; filter by expression; sort', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await cell(page, 0, 3).click();
  await page.keyboard.type('two');
  await page.keyboard.press('Enter');
  assert(await cell(page, 0, 3).evaluate((td) => td.classList.contains('bad')), 'non-number flagged');
  await page.locator('.grid-toolbar .filter').fill("= rarity == 'Rare'");
  assert((await page.locator('.grid tbody tr').count()) === 3, 'expression filter');
  await page.locator('.grid-toolbar .filter').fill('');
  await page.locator('.grid th', { hasText: 'cost' }).click();
  await page.locator('.grid th', { hasText: 'cost' }).click();
  assert((await cell(page, 0, 3).innerText()) === '6', 'sorted by cost descending');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('recovery: unsaved edits survive a reload, Restore brings them back, Save writes them', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await cell(page, 0, 1).click();
  await page.keyboard.type('Recovered Scout');
  await page.keyboard.press('Enter');
  for (let t = Date.now(); !(await page.evaluate(draftStored)); ) {
    assert(Date.now() - t < 15000, 'recovery draft stored within 15 s');
    await page.waitForTimeout(200);
  }
  await page.goto(BASE + '?opfs');
  await page.locator('.banner.recovery').waitFor();
  assert((await cell(page, 0, 1).innerText()) === 'Ember Scout', 'files are untouched before Restore');
  assert(/1 file/.test(await page.locator('.banner.recovery').innerText()), 'banner counts the files');
  await page.locator('.banner.recovery').getByRole('button', { name: 'Restore' }).click();
  await page.locator('td[data-pos="0:1"]', { hasText: 'Recovered Scout' }).waitFor();
  assert((await page.locator('.banner.recovery').count()) === 0, 'banner gone after Restore');
  await page.getByRole('button', { name: /Save \(1\)/ }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  const csv = await readOpfs(page, 'games/demo-game/sets/core/cards.csv');
  assert(csv.split('\r\n')[1].startsWith('c001,Recovered Scout'), 'restored edit saved: ' + csv.split('\r\n')[1]);
  const backups = await listOpfs(page, 'backups');
  const backedUpCsv = backups.find((f) => f.name.endsWith('sets/core/cards.csv'));
  assert(backedUpCsv, 'automatic backup made: ' + backups.map((f) => f.name).join(', '));
  assert(!(await readOpfs(page, 'backups/' + backedUpCsv.name)).includes('Recovered Scout'), 'backup holds the version before the edit');
  await page.goto(BASE + '?opfs');
  await page.locator('td[data-pos="0:1"]', { hasText: 'Recovered Scout' }).waitFor();
  await page.waitForTimeout(300);
  assert((await page.locator('.banner.recovery').count()) === 0, 'no banner once saved');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('import: an Excel "CSV" (windows-1252) is read correctly and the changes are listed', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await page.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: /Import from CSV/ }).click();
  // "Café Scout" with é as the single byte 0xE9, as Excel saves plain "CSV" on Western Windows.
  const bytes = Buffer.concat([Buffer.from('id,name,cost\r\nc001,Caf'), Buffer.from([0xe9]), Buffer.from(' Scout,1\r\nz9,Brand New,2\r\n')]);
  await page.locator('.modal input[type=file]').setInputFiles({ name: 'cards.csv', mimeType: 'text/csv', buffer: bytes });
  await page.locator('.modal', { hasText: 'not UTF-8' }).waitFor();
  const lines = await page.locator('.import-changes li').allInnerTexts();
  assert(lines.some((l) => l.includes('Ember Scout') && l.includes('name') && l.includes('Café Scout')), 'name change listed: ' + lines.join(' | '));
  assert(lines.some((l) => l.includes('Brand New') && l.includes('new card')), 'added card listed: ' + lines.join(' | '));
  await page.locator('.modal').getByRole('button', { name: 'Import' }).click();
  assert((await cell(page, 0, 1).innerText()) === 'Café Scout', 'imported with the right letter');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('statistics: tiles, split by element, filter, table view', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=stats');
  const tileValue = (label) => page.locator('.tile', { hasText: label }).locator('.tile-value');
  assert((await tileValue('Cards').innerText()) === '14', 'card count tile');
  const cost = page.locator('.chart-card', { hasText: 'Cost curve' });
  await cost.locator('select').selectOption('element');
  assert((await cost.locator('.legend-item').count()) === 3, 'legend for 3 elements');
  await cost.locator('svg rect[fill="transparent"]').nth(3).hover();
  const tip = await cost.locator('.chart-tip').innerText();
  assert(tip.includes('cost 4') && tip.includes('Water: 2'), 'tooltip breakdown: ' + tip);
  await page.locator('.stats-filters .filter').fill("= rarity == 'Rare'");
  assert((await tileValue('Cards').innerText()) === '3', 'filter applies');
  await cost.getByRole('button', { name: 'Table' }).click();
  assert((await cost.locator('tbody tr').count()) > 0, 'table view');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

const listOpfs = (page, path) =>
  page.evaluate(async (p) => {
    let dir = await navigator.storage.getDirectory();
    for (const part of p.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part);
    const out = [];
    const walk = async (d, prefix) => {
      for await (const h of d.values()) {
        if (h.kind === 'directory') await walk(h, prefix + h.name + '/');
        else out.push({ name: prefix + h.name, size: (await h.getFile()).size });
      }
    };
    await walk(dir, '');
    return out;
  }, path);

test('export: print PDF, PNG images and TTS sheets into export/', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh&tab=export');
  await page.locator('.export-kind', { hasText: 'Print PDF' }).click();
  await page.locator('.export-row', { hasText: 'Backs' }).locator('select').selectOption('duplex');
  await page.getByRole('button', { name: 'Create PDF' }).click();
  await page.locator('.export-result').waitFor({ timeout: 60000 });
  const msg = await page.locator('.export-result p').first().innerText();
  assert(/31 cards on 8 pages/.test(msg), 'PDF summary: ' + msg);
  let files = await listOpfs(page, 'games/demo-game/export');
  const pdfFile = files.find((f) => f.name.endsWith('.pdf'));
  assert(pdfFile && pdfFile.size > 50000, 'PDF written: ' + JSON.stringify(files));
  const b64 = await page.evaluate(async (name) => {
    const dir = await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('games')).getDirectoryHandle('demo-game')).getDirectoryHandle('export');
    const buf = new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, pdfFile.name);
  if (process.env.CM_OUT) (await import('node:fs')).writeFileSync(process.env.CM_OUT + '/print.pdf', Buffer.from(b64, 'base64'));

  await page.locator('.export-kind', { hasText: 'Images' }).click();
  await page.getByRole('button', { name: 'Export images' }).click();
  await page.locator('.export-result').waitFor({ timeout: 60000 });
  files = await listOpfs(page, 'games/demo-game/export');
  const pngs = files.filter((f) => f.name.startsWith('png-') && f.name.endsWith('.png'));
  assert(pngs.length === 14, `14 PNGs written, got ${pngs.length}`);
  assert(pngs.some((f) => f.name.endsWith('001 Ember Scout.png')), 'file name pattern');

  await page.locator('.export-kind', { hasText: 'Tabletop Simulator' }).click();
  await page.getByRole('button', { name: 'Create deck sheets' }).click();
  await page.locator('.export-result').waitFor({ timeout: 60000 });
  files = await listOpfs(page, 'games/demo-game/export');
  assert(files.some((f) => /tts-.*\/deck-1\.png$/.test(f.name)), 'TTS sheet');
  assert(files.some((f) => /tts-.*\/back\.png$/.test(f.name)), 'TTS back');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

const readOpfsBytes = async (page, path) =>
  Buffer.from(
    await page.evaluate(async (p) => {
      let dir = await navigator.storage.getDirectory();
      const parts = p.split('/');
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      const buf = new Uint8Array(await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, path),
    'base64',
  );

async function pdfImages(bytes) {
  const { PDFDocument, PDFName, PDFRawStream } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  const out = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    out.push({ w: Number(obj.dict.get(PDFName.of('Width'))), h: Number(obj.dict.get(PDFName.of('Height'))), cs: obj.dict.get(PDFName.of('ColorSpace'))?.toString() });
  }
  return { doc, images: out, intents: doc.catalog.get(PDFName.of('OutputIntents')) };
}

test('export: a one-page test print sheet, in RGB and CMYK', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=export');
  await page.locator('.export-kind', { hasText: 'Print PDF' }).click();
  for (const colour of ['rgb', 'cmyk']) {
    await page.locator('.export-row', { hasText: 'Colour' }).locator('select').selectOption(colour);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'Test print sheet' }).click()]);
    const bytes = readFileSync(await dl.path());
    if (process.env.CM_OUT) writeFileSync(`${process.env.CM_OUT}/test-print-${colour}.pdf`, bytes);
    const { doc, images } = await pdfImages(bytes);
    assert(doc.getPageCount() === 1, 'one page');
    assert(images.length === 1, `one card picture, got ${images.length}`);
    assert(colour === 'rgb' ? images[0].cs !== '/DeviceCMYK' : images[0].cs === '/DeviceCMYK', `${colour} picture: ${images[0].cs}`);
  }
  assert(/Test print sheet downloaded/.test(await page.locator('.export-result p').first().innerText()), 'result message');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('horizontal cards: template shape, preview, upright on the CMYK print sheet', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh&tab=templates');
  await page.locator('.tpl-list li', { hasText: /^Spell/ }).click();
  await page.locator('.tpl-settings label', { hasText: 'Card shape' }).locator('select').selectOption('landscape');
  assert(await page.locator('.tpl-list li', { hasText: 'horizontal' }).count(), 'list marks the template as horizontal');
  await page.getByRole('button', { name: /Save \(\d+\)/ }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  assert(JSON.parse(await readOpfs(page, 'games/demo-game/templates/spell.json')).orientation === 'landscape', 'saved in the template file');

  await page.locator('.tab', { hasText: 'Cards' }).click();
  await cell(page, 2, 1).click();
  await page.waitForTimeout(400);
  const [w, h] = await page.locator('.preview-card canvas').evaluate((c) => [c.width, c.height]);
  assert(w > h, `spell preview is wide (${w}×${h})`);

  await page.locator('.tab', { hasText: 'Export' }).click();
  await page.locator('.export-kind', { hasText: 'Print PDF' }).click();
  await page.locator('.export-row', { hasText: 'Colour' }).locator('select').selectOption('cmyk');
  await page.getByRole('button', { name: 'Create PDF' }).click();
  await page.locator('.export-result').waitFor({ timeout: 120000 });
  assert(/CMYK/.test(await page.locator('.export-result p').first().innerText()), 'result mentions CMYK');
  let pdfName = (await listOpfs(page, 'games/demo-game/export')).find((f) => f.name.endsWith('.pdf')).name;
  let { images, intents } = await pdfImages(await readOpfsBytes(page, `games/demo-game/export/${pdfName}`));
  assert(images.length === 14, `14 card images, got ${images.length}`);
  assert(images.every((i) => i.cs === '/DeviceCMYK'), 'all images CMYK: ' + [...new Set(images.map((i) => i.cs))]);
  assert(images.every((i) => i.h > i.w), 'horizontal cards are turned upright on the sheet');
  assert(!intents, 'no output intent without a profile');

  const rswop = 'C:/Windows/System32/spool/drivers/color/RSWOP.icm';
  if (existsSync(rswop)) {
    await page.locator('.export-row', { hasText: 'Conversion' }).locator('input[type=file]').setInputFiles(rswop);
    await page.locator('.export-row', { hasText: 'Rendering' }).locator('text=embedded in the PDF').waitFor();
    await page.getByRole('button', { name: 'Create PDF' }).click();
    await page.locator('.export-result p', { hasText: 'SWOP' }).waitFor({ timeout: 120000 });
    // Folder listings have no fixed order; the time stamp in the name sorts the newest last.
    const pdfs = (await listOpfs(page, 'games/demo-game/export')).filter((f) => f.name.endsWith('.pdf')).map((f) => f.name).sort();
    pdfName = pdfs[pdfs.length - 1];
    ({ intents } = await pdfImages(await readOpfsBytes(page, `games/demo-game/export/${pdfName}`)));
    assert(intents, 'output intent embedded');
    assert((await listOpfs(page, 'games/demo-game/assets/profiles')).some((f) => f.name === 'RSWOP.icm'), 'profile copied into the game');
  }
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('print shop PDF: preset, one card per page with trim and bleed boxes, backs in a separate file', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh&tab=export');
  await page.locator('.export-kind', { hasText: 'Print PDF' }).click();
  await page.getByRole('button', { name: 'Print shop preset' }).click();
  assert((await page.locator('.export-row', { hasText: 'Layout' }).locator('select').inputValue()) === 'perCard', 'preset picks one card per page');
  assert((await page.getByRole('checkbox', { name: 'Crop marks' }).count()) === 0, 'no crop marks option per card');
  await page.locator('.export-row', { hasText: 'Backs' }).locator('select').selectOption('separate');
  await page.getByRole('button', { name: 'Create PDF' }).click();
  await page.locator('.export-result').waitFor({ timeout: 120000 });
  const pdfs = (await listOpfs(page, 'games/demo-game/export')).filter((f) => f.name.endsWith('.pdf')).map((f) => f.name);
  const fronts = pdfs.find((n) => !n.endsWith('-backs.pdf'));
  const backs = pdfs.find((n) => n.endsWith('-backs.pdf'));
  assert(fronts && backs, 'two PDFs: ' + pdfs.join(', '));
  const { PDFDocument } = await import('pdf-lib');
  const mm = (p) => Math.round((p / 72) * 25.4 * 10) / 10;
  for (const name of [fronts, backs]) {
    const doc = await PDFDocument.load(await readOpfsBytes(page, `games/demo-game/export/${name}`));
    assert(doc.getPageCount() === 31, `${name}: 31 pages (one per copy), got ${doc.getPageCount()}`);
    const p = doc.getPage(0);
    const { width, height } = p.getSize();
    assert(mm(width) === 69 && mm(height) === 94, `page is the card plus bleed: ${mm(width)} × ${mm(height)} mm`);
    const trim = p.getTrimBox();
    assert(mm(trim.x) === 3 && mm(trim.width) === 63 && mm(trim.height) === 88, 'TrimBox is the cut line: ' + JSON.stringify(trim));
    assert(mm(p.getBleedBox().width) === 69, 'BleedBox is the whole page');
  }
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('new game: create, save, and it loads back with a working preview', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await page.getByRole('button', { name: '+ New game' }).click();
  await page.locator('.modal input[type="text"]').fill('Star Duel');
  await page.locator('.modal select').selectOption({ label: 'Tarot (70 × 120)' });
  await page.locator('.modal').getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: /Save \(\d+\)/ }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  const files = (await listOpfs(page, 'games/star-duel')).map((f) => f.name).sort();
  assert(
    ['game.json', 'sets/core/cards.csv', 'sets/core/set.json', 'templates/_base.json', 'templates/back.json', 'templates/card.json'].every((f) => files.includes(f)),
    'files written: ' + files.join(', '),
  );
  await page.locator('.ws-button').click();
  await page.getByRole('menuitem', { name: 'Reload from disk' }).click();
  await page.locator('.game', { hasText: 'Star Duel' }).locator('button.set').click();
  await page.locator('.tab', { hasText: 'Cards' }).click();
  await page.locator('.preview canvas').waitFor();
  const w0 = await page.locator('.preview .warnings li').allInnerTexts();
  assert(w0.length === 0, 'preview warnings: ' + w0.join(' | '));
  assert((await page.locator('.sidebar .issues li').count()) === 0, 'workspace has no issues');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('game settings: add a field, upload an icon, art and a font', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh&tab=game');
  page.__dialogAnswer = 'faction';
  await page.getByRole('button', { name: '+ Field' }).click();
  page.__dialogAnswer = undefined;
  assert(await page.locator('.field-row .fid', { hasText: 'faction' }).count(), 'field added');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="gold"/></svg>';
  await page.locator('.game-section', { hasText: 'Icons' }).locator('input[type=file]').setInputFiles({ name: 'coin.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await page.locator('.kv code', { hasText: '[coin]' }).waitFor();
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(40, 30);
    const x = c.getContext('2d');
    x.fillStyle = '#c33';
    x.fillRect(0, 0, 40, 30);
    return Array.from(new Uint8Array(await (await c.convertToBlob()).arrayBuffer()));
  });
  await page.locator('.export-row', { hasText: 'assets/art' }).locator('input[type=file]').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.locator('.export-row', { hasText: 'assets/art' }).getByText('red.png').waitFor();
  const fontPath = ['C:/Windows/Fonts/georgia.ttf', 'C:/Windows/Fonts/arial.ttf'].find((p) => existsSync(p));
  if (fontPath) {
    await page.locator('.game-section', { hasText: 'Fonts' }).locator('input[type=file]').setInputFiles(fontPath);
    await page.locator('.game-section', { hasText: 'Fonts' }).locator('tbody tr').first().waitFor();
  }
  await page.getByRole('button', { name: /Save \(\d+\)/ }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  const game = JSON.parse(await readOpfs(page, 'games/demo-game/game.json'));
  assert(game.fields.some((f) => f.id === 'faction'), 'field saved');
  assert(game.icons.coin?.file === 'icons/coin.svg', 'icon saved');
  if (fontPath) assert(game.fonts?.length === 1, 'font saved');

  await page.locator('.tab', { hasText: 'Cards' }).click();
  const artCol = await page.locator('.grid th').evaluateAll((ths) => ths.findIndex((t) => t.textContent.startsWith('art')) - 1);
  await cell(page, 0, artCol).click();
  await page.keyboard.type('red.png');
  await page.keyboard.press('Enter');
  const rulesCol = await page.locator('.grid th').evaluateAll((ths) => ths.findIndex((t) => t.textContent.startsWith('rules')) - 1);
  await cell(page, 0, rulesCol).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.type(' Pay [coin].');
  await page.keyboard.press('Enter');
  await cell(page, 0, 1).click();
  await page.waitForTimeout(500);
  const warns = await page.locator('.preview .warnings li').allInnerTexts();
  assert(warns.length === 0, 'preview warnings: ' + warns.join(' | '));
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

const pileCount = async (page, name) => (await page.locator('.pt-pile-label', { hasText: name }).first().locator('b').innerText()).trim();
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

async function dragTo(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test('playtest: start, play by double-click and by dragging, tap, undo, piles on the table', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=playtest');
  await page.getByRole('button', { name: 'Start game' }).click();
  const hand = page.locator('.pt-hand .pt-card');
  await hand.nth(4).waitFor();
  assert((await hand.count()) === 5, 'opening hand of 5');
  assert((await pileCount(page, 'Deck')) === '26', 'deck has 26 left');
  assert((await page.locator('.pt-curtain').count()) === 0, 'no hand-off screen for one player');

  await hand.first().dblclick();
  const table = page.locator('.pt-board .pt-card');
  assert((await table.count()) === 1, 'double-click plays to the table');

  const src = await hand.first().boundingBox();
  const board = await page.locator('.pt-board').boundingBox();
  const target = { x: board.x + board.width * 0.3, y: board.y + board.height * 0.35 };
  await dragTo(page, { x: src.x + 30, y: src.y + 30 }, target);
  assert((await table.count()) === 2, 'drag plays to the table');
  assert(inside(target, await table.nth(1).boundingBox()), 'card lands where dropped');

  await table.first().hover();
  await page.keyboard.press('t');
  await until(() => table.first().evaluate((el) => el.classList.contains('tapped')), 'T taps the card');
  await page.keyboard.press('d');
  await until(async () => (await hand.count()) === 4, 'D draws');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await until(async () => (await hand.count()) === 3 && !(await table.first().evaluate((el) => el.classList.contains('tapped'))), 'undo reverts draw and tap');

  await table.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Discard/ }).click();
  assert((await pileCount(page, 'Discard')) === '1', 'discarded via menu');
  await page.getByRole('button', { name: 'Next turn' }).click();
  assert((await page.locator('.pt-turn').innerText()) === 'Turn 2', 'turn counter');
  assert((await hand.count()) === 4, 'next turn draws');

  const deck = page.locator('.pt-pile[aria-label^="Deck"]');
  await deck.click();
  assert((await hand.count()) === 5 && (await pileCount(page, 'Deck')) === '24', 'clicking the deck draws');

  const label = await page.locator('.pt-pile-label', { hasText: 'Deck' }).boundingBox();
  const before = await deck.boundingBox();
  await dragTo(page, { x: label.x + label.width / 2, y: label.y + label.height / 2 }, { x: board.x + board.width * 0.6, y: board.y + board.height * 0.3 });
  const after = await deck.boundingBox();
  assert(after.y < before.y - 50 && (await pileCount(page, 'Deck')) === '24', 'dragging the label moves the whole pile');

  await dragTo(page, { x: after.x + after.width / 2, y: after.y + 10 }, { x: board.x + board.width * 0.75, y: board.y + board.height * 0.35 });
  assert((await pileCount(page, 'Deck')) === '23', 'dragging the pile itself takes the top card');
  assert((await page.locator('.pt-board .pt-card[aria-label="face-down card"]').count()) === 1, 'a card from the face-down deck lands face down');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('playtest: build a deck in the deck editor and play with it', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=playtest');
  await page.getByRole('button', { name: 'New deck…' }).click();
  await page.locator('.deck-editor input.de-name').fill('Tiny');
  await page.locator('.de-card', { hasText: 'Ember Scout' }).click();
  await page.locator('.de-card', { hasText: 'Ember Scout' }).click();
  await page.locator('.de-card', { hasText: 'Tide Caller' }).click();
  assert((await page.locator('.de-total b').innerText()) === '3', 'three cards in the deck');
  await page.getByRole('button', { name: 'Use deck' }).click();
  assert((await page.getByLabel('Player 1 deck').locator('option:checked').innerText()).startsWith('Tiny'), 'new deck selected');
  await page.getByRole('button', { name: 'Start game' }).click();
  assert((await page.locator('.pt-hand .pt-card').count()) === 3, 'whole tiny deck drawn');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('playtest: two players take turns, hands stay hidden, a shared deck on the table', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=playtest');
  await page.getByRole('group', { name: 'Number of players' }).getByRole('button', { name: '2' }).click();
  await page.getByLabel('Player 1 name').fill('Ana');
  await page.getByLabel('Player 2 name').fill('Bea');
  assert((await page.getByLabel('Player 2 seat').inputValue()) === 'north', 'two players sit opposite');
  await page.getByRole('button', { name: 'Start game' }).click();

  await page.getByText('Pass the screen to Ana').waitFor();
  assert((await page.locator('.pt-card, .pt-pile').count()) === 0, 'no cards on screen before Ana is ready');
  await page.getByRole('button', { name: "Show Ana's hand" }).click();
  const hand = page.locator('.pt-hand .pt-card');
  await hand.nth(4).waitFor();
  assert((await page.locator('.pt-hand').getAttribute('aria-label')) === "Ana's hand", "Ana's hand is shown");
  await hand.first().dblclick();
  const table = page.locator('.pt-board .pt-card');
  assert((await table.first().getAttribute('style')).includes('rotate(0deg)'), "Ana's card faces her");

  await page.getByRole('button', { name: 'Next turn' }).click();
  await page.getByText('Pass the screen to Bea').waitFor();
  assert((await page.locator('.pt-card, .pt-pile').count()) === 0, 'every card hidden between turns');
  await page.getByRole('button', { name: "Show Bea's hand" }).click();
  await hand.nth(5).waitFor();
  assert((await hand.count()) === 6, 'Bea drew at the start of her turn');
  const log = await page.locator('.pt-log').innerText();
  assert(log.includes('Bea: Drew a card') && !/Drew (?!a card|\d)/.test(log), 'the log does not name drawn cards');

  await hand.first().dblclick();
  assert((await table.nth(1).getAttribute('style')).includes('rotate(180deg)'), "Bea's card faces her side of the table");

  const card = await hand.first().boundingBox();
  const seat = await page.locator('.pt-seat-south').boundingBox();
  await dragTo(page, { x: card.x + 30, y: card.y + 30 }, { x: seat.x + seat.width / 2, y: seat.y + 12 });
  assert((await hand.count()) === 4, "card left Bea's hand");
  assert((await page.locator('.pt-seat-south .pt-seat-hand b').innerText()) === '5', "dropping on Ana's panel gives her the card");

  const board = await page.locator('.pt-board').boundingBox();
  await page.mouse.click(board.x + board.width / 2, board.y + board.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Put a deck here…' }).click();
  await page.getByRole('button', { name: 'Put on the table' }).click();
  assert((await pileCount(page, 'Core Set')) === '31', 'shared deck on the table');
  await page.locator('.pt-pile[aria-label^="Core Set"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Deal one to each player' }).click();
  assert((await pileCount(page, 'Core Set')) === '29' && (await hand.count()) === 5, 'dealt one card to each player');

  await page.locator('.pt-seat-south').getByRole('button', { name: 'Show hand' }).click();
  await page.getByText('Pass the screen to Ana').waitFor();
  assert((await page.locator('.pt-curtain').innerText()).includes("Bea's turn"), "still Bea's turn while Ana looks");
  await page.getByRole('button', { name: "Show Ana's hand" }).click();
  assert((await hand.count()) === 6, "Ana's hand: 4 + the given card + the dealt card");
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('art framing: drag and scroll a card\'s picture in the preview, saved in an art.frame column', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await cell(page, 0, 1).waitFor();
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 300;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, '#d33');
    g.addColorStop(1, '#33d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 300, 300);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    let dir = await navigator.storage.getDirectory();
    for (const part of ['games', 'demo-game', 'assets', 'art']) dir = await dir.getDirectoryHandle(part, { create: true });
    const w = await (await dir.getFileHandle('grad.png', { create: true })).createWritable();
    await w.write(blob);
    await w.close();
  });
  const headers = (await page.locator('.grid thead th').allInnerTexts()).map((t) => t.trim().toLowerCase());
  const artCol = headers.findIndex((h) => h.startsWith('art')) - 1;
  assert(headers.findIndex((h) => h.startsWith('name')) - 1 === 1 && artCol > 1, 'grid headers: ' + headers.join(', '));
  await cell(page, 0, artCol).click();
  await page.keyboard.type('grad.png');
  await page.keyboard.press('Enter');
  assert((await cell(page, 0, artCol).innerText()) === 'grad.png', 'art cell set');
  await cell(page, 0, 1).click();
  await page.getByText('Art: drag to move it').waitFor();

  // The art box is [70, 140, 675, 480] in template px on an 815 × 1110 card (bleed shown).
  const canvas = page.locator('.preview-card canvas');
  const box = await canvas.boundingBox();
  const at = (tx, ty) => [box.x + (tx / 815) * box.width, box.y + (ty / 1110) * box.height];
  const [cx, cy] = at(70 + 337, 140 + 240);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(700);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 40, { steps: 5 });
  await page.mouse.up();

  await page.getByRole('button', { name: /Save \(\d+\)/ }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  const csv = (await readOpfs(page, 'games/demo-game/sets/core/cards.csv')).replace(/^﻿/, '').split('\r\n');
  const head = csv[0].split(',');
  const col = head.indexOf('art.frame');
  assert(col > 0, 'art.frame column written: ' + csv[0]);
  // The framing cell is three numbers separated by spaces (other cells may contain quoted commas).
  const frame = /,(\d[\d.]*) (\d[\d.]*) (\d[\d.]*)(?:,|$)/.exec(csv[1]);
  assert(frame, 'framing value in the first card: ' + csv[1]);
  const [zoom, fx, fy] = frame.slice(1).map(Number);
  assert(Math.abs(zoom - 1.21) < 0.01, 'two wheel steps zoom 1.21×: ' + zoom);
  assert(fx === 0.5 && fy > 0.5, `dragging up shows more of the bottom: ${fx} ${fy}`);
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('find and replace: change a word in many cards, undo in one step', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await cell(page, 0, 1).waitFor();
  await page.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: 'Find and replace…' }).click();
  await page.getByLabel('Find', { exact: true }).fill('Scout');
  await page.getByLabel('Replace with').fill('Ranger');
  await page.getByText(/\d+ matches in \d+ cards/).waitFor();
  await page.getByRole('button', { name: 'Replace all' }).click();
  assert((await cell(page, 0, 1).innerText()) === 'Ember Ranger', 'name replaced');
  await page.getByRole('button', { name: 'Undo' }).click();
  assert((await cell(page, 0, 1).innerText()) === 'Ember Scout', 'one undo restores every card');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('game settings: typographic punctuation is saved in game.json', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh&tab=game');
  await page.getByRole('checkbox', { name: /Typographic punctuation/ }).check();
  await page.getByRole('button', { name: /Save \(\d+\)/ }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  const game = JSON.parse(await readOpfs(page, 'games/demo-game/game.json'));
  assert(game.text?.smartPunctuation === true, 'text.smartPunctuation saved: ' + JSON.stringify(game.text));
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('preview: colour-blind view filters the preview only', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo');
  await page.getByLabel('Colour vision').selectOption('deutan');
  const filter = await page.locator('.preview-card canvas').evaluate((c) => getComputedStyle(c).filter);
  assert(filter.includes('cm-vision-deutan'), 'deuteranopia filter applied: ' + filter);
  assert((await page.locator('#cm-vision-deutan feColorMatrix').count()) >= 1, 'filter defined');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('export: gallery page with every card in one HTML file', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh&tab=export');
  await page.locator('.export-kind', { hasText: 'Gallery page' }).click();
  await page.getByRole('button', { name: 'Create gallery' }).click();
  await page.locator('.export-result').waitFor({ timeout: 60000 });
  const msg = await page.locator('.export-result p').first().innerText();
  const n = Number(/Gallery of (\d+) cards/.exec(msg)?.[1]);
  assert(n > 5, 'gallery message: ' + msg);
  const file = (await listOpfs(page, 'games/demo-game/export')).find((f) => f.name.endsWith('.html'));
  assert(file, 'gallery file in export/');
  const html = await readOpfs(page, `games/demo-game/export/${file.name}`);
  assert((html.match(/<figure /g) ?? []).length === n, 'one figure per card');
  assert((html.match(/src="data:image\/jpeg;base64,/g) ?? []).length === n, 'pictures are inside the file');
  assert(html.includes('Ember Scout'), 'card names listed');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('playtest: draw odds in the deck editor', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=playtest');
  await page.getByRole('button', { name: 'New deck…' }).click();
  for (const name of ['Ember Scout', 'Ember Scout', 'Tide Caller', 'Cinder Hound', 'Cinder Hound', 'Cinder Hound']) await page.locator('.de-card', { hasText: name }).click();
  await page.locator('.deck-odds summary').click();
  await page.getByLabel('Cards that count').fill('Ember Scout');
  assert(/2 of the 6 cards count/.test(await page.locator('.deck-odds').innerText()), 'counts the matching copies');
  // Hand of 5 from 6 cards with 2 Ember Scouts: 1 - C(4,5)/C(6,5) = 100 % (only 4 others).
  const chance = await page.locator('.odds-table tbody tr').nth(1).locator('td').first().innerText();
  assert(chance === '100%', 'turn 1 chance: ' + chance);
  await page.getByLabel('At least').fill('2');
  const two = await page.locator('.odds-table tbody tr').nth(1).locator('td').first().innerText();
  assert(two === '67%', 'at least 2 by turn 1 (4 of the 6 possible hands): ' + two);
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('print check: the demo\'s tiny collector number is found, in the preview and in the Export tab', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo');
  await page.getByRole('checkbox', { name: /print check/ }).check();
  const list = page.locator('.print-issues');
  await list.waitFor();
  assert(/number.*Text is 4\.8 pt/.test(await list.innerText()), 'collector number flagged: ' + (await list.innerText()));
  assert((await page.locator('.issue-marks rect').count()) > 0, 'problems marked on the card');
  await page.locator('.tab', { hasText: 'Export' }).click();
  await page.getByRole('button', { name: /Check \d+ cards for print/ }).click();
  await page.locator('.pc-results').waitFor({ timeout: 60000 });
  assert(/warning\(s\) on \d+ card face\(s\)/.test(await page.locator('.pc-results p').first().innerText()), 'summary shown');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('stress test: a too-long rules text breaks the unit template and is marked', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await cell(page, 0, 1).waitFor();
  await cell(page, 0, 7).click();
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Deal 3 damage to each enemy unit. '.repeat(40));
  await page.keyboard.press('Enter');
  await page.locator('.tab', { hasText: 'Templates' }).click();
  await page.locator('.tpl-list li', { hasText: /^Unit/ }).click();
  await page.getByRole('button', { name: 'Stress test' }).click();
  await page.getByText(/break the layout|All \d+ fit/).waitFor({ timeout: 60000 });
  assert(/\d+ of \d+ break the layout/.test(await page.locator('.stress-test').innerText()), 'some cards break');
  const bad = await page.locator('.stress-grid figure.bad figcaption').allInnerTexts();
  assert(bad.some((t) => t.startsWith('Longest rules') && /rules/.test(t)), 'longest rules case is marked: ' + bad.join(' | '));
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('playtest rounds: snapshot, change a card, see and export only the changed card', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh&tab=playtest');
  await page.locator('.pt-toolbar').getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: 'Playtest rounds…' }).click();
  await page.getByLabel('Snapshot name').fill('Friday');
  await page.getByRole('button', { name: 'Take snapshot' }).click();
  await page.getByText('Nothing changed since “Friday”').waitFor();
  assert((await listOpfs(page, 'games/demo-game/playtests/friday')).some((f) => f.name === 'sets/core/cards.csv'), 'snapshot files written');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.locator('.tab', { hasText: 'Cards' }).click();
  await cell(page, 0, 3).click();
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Save \(\d+\)/ }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();

  await page.locator('.tab', { hasText: 'Playtest' }).click();
  await page.locator('.pt-toolbar').getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: 'Playtest rounds…' }).click();
  await page.getByText('1 card(s) to reprint').waitFor();
  assert(/cost\s*1\s*→\s*4/.test(await page.locator('.rounds-list').innerText()), 'cost change listed');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.locator('.tab', { hasText: 'Export' }).click();
  await page.locator('.stats-filters select').first().selectOption({ label: 'Changed since Friday' });
  await page.getByRole('button', { name: 'Check 1 cards for print' }).waitFor();
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('feedback: a playtester rates cards in the gallery, the file comes back into Cardinal', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh&tab=export');
  await page.locator('.export-kind', { hasText: 'Gallery page' }).click();
  await page.getByRole('button', { name: 'Create gallery' }).click();
  await page.locator('.export-result').waitFor({ timeout: 60000 });
  const file = (await listOpfs(page, 'games/demo-game/export')).find((f) => f.name.endsWith('.html'));
  const html = await readOpfs(page, `games/demo-game/export/${file.name}`);

  const tester = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await tester.setContent(html);
  const scout = tester.locator('figure', { hasText: 'Ember Scout' });
  await scout.getByRole('button', { name: 'Too strong' }).click();
  await scout.getByRole('button', { name: 'Fun' }).click();
  await scout.locator('textarea').fill('Wins every race');
  await tester.locator('figure', { hasText: 'Tide Caller' }).getByRole('button', { name: 'Confusing' }).click();
  assert((await scout.getByRole('button', { name: 'Too strong' }).getAttribute('aria-pressed')) === 'true', 'vote shows as pressed');
  await tester.getByLabel('Your name').fill('Budi');
  const [dl] = await Promise.all([tester.waitForEvent('download'), tester.getByRole('button', { name: 'Send feedback' }).click()]);
  const sent = readFileSync(await dl.path(), 'utf8');
  assert(dl.suggestedFilename().startsWith('feedback-budi-'), 'file name: ' + dl.suggestedFilename());

  await page.locator('.tab', { hasText: 'Playtest' }).click();
  await page.locator('.pt-toolbar').getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: 'Feedback…' }).click();
  await page.locator('.feedback-view input[type=file]').setInputFiles({ name: dl.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(sent) });
  await page.getByText('1 playtester(s), 2 card(s) rated.').waitFor();
  const row = page.locator('.feedback-table tr', { hasText: 'Ember Scout' });
  assert(/Budi: Wins every race/.test(await row.innerText()), 'note shown');
  assert((await row.locator('td.hot').count()) === 1, 'too strong is highlighted');
  assert((await listOpfs(page, 'games/demo-game/feedback')).some((f) => f.name.startsWith('feedback-budi')), 'file kept in feedback/');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('balance: the demo set is fitted and the outliers are listed', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=stats');
  const bal = page.locator('.balance');
  await bal.waitFor();
  assert(/explains \d+% of the cost differences across 14 cards/.test(await bal.innerText()), 'fit summary: ' + (await bal.innerText()).slice(0, 300));
  assert((await bal.locator('.balance-off li').count()) > 0, 'some cards stand out');
  assert((await bal.locator('.balance-scatter circle').count()) === 14, 'one dot per card');
  await bal.getByRole('radio', { name: 'My value formula' }).check();
  await bal.getByLabel('Value formula', { exact: true }).fill('attack + health');
  assert(/explains \d+%/.test(await bal.innerText()), 'formula mode fits too');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('wording: a misspelled keyword is found and the card can be opened from the list', async (browser) => {
  const { page, errors } = await newPage(browser, '?opfs&fresh');
  await cell(page, 0, 1).waitFor();
  await cell(page, 4, 7).click();
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Sheild 2');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.grid td')].some((td) => td.textContent === 'Sheild 2'));
  await page.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: 'Wording check…' }).click();
  const dlg = page.locator('.wording');
  assert(/“Sheild” looks like a misspelling of the keyword “Shield”/.test(await dlg.innerText()), 'typo found: ' + (await dlg.innerText()));
  await dlg.locator('.wording-cards button').first().click();
  assert(await cell(page, 4, 1).evaluate((td) => td.closest('tr').classList.contains('focus-row')), 'jumped to the card');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('colour check: the demo elements that look alike are listed in Game settings', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=game');
  const sec = page.locator('.game-section', { hasText: 'Colour check' });
  await sec.waitFor();
  const text = await sec.innerText();
  assert(/Fire and Earth \(element\) look alike/.test(text) && /Deuteranopia/.test(text), 'red/green clash found: ' + text);
  assert((await sec.locator('.swatch').count()) >= 2, 'swatches shown');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('print cost: prices compare layouts and remember themselves', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo&tab=export');
  await page.locator('.export-kind', { hasText: 'Print PDF' }).click();
  await page.locator('.cost-planner summary').click();
  await page.getByLabel('A4 sheet').fill('2000');
  await page.getByLabel('A3 sheet').fill('3500');
  const table = page.locator('.cost-table');
  await table.waitFor();
  assert((await table.locator('tbody tr').count()) >= 3, 'several layouts compared');
  assert((await table.locator('tr.best').count()) === 1, 'cheapest marked');
  await page.reload();
  await page.locator('.export-kind', { hasText: 'Print PDF' }).click();
  await page.locator('.cost-planner summary').click();
  assert((await page.getByLabel('A4 sheet').inputValue()) === '2000', 'prices remembered');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('command bar: Ctrl+K finds and runs actions from any tab; the sidebar hides and comes back', async (browser) => {
  const { page, errors } = await newPage(browser, '?demo');
  await cell(page, 0, 1).waitFor();
  await page.keyboard.press('Control+k');
  const bar = page.getByRole('dialog', { name: 'Command bar' });
  await bar.waitFor();
  await page.keyboard.type('wording');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Wording check' }).waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('go templates');
  await page.keyboard.press('Enter');
  await page.locator('.tab.active', { hasText: 'Templates' }).waitFor();
  await page.getByRole('button', { name: 'Stress test' }).waitFor();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('stress');
  assert((await bar.locator('li.on').innerText()).includes('Stress test'), 'the templates tab adds its own commands');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Stress test' }).waitFor();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('Alt+1');
  await page.locator('.tab.active', { hasText: 'Cards' }).waitFor();
  await page.keyboard.press('Control+Backslash');
  assert(!(await page.locator('.sidebar').isVisible()), 'sidebar hidden');
  await page.getByRole('button', { name: 'Games and sets' }).click();
  assert(await page.locator('.sidebar').isVisible(), 'sidebar back');
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

test('server folders: copy the demo into a folder, edit, save, reopen', async (browser) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cm-e2e-'));
  try {
    const { page, errors } = await newPage(browser, '?bridge');
    await page.getByRole('button', { name: 'Try the demo' }).click();
    await page.getByRole('button', { name: 'Copy demo to a folder…' }).click();
    await page.locator('.fp-list li').first().waitFor();
    await page.locator('.fp-path input').fill(`"${dir}"`);
    await page.locator('.fp-path').getByRole('button', { name: 'Go' }).click();
    await page.getByRole('button', { name: /^Copy into/ }).click();
    await page.locator('.toast', { hasText: 'Copied' }).waitFor();
    const csv = path.join(dir, 'games', 'demo-game', 'sets', 'core', 'cards.csv');
    assert(readFileSync(csv, 'utf8').includes('Ember Scout'), 'demo copied to disk');

    await cell(page, 0, 1).click();
    await page.keyboard.type('Ember Scout II');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /Save \(\d+\)/ }).click();
    await page.getByRole('button', { name: 'Saved' }).waitFor();
    assert(readFileSync(csv, 'utf8').includes('Ember Scout II'), 'saved to disk');
    assert(existsSync(csv + '.bak'), '.bak written');

    const p2 = await page.context().newPage();
    await p2.goto(BASE + '?bridge');
    await p2.getByRole('button', { name: /Continue with/ }).click();
    await p2.locator('.set', { hasText: 'Core Set' }).waitFor();
    assert((await p2.locator('td[data-pos="0:1"]').innerText()) === 'Ember Scout II', 'reopened folder shows the saved edit');

    await page.goto(BASE + '?bridge&demo');
    await page.getByRole('button', { name: 'Copy demo to a folder…' }).click();
    await page.locator('.fp-list li').first().waitFor();
    await page.locator('.fp-path input').fill(dir);
    await page.locator('.fp-path').getByRole('button', { name: 'Go' }).click();
    await page.getByRole('button', { name: /^Copy into/ }).click();
    await page.locator('.toast', { hasText: 'Cardinal demo' }).waitFor();
    assert(existsSync(path.join(dir, 'Cardinal demo', 'games', 'demo-game', 'game.json')), 'demo copied into a subfolder');
    assert(readFileSync(csv, 'utf8').includes('Ember Scout II'), 'existing files untouched');
    assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));

test('golden images: every demo card face matches its reference picture', async (browser) => {
  const browserName = ['firefox', 'webkit'].includes(process.env.CM_BROWSER) ? process.env.CM_BROWSER : 'edge';
  const goldenDir = path.join(E2E_DIR, 'golden', browserName);
  const outDir = path.join(E2E_DIR, 'output', browserName);
  const update = process.env.CM_UPDATE_GOLDEN === '1';
  const { page, errors } = await newPage(browser, '?sheet&golden');
  await page.locator('text=Golden-image test hook ready.').waitFor({ timeout: 60000 });
  const names = await page.evaluate(() => window.cmGolden.list());
  assert(names.length >= 14, 'faces to check: ' + names.join(', '));
  const fileOf = (dir, name, suffix = '') => path.join(dir, name.replace(/[^a-z0-9_-]+/gi, '-') + suffix + '.png');
  const dataUrl = (file) => 'data:image/png;base64,' + readFileSync(file).toString('base64');
  const toFile = (file, url) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  };
  const created = [];
  const failures = [];
  for (const name of names) {
    const ref = fileOf(goldenDir, name);
    if (update || !existsSync(ref)) {
      const r = await page.evaluate((n) => window.cmGolden.render(n), name);
      // Shown, not failed: the demo has a deliberate typo icon ([firre]) to show the red warning text.
      if (r.warnings.length) console.log(`      (${name}: ${r.warnings.join('; ')})`);
      toFile(ref, r.png);
      created.push(name);
      continue;
    }
    const r = await page.evaluate(([n, png]) => window.cmGolden.compare(n, png), [name, dataUrl(ref)]);
    if (r.ok) continue;
    failures.push(`${name}: ${r.message}`);
    if (r.actual) toFile(fileOf(outDir, name, '.actual'), r.actual);
    if (r.diff) toFile(fileOf(outDir, name, '.diff'), r.diff);
  }
  if (created.length) console.log(`      (${update ? 'rewrote' : 'created'} ${created.length} reference pictures in ${path.relative(process.cwd(), goldenDir)})`);
  assert(failures.length === 0, `${failures.length} card face(s) look different (pictures in ${path.relative(process.cwd(), outDir)}):\n` + failures.join('\n'));
  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
});

const engine = { firefox, webkit }[process.env.CM_BROWSER];
const browser = engine ? await engine.launch({ headless: true }) : await chromium.launch({ channel: 'msedge', headless: true });
console.log(`Browser: ${{ firefox: 'Firefox', webkit: 'WebKit (Safari engine)' }[process.env.CM_BROWSER] ?? 'Edge'}`);
const only = process.env.CM_ONLY;
const chosen = only ? tests.filter((t) => t.name.includes(only)) : tests;
// CM_REPEAT=n runs the chosen tests n times, to catch flaky ones.
const rounds = Math.max(1, Number(process.env.CM_REPEAT) || 1);
const failures = [];
let skipped = 0;
for (let round = 1; round <= rounds; round++) {
  if (rounds > 1) console.log(`Round ${round} of ${rounds}`);
  for (const t of chosen) {
    const started = Date.now();
    try {
      await t.fn(browser);
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      if (e instanceof Skip) {
        skipped++;
        console.log(`  – ${t.name} (skipped: ${e.message})`);
      } else {
        failures.push({ name: t.name, round, message: e.message.split('\n')[0], ms: Date.now() - started });
        console.log(`  ✗ ${t.name}\n      ${e.message.split('\n').join('\n      ')}`);
      }
    }
    for (const c of browser.contexts()) await c.close().catch(() => {});
  }
}
await browser.close();
const runs = chosen.length * rounds - skipped;
if (skipped) console.log(`\n${skipped} skipped in this browser`);
if (failures.length) {
  console.log(`\n${failures.length} of ${runs} failed:`);
  for (const f of failures) console.log(`  ✗ ${f.name}${rounds > 1 ? ` (round ${f.round})` : ''} after ${(f.ms / 1000).toFixed(1)} s: ${f.message}`);
} else {
  console.log(`\nall ${runs} passed`);
}
process.exit(failures.length ? 1 : 0);
