import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { colName, readXlsx, writeXlsx } from './xlsx';

describe('xlsx', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('round-trips text, numbers, line breaks and special characters', () => {
    const rows = [
      ['id', 'name', 'cost', 'rules'],
      ['c1', 'Fish & <Chips>', '3', 'Line 1\nLine "2"'],
      ['c2', '', '0.5', ''],
      ['007', 'leading zero stays text', '', 'ünïcødé ✓'],
    ];
    expect(readXlsx(writeXlsx(rows))).toEqual([
      ['id', 'name', 'cost', 'rules'],
      ['c1', 'Fish & <Chips>', '3', 'Line 1\nLine "2"'],
      ['c2', '', '0.5'],
      ['007', 'leading zero stays text', '', 'ünïcødé ✓'],
    ]);
  });

  it('reads shared strings, rich text, booleans and float noise as Excel writes them', () => {
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const zip = zipSync({
      'xl/workbook.xml': strToU8(`<workbook xmlns="${ns}" xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId7"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(`<Relationships><Relationship Id="rId7" Type="t" Target="worksheets/data.xml"/></Relationships>`),
      'xl/sharedStrings.xml': strToU8(`<sst><si><t>name</t></si><si><r><t>Bold</t></r><r><t xml:space="preserve"> part</t></r></si><si><t>a&amp;b</t></si></sst>`),
      'xl/worksheets/data.xml': strToU8(
        `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row>` +
          `<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="b"><v>1</v></c><c r="C3"><v>0.10000000000000001</v></c></row></sheetData></worksheet>`,
      ),
    });
    expect(readXlsx(zip)).toEqual([['name', '', 'a&b'], [], ['Bold part', 'TRUE', '0.1']]);
  });

  it('rejects files that are not xlsx', () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow(/not a valid/);
  });
});
