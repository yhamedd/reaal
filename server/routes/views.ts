import { Router } from 'express';
import { all, get, run } from '../db.js';
import { HttpError, can, requireAuth } from '../auth.js';
import { intParam } from '../util.js';

export const viewsRouter = Router();

viewsRouter.get('/', requireAuth, (req, res) => {
  const entity = String(req.query.entity ?? 'units');
  const rows = all<any>(
    req.db,
    `SELECT v.*, u.name AS owner_name FROM saved_views v LEFT JOIN users u ON u.id = v.user_id
      WHERE v.entity = ? AND (v.user_id = ? OR v.shared = 1) ORDER BY v.shared, v.name COLLATE NOCASE`,
    [entity, req.user!.id],
  );
  res.json(rows.map((r) => ({ ...r, config: JSON.parse(r.config), mine: r.user_id === req.user!.id })));
});

viewsRouter.post('/', requireAuth, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Give the view a name');
  const config = req.body?.config;
  if (!config || typeof config !== 'object') throw new HttpError(400, 'Missing view configuration');
  const { lastId } = run(req.db, 'INSERT INTO saved_views (entity, name, user_id, shared, config) VALUES (?, ?, ?, ?, ?)', [
    String(req.body?.entity ?? 'units'),
    name.slice(0, 100),
    req.user!.id,
    req.body?.shared ? 1 : 0,
    JSON.stringify(config),
  ]);
  res.status(201).json({ id: lastId });
});

viewsRouter.patch('/:id', requireAuth, (req, res) => {
  const id = intParam(req.params.id);
  const v = get<any>(req.db, 'SELECT * FROM saved_views WHERE id = ?', [id]);
  if (!v) throw new HttpError(404, 'View not found');
  if (v.user_id !== req.user!.id && !can(req.user, 'users.manage')) throw new HttpError(403, 'Only the creator can change this view');
  if (req.body?.name !== undefined) run(req.db, 'UPDATE saved_views SET name = ? WHERE id = ?', [String(req.body.name).trim().slice(0, 100) || v.name, id]);
  if (req.body?.shared !== undefined) run(req.db, 'UPDATE saved_views SET shared = ? WHERE id = ?', [req.body.shared ? 1 : 0, id]);
  if (req.body?.config) run(req.db, "UPDATE saved_views SET config = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(req.body.config), id]);
  res.json({ ok: true });
});

viewsRouter.delete('/:id', requireAuth, (req, res) => {
  const id = intParam(req.params.id);
  const v = get<any>(req.db, 'SELECT * FROM saved_views WHERE id = ?', [id]);
  if (!v) throw new HttpError(404, 'View not found');
  if (v.user_id !== req.user!.id && !can(req.user, 'users.manage')) throw new HttpError(403, 'Only the creator can delete this view');
  run(req.db, 'DELETE FROM saved_views WHERE id = ?', [id]);
  res.json({ ok: true });
});
