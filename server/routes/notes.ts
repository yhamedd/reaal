import { Router } from 'express';
import { all, get, run } from '../db.js';
import { HttpError, can, requireAuth } from '../auth.js';
import { intParam } from '../util.js';
import { logActivity, notify, unitLabel } from '../activity.js';
import { assertEntityAccess } from './files.js';

export const notesRouter = Router();

function entityInfo(db: import('../db.js').DB, type: string, id: number): { label: string; link: string } | null {
  if (type === 'unit') {
    if (!get(db, 'SELECT 1 FROM units WHERE id = ?', [id])) return null;
    return { label: unitLabel(db, id), link: `/inventory/${id}` };
  }
  if (type === 'owner') {
    const o = get<any>(db, 'SELECT name FROM owners WHERE id = ?', [id]);
    return o ? { label: o.name, link: `/owners/${id}` } : null;
  }
  if (type === 'requirement') {
    const r = get<any>(db, 'SELECT client_name FROM requirements WHERE id = ?', [id]);
    return r ? { label: `${r.client_name}'s requirement`, link: `/requirements/${id}` } : null;
  }
  return null;
}

notesRouter.get('/', requireAuth, (req, res) => {
  const type = String(req.query.entity_type ?? '');
  const id = intParam(req.query.entity_id, 'entity_id');
  assertEntityAccess(req, type, 'view');
  res.json(
    all(
      req.db,
      `SELECT n.*, u.name AS author_name FROM notes n LEFT JOIN users u ON u.id = n.author_id
        WHERE n.entity_type = ? AND n.entity_id = ? ORDER BY n.created_at DESC, n.id DESC`,
      [type, id],
    ),
  );
});

notesRouter.post('/', requireAuth, (req, res) => {
  const db = req.db;
  const type = String(req.body?.entity_type ?? '');
  const id = intParam(req.body?.entity_id, 'entity_id');
  assertEntityAccess(req, type, 'view');
  const content = String(req.body?.content ?? '').trim();
  if (!content) throw new HttpError(400, 'Write something first');
  if (content.length > 5000) throw new HttpError(400, 'Note is too long');
  const info = entityInfo(db, type, id);
  if (!info) throw new HttpError(404, 'Record not found');
  const { lastId } = run(db, 'INSERT INTO notes (entity_type, entity_id, content, author_id) VALUES (?, ?, ?, ?)', [type, id, content, req.user!.id]);
  logActivity(db, { userId: req.user!.id, action: 'note_added', entityType: type, entityId: id, label: info.label, message: `added a note to ${info.label}` });

  // @mentions: "@Sarah Ali" or "@Sarah" (when the first name is unique)
  if (content.includes('@')) {
    const users = all<{ id: number; name: string }>(db, "SELECT id, name FROM users WHERE status = 'active'");
    const lower = content.toLowerCase();
    const firstNameCounts = new Map<string, number>();
    for (const u of users) {
      const f = u.name.split(' ')[0].toLowerCase();
      firstNameCounts.set(f, (firstNameCounts.get(f) ?? 0) + 1);
    }
    const mentioned = new Set<number>();
    for (const u of users) {
      const full = `@${u.name.toLowerCase()}`;
      const first = u.name.split(' ')[0].toLowerCase();
      const firstRe = new RegExp(`@${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, 'u');
      if (lower.includes(full) || (firstNameCounts.get(first) === 1 && firstRe.test(lower))) mentioned.add(u.id);
    }
    for (const uid of mentioned) {
      if (uid === req.user!.id) continue;
      notify(db, uid, 'mention', `${req.user!.name} mentioned you in a note on ${info.label}: “${content.slice(0, 120)}”`, info.link);
    }
  }
  res.status(201).json({ id: lastId });
});

notesRouter.delete('/:id', requireAuth, (req, res) => {
  const db = req.db;
  const note = get<any>(db, 'SELECT * FROM notes WHERE id = ?', [intParam(req.params.id)]);
  if (!note) throw new HttpError(404, 'Note not found');
  if (note.author_id !== req.user!.id && !can(req.user, 'users.manage')) throw new HttpError(403, 'You can only delete your own notes');
  run(db, 'DELETE FROM notes WHERE id = ?', [note.id]);
  logActivity(db, { userId: req.user!.id, action: 'note_deleted', entityType: note.entity_type, entityId: note.entity_id, message: 'deleted a note' });
  res.json({ ok: true });
});
