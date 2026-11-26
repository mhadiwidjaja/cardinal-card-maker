import Papa from 'papaparse';

export interface CsvTable {
  columns: string[];
  rows: Record<string, string>[];
  errors: { row: number; message: string }[];
}

export function parseCsv(text: string): CsvTable {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy' });
  const [header = [], ...data] = result.data;
  const columns = header.map((c) => c.trim());

  const errors = result.errors.map((e) => ({ row: (e.row ?? 0) + 1, message: e.message }));
  const seen = new Set<string>();
  columns.forEach((c, i) => {
    if (c === '') errors.push({ row: 1, message: `Column ${i + 1} has no name` });
    else if (seen.has(c)) errors.push({ row: 1, message: `Duplicate column "${c}"` });
    seen.add(c);
  });

  const rows = data.map((cells, i) => {
    if (cells.length !== columns.length) {
      errors.push({ row: i + 2, message: `Has ${cells.length} cells but the header has ${columns.length} columns` });
    }
    const row: Record<string, string> = {};
    columns.forEach((c, i) => {
      if (c !== '' && !(c in row)) row[c] = cells[i] ?? '';
    });
    return row;
  });
  return { columns, rows, errors };
}

/** The UTF-8 byte order mark. Excel needs it to read a CSV as UTF-8 instead of the Windows code page. */
export const BOM = String.fromCharCode(0xfeff);

/**
 * Turns the bytes of a CSV file into text. Files that are not valid UTF-8 were
 * almost always saved by Excel as plain "CSV", which uses the Windows code
 * page, so they are read as windows-1252 instead of showing as garbage.
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/**
 * Serializes rows back to CSV. CRLF line endings and a BOM at the start, so
 * Excel on Windows shows accented letters and symbols correctly.
 */
export function toCsv(columns: string[], rows: Record<string, string>[]): string {
  return BOM + Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? '')) }, { newline: '\r\n' }) + '\r\n';
}
