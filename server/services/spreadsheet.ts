import ExcelJS from 'exceljs';
import Papa from 'papaparse';

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('hyperlink' in v) return String((v as any).text ?? v.hyperlink);
    if ('error' in v) return '';
  }
  return String(v);
}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = (h || '').trim() || `Column ${i + 1}`;
    const n = seen.get(name.toLowerCase()) ?? 0;
    seen.set(name.toLowerCase(), n + 1);
    if (n) name = `${name} (${n + 1})`;
    return name;
  });
}

export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    const [head = [], ...body] = parsed.data;
    const headers = uniqueHeaders(head.map(String));
    return {
      headers,
      rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()]))),
    };
  }
  if (!lower.endsWith('.xlsx')) throw new Error('Upload an .xlsx or .csv file');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) return { headers: [], rows: [] };
  // Header = first non-empty row
  let headerRowNo = 1;
  while (headerRowNo <= ws.rowCount && ws.getRow(headerRowNo).actualCellCount === 0) headerRowNo++;
  const headerRow = ws.getRow(headerRowNo);
  const colCount = Math.max(ws.columnCount, headerRow.cellCount);
  const rawHeaders: string[] = [];
  for (let c = 1; c <= colCount; c++) rawHeaders.push(cellText(headerRow.getCell(c).value).trim());
  while (rawHeaders.length && !rawHeaders[rawHeaders.length - 1]) rawHeaders.pop();
  const headers = uniqueHeaders(rawHeaders);
  const rows: Record<string, string>[] = [];
  for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.actualCellCount === 0) continue;
    const obj: Record<string, string> = {};
    let any = false;
    headers.forEach((h, i) => {
      const v = cellText(row.getCell(i + 1).value).trim();
      if (v) any = true;
      obj[h] = v;
    });
    if (any) rows.push(obj);
  }
  return { headers, rows };
}

export interface ExportColumn {
  key: string;
  header: string;
  width?: number;
  type?: 'number' | 'money' | 'date' | 'text';
}

/** Neutralises spreadsheet formula injection ("=HYPERLINK(...)") in exported text cells. */
export function safeCell(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  if (/^[=@\t\r]/.test(v) || /^[+-][^\d\s]/.test(v)) return `'${v}`;
  return v;
}

export async function buildXlsx(sheetName: string, columns: ExportColumn[], rows: Record<string, any>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F7' } };
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c.key, safeCell(r[c.key] ?? null)])));
  columns.forEach((c, i) => {
    if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##0';
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function buildCsv(columns: ExportColumn[], rows: Record<string, any>[]): string {
  const data = rows.map((r) => columns.map((c) => safeCell(r[c.key] ?? '')));
  // BOM so Excel opens UTF-8 (Arabic names) correctly
  return '﻿' + Papa.unparse({ fields: columns.map((c) => c.header), data });
}
