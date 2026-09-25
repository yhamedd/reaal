import { Router } from 'express';
import { all, get } from '../db.js';
import { can, requireAuth } from '../auth.js';
import { idList, likeEscape } from '../util.js';
import { assertEntityAccess } from './files.js';

export const activityRouter = Router();

/**
 * Two modes: record history (entity_type + entity_id) is visible to anyone who
 * can view that record; the full team log requires activity.view.
 */
activityRouter.get('/', requireAuth, async (req, res) => {
  const db = req.db;
  const clauses: string[] = [];
  const params: any[] = [];
  const entityType = req.query.entity_type ? String(req.query.entity_type) : '';
  const entityId = Number(req.query.entity_id) || 0;
  if (entityType && entityId) {
    assertEntityAccess(req, entityType, 'view');
    if (entityType === 'owner') {
      // An owner's history includes activity on the units they own.
      clauses.push("((a.entity_type = 'owner' AND a.entity_id = ?) OR (a.entity_type = 'unit' AND a.entity_id IN (SELECT id FROM units WHERE owner_id = ?)))");
      params.push(entityId, entityId);
    } else {
      clauses.push('a.entity_type = ? AND a.entity_id = ?');
      params.push(entityType, entityId);
    }
  } else {
    // Without activity.view a user only ever sees their own actions.
    if (!can(req.user, 'activity.view') || req.query.mine === '1') {
      clauses.push('a.user_id = ?');
      params.push(req.user!.id);
    }
    if (entityType) {
      clauses.push('a.entity_type = ?');
      params.push(entityType);
    }
  }
  const users = idList(req.query.user_ids);
  if (users.length) {
    clauses.push(`a.user_id IN (${users.map(() => '?').join(',')})`);
    params.push(...users);
  }
  const actions = String(req.query.actions ?? '').split(',').filter(Boolean);
  if (actions.length) {
    clauses.push(`a.action IN (${actions.map(() => '?').join(',')})`);
    params.push(...actions);
  }
  const q = String(req.query.q ?? '').trim();
  if (q) {
    const like = `%${likeEscape(q)}%`;
    clauses.push("(a.message LIKE ? ESCAPE '\\' OR a.entity_label LIKE ? ESCAPE '\\' OR a.old_value LIKE ? ESCAPE '\\' OR a.new_value LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like, like);
  }
  if (req.query.from) {
    clauses.push('a.created_at >= ?');
    params.push(String(req.query.from));
  }
  if (req.query.to) {
    clauses.push("a.created_at < date(?, '+1 day')");
    params.push(String(req.query.to));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const total = (await get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM activity a LEFT JOIN users u ON u.id = a.user_id ${where}`, params))!.n;
  const rows = await all<any>(
    db,
    `SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id ${where}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json({ total, rows });
});

activityRouter.get('/actions', requireAuth, async (req, res) => {
  res.json((await all<{ action: string }>(req.db, 'SELECT DISTINCT action FROM activity ORDER BY action')).map((r) => r.action));
});
