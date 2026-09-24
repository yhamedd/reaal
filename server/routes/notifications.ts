import { Router } from 'express';
import { all, get, run, nowIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { intParam } from '../util.js';

export const notificationsRouter = Router();

notificationsRouter.get('/count', requireAuth, (req, res) => {
  res.json({ unread: get<{ n: number }>(req.db, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user!.id])!.n });
});

notificationsRouter.get('/', requireAuth, (req, res) => {
  res.json(all(req.db, 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100', [req.user!.id]));
});

notificationsRouter.post('/read-all', requireAuth, (req, res) => {
  run(req.db, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [nowIso(), req.user!.id]);
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', requireAuth, (req, res) => {
  run(req.db, 'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', [nowIso(), intParam(req.params.id), req.user!.id]);
  res.json({ ok: true });
});
