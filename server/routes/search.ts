import { Router } from 'express';
import { all } from '../db.js';
import { can, requireAuth } from '../auth.js';
import { likeEscape, normalizeUnitNumber } from '../util.js';
import { normalizePhone } from '../../shared/phone.js';
import { ownerCode, requirementCode, unitCode } from '../activity.js';
import { redactOwner } from './owners.js';
import { presentUnit } from './units.js';

export const searchRouter = Router();

/**
 * Universal search across owners, units, requirements and team members.
 * Phone numbers match regardless of formatting (+20, spaces, dashes).
 */
searchRouter.get('/', requireAuth, async (req, res) => {
  const db = req.db;
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ owners: [], units: [], requirements: [], users: [] });
  const like = `%${likeEscape(q)}%`;
  const digits = normalizePhone(q);
  const looksLikePhone = /^[\d\s+()-]+$/.test(q) && digits.length >= 3;
  const phoneLike = `%${digits}%`;
  const canContact = can(req.user, 'owners.contact');
  const out: Record<string, any[]> = { owners: [], units: [], requirements: [], users: [] };

  if (can(req.user, 'owners.view')) {
    const phoneClause = looksLikePhone && canContact ? 'OR o.primary_phone_norm ILIKE ? OR o.secondary_phone_norm ILIKE ? OR o.whatsapp_norm ILIKE ?' : '';
    const code = q.match(/^o-?0*(\d+)$/i);
    const params: any[] = [like, like, like];
    if (phoneClause) params.push(phoneLike, phoneLike, phoneLike);
    params.push(code ? Number(code[1]) : -1);
    out.owners = (await all<any>(
      db,
      `SELECT o.id, o.name, o.name_ar, o.primary_phone, o.email, o.status,
              (SELECT COUNT(*) FROM units u WHERE u.owner_id = o.id AND u.archived_at IS NULL) AS unit_count
         FROM owners o
        WHERE o.name ILIKE ? ESCAPE '\\' OR o.name_ar ILIKE ? ESCAPE '\\' OR o.email ILIKE ? ESCAPE '\\' ${phoneClause} OR o.id = ?
        ORDER BY (o.status = 'Archived'), o.name COLLATE NOCASE LIMIT 8`,
      params,
    )).map((o) => redactOwner(req.user, { ...o, code: ownerCode(o.id) }));
  }

  if (can(req.user, 'inventory.view')) {
    const unitNo = normalizeUnitNumber(q);
    const words = q.split(/\s+/).filter(Boolean);
    const wordClause = words.length > 1
      ? 'OR (' + words.map(() => "(p.name ILIKE ? ESCAPE '\\' OR u.unit_number ILIKE ? ESCAPE '\\' OR u.phase ILIKE ? ESCAPE '\\' OR d.name ILIKE ? ESCAPE '\\' OR u.property_type ILIKE ? ESCAPE '\\')").join(' AND ') + ')'
      : '';
    const code = q.match(/^u-?0*(\d+)$/i);
    const params: any[] = [like, like, like, like, like, like, unitNo ? `%${unitNo}%` : null];
    for (const w of words.length > 1 ? words : []) {
      const wl = `%${likeEscape(w)}%`;
      params.push(wl, wl, wl, wl, wl);
    }
    const ownerPhone = looksLikePhone && canContact && can(req.user, 'owners.view') ? 'OR o.primary_phone_norm ILIKE ?' : '';
    if (ownerPhone) params.push(phoneLike);
    params.push(code ? Number(code[1]) : -1);
    out.units = (await all<any>(
      db,
      `SELECT u.id, u.unit_number, u.phase, u.property_type, u.asking_price, u.status, u.bua, u.bedrooms, u.owner_id,
              p.name AS project, d.name AS developer, o.name AS owner_name, a.name AS agent_name
         FROM units u LEFT JOIN projects p ON p.id = u.project_id LEFT JOIN developers d ON d.id = u.developer_id
         LEFT JOIN owners o ON o.id = u.owner_id LEFT JOIN users a ON a.id = u.assigned_user_id
        WHERE u.archived_at IS NULL AND (
              p.name ILIKE ? ESCAPE '\\' OR d.name ILIKE ? ESCAPE '\\' OR u.unit_number ILIKE ? ESCAPE '\\' OR u.phase ILIKE ? ESCAPE '\\'
              OR u.property_type ILIKE ? ESCAPE '\\' OR a.name ILIKE ? ESCAPE '\\' OR u.unit_number_norm ILIKE ? ${wordClause} ${ownerPhone} OR u.id = ?)
        ORDER BY u.updated_at DESC LIMIT 8`,
      params,
    )).map((u) => presentUnit(req.user, { ...u, code: unitCode(u.id) }));
  }

  if (can(req.user, 'requirements.view')) {
    const phoneClause = looksLikePhone && canContact ? 'OR r.phone_norm ILIKE ?' : '';
    const params: any[] = [like];
    if (phoneClause) params.push(phoneLike);
    out.requirements = (await all<any>(
      db,
      `SELECT r.id, r.client_name, r.status, r.priority, r.min_price, r.max_price FROM requirements r
        WHERE r.archived_at IS NULL AND (r.client_name ILIKE ? ESCAPE '\\' ${phoneClause}) ORDER BY r.updated_at DESC LIMIT 5`,
      params,
    )).map((r) => ({ ...r, code: requirementCode(r.id) }));
  }

  out.users = await all<any>(db, "SELECT id, name, email FROM users WHERE status = 'active' AND name ILIKE ? ESCAPE '\\' LIMIT 3", [like]);
  res.json(out);
});
