import { Router } from 'express';
import multer from 'multer';
import { all, get, run, type DB } from '../db.js';
import { HttpError, can, requireAuth } from '../auth.js';
import { intParam } from '../util.js';
import { config } from '../config.js';
import { storage } from '../storage.js';
import { FILE_CATEGORIES } from '../../shared/constants.js';
import { logActivity, unitLabel } from '../activity.js';

export const filesRouter = Router();

const ALLOWED_MIME = /^(image\/(png|jpe?g|webp|gif)|application\/pdf|application\/vnd\.openxmlformats-officedocument\..+|application\/msword|application\/vnd\.ms-excel|text\/plain|text\/csv)$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.test(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, `Unsupported file type: ${file.originalname}`));
  },
});

const ENTITY_PERMS: Record<string, { view: string; edit: string }> = {
  unit: { view: 'inventory.view', edit: 'inventory.edit' },
  owner: { view: 'owners.view', edit: 'owners.edit' },
  requirement: { view: 'requirements.view', edit: 'requirements.manage' },
  company: { view: '', edit: 'settings.manage' },
};

export function assertEntityAccess(req: Express.Request, entityType: string, mode: 'view' | 'edit') {
  const perms = ENTITY_PERMS[entityType];
  if (!perms) throw new HttpError(400, 'Unknown record type');
  const needed = perms[mode];
  if (needed && !can(req.user, needed)) throw new HttpError(403, "You don't have permission to do this");
}

export async function deleteEntityFiles(db: DB, entityType: string, entityId: number) {
  const files = await all<any>(db, 'SELECT * FROM files WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
  for (const f of files) await storage().del(f.stored_name).catch(() => undefined);
  await run(db, 'DELETE FROM files WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
}

/** Loads a stored file's bytes (from disk or Supabase Storage). */
export function readStored(stored: string) {
  return storage().get(stored);
}

filesRouter.get('/', requireAuth, async (req, res) => {
  const entityType = String(req.query.entity_type ?? '');
  const entityId = intParam(req.query.entity_id, 'entity_id');
  assertEntityAccess(req, entityType, 'view');
  res.json(
    await all(req.db, 'SELECT f.*, u.name AS uploaded_by_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE entity_type = ? AND entity_id = ? ORDER BY created_at', [entityType, entityId]),
  );
});

filesRouter.post('/', requireAuth, upload.array('files', 20), async (req, res) => {
  const db = req.db;
  const entityType = String(req.body?.entity_type ?? '');
  const entityId = intParam(req.body?.entity_id, 'entity_id');
  const files = (req.files as Express.Multer.File[]) ?? [];
  assertEntityAccess(req, entityType, 'edit');
  let category = String(req.body?.category ?? 'document');
  if (!(FILE_CATEGORIES as readonly string[]).includes(category) && category !== 'logo') category = 'document';
  if (!files.length) throw new HttpError(400, 'Choose at least one file');
  const ids: number[] = [];
  for (const f of files) {
    const stored = await storage().put(f.originalname, f.buffer, f.mimetype);
    const { lastId } = await run(
      db,
      'INSERT INTO files (entity_type, entity_id, category, original_name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [entityType, entityId, category, f.originalname.slice(0, 200), stored, f.mimetype, f.size, req.user!.id],
    );
    ids.push(lastId);
  }
  if (entityType !== 'company') {
    const label = entityType === 'unit' ? await unitLabel(db, entityId) : `${entityType} #${entityId}`;
    await logActivity(db, { userId: req.user!.id, action: 'files_added', entityType, entityId, label, message: `uploaded ${files.length} file${files.length === 1 ? '' : 's'} to ${label}` });
  }
  res.status(201).json({ ids });
});

filesRouter.get('/:id', requireAuth, async (req, res) => {
  const f = await get<any>(req.db, 'SELECT * FROM files WHERE id = ?', [intParam(req.params.id)]);
  if (!f) throw new HttpError(404, 'File not found');
  assertEntityAccess(req, f.entity_type, 'view');
  const data = await readStored(f.stored_name);
  if (!data) throw new HttpError(404, 'File is missing from storage');
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const disposition = req.query.download ? 'attachment' : f.mime?.startsWith('image/') || f.mime === 'application/pdf' ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(f.original_name)}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(data);
});

filesRouter.patch('/:id', requireAuth, async (req, res) => {
  const f = await get<any>(req.db, 'SELECT * FROM files WHERE id = ?', [intParam(req.params.id)]);
  if (!f) throw new HttpError(404, 'File not found');
  assertEntityAccess(req, f.entity_type, 'edit');
  const category = String(req.body?.category ?? '');
  if (!(FILE_CATEGORIES as readonly string[]).includes(category)) throw new HttpError(400, 'Unknown category');
  await run(req.db, 'UPDATE files SET category = ? WHERE id = ?', [category, f.id]);
  res.json({ ok: true });
});

filesRouter.delete('/:id', requireAuth, async (req, res) => {
  const db = req.db;
  const f = await get<any>(db, 'SELECT * FROM files WHERE id = ?', [intParam(req.params.id)]);
  if (!f) throw new HttpError(404, 'File not found');
  assertEntityAccess(req, f.entity_type, 'edit');
  await storage().del(f.stored_name).catch(() => undefined);
  await run(db, 'DELETE FROM files WHERE id = ?', [f.id]);
  if (f.entity_type !== 'company') {
    await logActivity(db, { userId: req.user!.id, action: 'file_removed', entityType: f.entity_type, entityId: f.entity_id, label: f.original_name, message: `removed file ${f.original_name}` });
  }
  res.json({ ok: true });
});
