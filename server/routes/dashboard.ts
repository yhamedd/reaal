import { Router } from 'express';
import { all, get } from '../db.js';
import { can, requireAuth } from '../auth.js';
import { getSettings } from '../settings.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', requireAuth, async (req, res) => {
  const db = req.db;
  const s = (await getSettings(db)).verification;
  const n = async (sql: string, p: any[] = []) => (await get<{ n: number }>(db, sql, p))!.n;
  const inv = can(req.user, 'inventory.view');
  const kpis = {
    total_units: inv ? await n("SELECT COUNT(*) AS n FROM units WHERE archived_at IS NULL AND status <> 'Archived'") : null,
    available_units: inv ? await n("SELECT COUNT(*) AS n FROM units WHERE status = 'Available' AND archived_at IS NULL") : null,
    reserved_units: inv ? await n("SELECT COUNT(*) AS n FROM units WHERE status = 'Reserved' AND archived_at IS NULL") : null,
    sold_units: inv ? await n("SELECT COUNT(*) AS n FROM units WHERE status = 'Sold' AND archived_at IS NULL") : null,
    total_owners: can(req.user, 'owners.view') ? await n("SELECT COUNT(*) AS n FROM owners WHERE status <> 'Archived'") : null,
    active_requirements: can(req.user, 'requirements.view')
      ? await n("SELECT COUNT(*) AS n FROM requirements WHERE status IN ('Active', 'Contacted') AND archived_at IS NULL")
      : null,
    offers_created: can(req.user, 'offers.view_all') ? await n('SELECT COUNT(*) AS n FROM offers') : await n('SELECT COUNT(*) AS n FROM offers WHERE created_by = ?', [req.user!.id]),
    units_this_week: inv ? await n("SELECT COUNT(*) AS n FROM units WHERE created_at >= datetime('now', '-7 days')") : null,
    needs_verification: inv
      ? await n(
          `SELECT COUNT(*) AS n FROM units WHERE archived_at IS NULL AND status IN ('Available', 'Reserved', 'Pending Verification')
             AND (last_verified IS NULL OR julianday('now') - julianday(last_verified) >= ?)`,
          [s.attention_days],
        )
      : null,
  };
  const teamWide = can(req.user, 'activity.view');
  const activity = await all<any>(
    db,
    `SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
      ${teamWide ? '' : 'WHERE a.user_id = ?'}
      ORDER BY a.created_at DESC, a.id DESC LIMIT 25`,
    teamWide ? [] : [req.user!.id],
  );
  const myUnitsToVerify = inv
    ? await all<any>(
        db,
        `SELECT u.id, u.unit_number, u.last_verified, u.status, p.name AS project FROM units u LEFT JOIN projects p ON p.id = u.project_id
          WHERE u.assigned_user_id = ? AND u.archived_at IS NULL AND u.status IN ('Available', 'Reserved', 'Pending Verification')
            AND (u.last_verified IS NULL OR julianday('now') - julianday(u.last_verified) >= ?)
          ORDER BY u.last_verified IS NOT NULL, u.last_verified LIMIT 8`,
        [req.user!.id, s.attention_days],
      )
    : [];
  const byProject = inv
    ? await all<any>(
        db,
        `SELECT p.id, p.name, COUNT(*) AS n FROM units u JOIN projects p ON p.id = u.project_id
          WHERE u.status = 'Available' AND u.archived_at IS NULL GROUP BY p.id ORDER BY n DESC LIMIT 8`,
      )
    : [];
  res.json({ kpis, activity, team_wide: teamWide, my_units_to_verify: myUnitsToVerify, available_by_project: byProject });
});
