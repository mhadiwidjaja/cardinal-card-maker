import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters not allowed in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const unesc = (s: string) =>
  s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function writeXlsx(rows: string[][], sheetName = 'Cards'): Uint8Array {
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (v === '') return '';
          if (r > 0 && /^-?\d+(\.\d+)?$/.test(v) && v.length < 15 && !/^-?0\d/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const ns = 'http://schemas.openxmlformats.org';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  };
  return zipSync(files);
}

export function readXlsx(data: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('This is not a valid .xlsx file');
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : null);

  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  const firstSheet = wb && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  if (firstSheet && rels) {
    const target = new RegExp(`<Relationship\\b[^>]*Id="${firstSheet}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstSheet}"`).exec(rels)?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new Error('The workbook has no worksheet');

  const shared: string[] = [];
  const sst = text('xl/sharedStrings.xml');
  if (sst) {
    for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      // Rich text has several <t> runs; phonetic hints (<rPh>) are skipped.
      const body = si[1]!.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
      shared.push([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1]!)).join(''));
    }
  }

  const rows: string[][] = [];
  for (const rowM of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const attrs = rowM[1] ?? rowM[3] ?? '';
    const rIdx = Number(/\br="(\d+)"/.exec(attrs)?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    for (const c of (rowM[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1]!;
      const body = c[2] ?? '';
      const ref = /\br="([A-Z]+)\d*"/i.exec(a)?.[1];
      const col = ref ? colIndex(ref) : row.length;
      const type = /\bt="([^"]+)"/.exec(a)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1]!)).join('');
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = type === 'n' ? normalizeNumber(v) : unesc(v);
      while (row.length < col) row.push('');
      row[col] = value;
    }
    while (rows.length < rIdx) rows.push([]);
    rows[rIdx] = row;
  }
  while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
  return rows;
}

/** Excel stores 0.1 as 0.10000000000000001; show the short form. */
function normalizeNumber(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return String(Number(n.toPrecision(15)));
}
