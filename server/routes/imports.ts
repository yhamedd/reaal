import { Router } from 'express';
import multer from 'multer';
import { all, get, run } from '../db.js';
import { HttpError, requirePermission } from '../auth.js';
import { intParam } from '../util.js';
import { executeImport, fieldsFor, suggestMapping, validateRows, type DuplicatePolicy, type ImportKind, type ImportOptions, type RowResult } from '../services/importer.js';
import { buildXlsx, parseSpreadsheet } from '../services/spreadsheet.js';
import { logActivity } from '../activity.js';

export const importsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const MAX_ROWS = 20000;

const kindOf = (v: unknown): ImportKind => (v === 'owners' ? 'owners' : 'inventory');

importsRouter.get('/', requirePermission('imports.run'), (req, res) => {
  const rows = all<any>(
    req.db,
    `SELECT i.id, i.filename, i.kind, i.status, i.summary, i.result, i.created_at, i.completed_at, u.name AS user_name
       FROM imports i LEFT JOIN users u ON u.id = i.user_id ORDER BY i.created_at DESC, i.id DESC LIMIT 100`,
  );
  res.json(rows.map((r) => ({ ...r, summary: r.summary ? JSON.parse(r.summary) : null, result: r.result ? JSON.parse(r.result) : null })));
});

importsRouter.get('/fields', requirePermission('imports.run'), (req, res) => {
  res.json(fieldsFor(kindOf(req.query.kind)).map(({ key, label, required, type }) => ({ key, label, required, type })));
});

importsRouter.get('/template', requirePermission('imports.run'), async (req, res) => {
  const kind = kindOf(req.query.kind);
  const fields = fieldsFor(kind);
  const buf = await buildXlsx('Template', fields.map((f) => ({ key: f.key, header: f.label.replace(/ \(.*\)$/, '') })), []);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}-import-template.xlsx"`);
  res.send(buf);
});

importsRouter.post('/', requirePermission('imports.run'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Choose a file to upload');
  if (!/\.(xlsx|csv)$/i.test(file.originalname)) throw new HttpError(400, 'Upload an .xlsx or .csv file');
  const kind = kindOf(req.body?.kind);
  let parsed;
  try {
    parsed = await parseSpreadsheet(file.buffer, file.originalname);
  } catch (e: any) {
    throw new HttpError(400, `Could not read the file: ${e?.message ?? 'unknown error'}`);
  }
  if (!parsed.headers.length || !parsed.rows.length) throw new HttpError(400, 'The file has no data rows');
  if (parsed.rows.length > MAX_ROWS) throw new HttpError(400, `The file has ${parsed.rows.length} rows; the limit per import is ${MAX_ROWS}. Split it into smaller files.`);
  const mapping = suggestMapping(parsed.headers, kind);
  const { lastId } = run(req.db, 'INSERT INTO imports (user_id, filename, kind, headers, rows, mapping) VALUES (?, ?, ?, ?, ?, ?)', [
    req.user!.id,
    file.originalname.slice(0, 200),
    kind,
    JSON.stringify(parsed.headers),
    JSON.stringify(parsed.rows),
    JSON.stringify(mapping),
  ]);
  res.status(201).json({ id: lastId, kind, filename: file.originalname, headers: parsed.headers, total: parsed.rows.length, preview: parsed.rows.slice(0, 25), mapping, fields: fieldsFor(kind) });
});

function loadImport(db: import('../db.js').DB, id: number) {
  const imp = get<any>(db, 'SELECT * FROM imports WHERE id = ?', [id]);
  if (!imp) throw new HttpError(404, 'Import not found');
  return imp;
}

importsRouter.get('/:id', requirePermission('imports.run'), (req, res) => {
  const imp = loadImport(req.db, intParam(req.params.id));
  const rows = JSON.parse(imp.rows);
  res.json({
    id: imp.id,
    kind: imp.kind,
    filename: imp.filename,
    status: imp.status,
    headers: JSON.parse(imp.headers),
    total: rows.length,
    preview: rows.slice(0, 25),
    mapping: imp.mapping ? JSON.parse(imp.mapping) : {},
    options: imp.options ? JSON.parse(imp.options) : {},
    summary: imp.summary ? JSON.parse(imp.summary) : null,
    result: imp.result ? JSON.parse(imp.result) : null,
    fields: fieldsFor(imp.kind),
  });
});

function runValidation(db: import('../db.js').DB, imp: any, mapping: Record<string, string>, options: ImportOptions) {
  const headers: string[] = JSON.parse(imp.headers);
  const rows = JSON.parse(imp.rows);
  return validateRows(db, imp.kind, headers, rows, mapping, options);
}

function cleanOptions(v: unknown): ImportOptions {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 120) : null);
  return { developer: str(o.developer), location: str(o.location), status: str(o.status) };
}

importsRouter.post('/:id/validate', requirePermission('imports.run'), (req, res) => {
  const db = req.db;
  const imp = loadImport(db, intParam(req.params.id));
  if (imp.status === 'completed') throw new HttpError(400, 'This import has already been completed');
  const mapping: Record<string, string> = req.body?.mapping && typeof req.body.mapping === 'object' ? req.body.mapping : JSON.parse(imp.mapping || '{}');
  // A target field may only be mapped once
  const seen = new Set<string>();
  for (const [h, t] of Object.entries(mapping)) {
    if (!t) continue;
    if (seen.has(t)) throw new HttpError(400, `“${t}” is mapped from more than one column`);
    seen.add(t);
    if (!JSON.parse(imp.headers).includes(h)) delete mapping[h];
  }
  const options = cleanOptions(req.body?.options);
  const { summary, results } = runValidation(db, imp, mapping, options);
  run(db, "UPDATE imports SET mapping = ?, options = ?, summary = ?, status = 'validated' WHERE id = ?", [JSON.stringify(mapping), JSON.stringify(options), JSON.stringify(summary), imp.id]);
  const problems = results.filter((r) => r.status !== 'ready' || r.warnings.length);
  res.json({ summary, rows: problems.slice(0, 1000), ready_sample: results.filter((r) => r.status === 'ready').slice(0, 10) });
});

importsRouter.post('/:id/confirm', requirePermission('imports.run'), (req, res) => {
  const db = req.db;
  const imp = loadImport(db, intParam(req.params.id));
  if (imp.status === 'completed') throw new HttpError(400, 'This import has already been completed');
  if (imp.status !== 'validated') throw new HttpError(400, 'Validate the import before confirming');
  const policy: DuplicatePolicy = ['skip', 'create', 'update'].includes(req.body?.duplicates) ? req.body.duplicates : 'skip';
  const mapping = JSON.parse(imp.mapping || '{}');
  // Validate again so the import reflects the database at confirmation time.
  const { summary, results } = runValidation(db, imp, mapping, cleanOptions(JSON.parse(imp.options || '{}')));
  if (summary.missing_required.length) throw new HttpError(400, `Map the required columns first: ${summary.missing_required.join(', ')}`);
  const counts = executeImport(db, req.user!, imp.id, imp.kind, results as RowResult[], policy, imp.filename);
  run(db, 'UPDATE imports SET summary = ? WHERE id = ?', [JSON.stringify(summary), imp.id]);
  res.json({ ok: true, result: counts, summary });
});

importsRouter.delete('/:id', requirePermission('imports.run'), (req, res) => {
  const db = req.db;
  const imp = loadImport(db, intParam(req.params.id));
  if (imp.status === 'completed') throw new HttpError(400, 'Completed imports stay in the history');
  run(db, 'DELETE FROM imports WHERE id = ?', [imp.id]);
  logActivity(db, { userId: req.user!.id, action: 'import_cancelled', entityType: 'import', entityId: imp.id, label: imp.filename, message: `cancelled the import of ${imp.filename}` });
  res.json({ ok: true });
});
