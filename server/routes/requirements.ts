import { Router } from 'express';
import { all, get, run, tx, nowIso } from '../db.js';
import { HttpError, can, requirePermission } from '../auth.js';
import { coerce, getTags, idList, intParam, likeEscape, maskPhone, setTags, type FieldSpec } from '../util.js';
import { PRIORITIES, REQUIREMENT_STATUSES } from '../../shared/constants.js';
import { normalizePhone } from '../../shared/phone.js';
import { logActivity, logChanges, money, notify, requirementCode, unitLabel, type FieldMeta } from '../activity.js';
import { findMatches, markMatchesSeen, type RequirementRow } from '../services/matching.js';
import { presentUnit } from './units.js';
import { deleteEntityFiles } from './files.js';

export const requirementsRouter = Router();

const SPEC: Record<string, FieldSpec> = {
  client_name: { type: 'text', label: 'Client name', required: true, max: 200 },
  phone: { type: 'text', label: 'Phone', max: 40 },
  whatsapp: { type: 'text', label: 'WhatsApp', max: 40 },
  assigned_user_id: { type: 'id', label: 'Assigned agent' },
  developer_id: { type: 'id', label: 'Developer' },
  preferred_project_ids: { type: 'json', label: 'Preferred projects' },
  property_types: { type: 'json', label: 'Property types' },
  min_bua: { type: 'number', label: 'Minimum BUA' },
  max_bua: { type: 'number', label: 'Maximum BUA' },
  min_bedrooms: { type: 'int', label: 'Minimum bedrooms' },
  min_price: { type: 'number', label: 'Minimum price' },
  max_price: { type: 'number', label: 'Maximum price' },
  finishing: { type: 'text', label: 'Finishing', max: 100 },
  delivery_preference: { type: 'text', label: 'Delivery preference', max: 100 },
  priority: { type: 'enum', label: 'Priority', values: PRIORITIES },
  status: { type: 'enum', label: 'Status', values: REQUIREMENT_STATUSES },
};

const LOG: Record<string, FieldMeta> = Object.fromEntries(
  Object.entries(SPEC).map(([k, f]) => [k, { label: f.label, format: ['min_price', 'max_price'].includes(k) ? money : undefined }]),
);

const SELECT = `
  SELECT r.*, a.name AS agent_name, d.name AS developer, cb.name AS created_by_name,
         (SELECT COUNT(*) FROM offers o WHERE o.requirement_id = r.id) AS offer_count
    FROM requirements r
    LEFT JOIN users a ON a.id = r.assigned_user_id
    LEFT JOIN developers d ON d.id = r.developer_id
    LEFT JOIN users cb ON cb.id = r.created_by`;

function normalise(data: Record<string, any>) {
  if ('preferred_project_ids' in data) data.preferred_project_ids = JSON.stringify(idList(data.preferred_project_ids ?? []));
  if ('property_types' in data) {
    const v = data.property_types;
    const arr = (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((s: unknown) => String(s).trim()).filter(Boolean);
    data.property_types = JSON.stringify(arr);
  }
  if ('phone' in data) data.phone_norm = normalizePhone(data.phone) || null;
  if (data.min_price != null && data.max_price != null && data.min_price > data.max_price) {
    throw new HttpError(400, 'Minimum price is higher than maximum price', { fields: { min_price: 'Must be below maximum price' } });
  }
  if (data.min_bua != null && data.max_bua != null && data.min_bua > data.max_bua) {
    throw new HttpError(400, 'Minimum BUA is higher than maximum BUA', { fields: { min_bua: 'Must be below maximum BUA' } });
  }
  return data;
}

function present(req: Express.Request, r: any, tags?: any[]) {
  const db = req.db;
  const projectIds: number[] = JSON.parse(r.preferred_project_ids || '[]');
  const projects = projectIds.length
    ? all<any>(db, `SELECT id, name FROM projects WHERE id IN (${projectIds.map(() => '?').join(',')})`, projectIds)
    : [];
  const out = {
    ...r,
    code: requirementCode(r.id),
    preferred_project_ids: projectIds,
    preferred_projects: projects,
    property_types: JSON.parse(r.property_types || '[]'),
    tags: tags ?? [],
  };
  if (!can(req.user, 'owners.contact')) {
    out.phone = maskPhone(out.phone);
    out.whatsapp = maskPhone(out.whatsapp);
    out.contact_hidden = true;
  }
  delete out.phone_norm;
  return out;
}

requirementsRouter.get('/', requirePermission('requirements.view'), (req, res) => {
  const db = req.db;
  const clauses: string[] = ['r.archived_at IS NULL'];
  const params: any[] = [];
  const q = String(req.query.q ?? '').trim();
  if (q) {
    const like = `%${likeEscape(q)}%`;
    const parts = ["r.client_name LIKE ? ESCAPE '\\'", "d.name LIKE ? ESCAPE '\\'", "a.name LIKE ? ESCAPE '\\'"];
    params.push(like, like, like);
    const phone = normalizePhone(q);
    if (phone.length >= 3 && /^[\d\s+()-]+$/.test(q)) {
      parts.push('r.phone_norm LIKE ?');
      params.push(`%${phone}%`);
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }
  const statuses = String(req.query.status ?? '').split(',').filter(Boolean);
  if (statuses.length) {
    clauses.push(`r.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  const priorities = String(req.query.priority ?? '').split(',').filter(Boolean);
  if (priorities.length) {
    clauses.push(`r.priority IN (${priorities.map(() => '?').join(',')})`);
    params.push(...priorities);
  }
  const agents = idList(req.query.assigned);
  if (agents.length) {
    clauses.push(`r.assigned_user_id IN (${agents.map(() => '?').join(',')})`);
    params.push(...agents);
  }
  if (req.query.mine === '1') {
    clauses.push('(r.assigned_user_id = ? OR r.created_by = ?)');
    params.push(req.user!.id, req.user!.id);
  }
  const rows = all<any>(
    db,
    `${SELECT} WHERE ${clauses.join(' AND ')}
      ORDER BY CASE r.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, r.updated_at DESC LIMIT 2000`,
    params,
  );
  const tags = getTags(db, 'requirement', rows.map((r) => r.id));
  // Match counts are cheap enough to compute per row for the list page.
  res.json(
    rows.map((r) => ({
      ...present(req, r, tags.get(r.id)),
      match_count: ['Active', 'Contacted'].includes(r.status) ? findMatches(db, r as RequirementRow).length : null,
    })),
  );
});

requirementsRouter.post('/', requirePermission('requirements.manage'), (req, res) => {
  const db = req.db;
  const data = normalise(coerce(req.body ?? {}, SPEC, false));
  if (!data.assigned_user_id) data.assigned_user_id = req.user!.id;
  const id = tx(db, () => {
    const cols = Object.keys(data);
    const { lastId } = run(db, `INSERT INTO requirements (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`, [
      ...cols.map((c) => data[c]),
      req.user!.id,
    ]);
    if (Array.isArray(req.body?.tag_ids)) setTags(db, 'requirement', lastId, idList(req.body.tag_ids));
    logActivity(db, { userId: req.user!.id, action: 'created', entityType: 'requirement', entityId: lastId, label: data.client_name, message: `added a requirement for ${data.client_name}` });
    if (data.assigned_user_id !== req.user!.id) notify(db, data.assigned_user_id, 'assigned', `${req.user!.name} assigned the requirement for ${data.client_name} to you`, `/requirements/${lastId}`);
    markMatchesSeen(db, get<RequirementRow>(db, 'SELECT * FROM requirements WHERE id = ?', [lastId])!);
    return lastId;
  });
  res.status(201).json({ id });
});

requirementsRouter.get('/:id', requirePermission('requirements.view'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const r = get<any>(db, `${SELECT} WHERE r.id = ?`, [id]);
  if (!r) throw new HttpError(404, 'Requirement not found');
  const offers = all<any>(
    db,
    `SELECT o.id, o.template, o.created_at, u.name AS created_by_name,
            (SELECT COUNT(*) FROM offer_units ou WHERE ou.offer_id = o.id) AS unit_count
       FROM offers o LEFT JOIN users u ON u.id = o.created_by WHERE o.requirement_id = ? ORDER BY o.created_at DESC`,
    [id],
  );
  res.json({ ...present(req, r, getTags(db, 'requirement', [id]).get(id)), offers });
});

requirementsRouter.get('/:id/matches', requirePermission('requirements.view', 'inventory.view'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const r = get<RequirementRow>(db, 'SELECT * FROM requirements WHERE id = ?', [id]);
  if (!r) throw new HttpError(404, 'Requirement not found');
  const includeExcluded = req.query.include_excluded === '1';
  const offered = new Set(
    all<{ unit_id: number }>(db, 'SELECT DISTINCT ou.unit_id FROM offer_units ou JOIN offers o ON o.id = ou.offer_id WHERE o.requirement_id = ?', [id]).map((x) => x.unit_id),
  );
  const rows = findMatches(db, r, { includeExcluded });
  const tags = getTags(db, 'unit', rows.map((u) => u.id));
  res.json(rows.map((u) => ({ ...presentUnit(req.user, u, tags.get(u.id)), score: u.score, reasons: u.reasons, excluded: u.excluded, already_offered: offered.has(u.id) })));
});

requirementsRouter.post('/:id/exclusions', requirePermission('requirements.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const unitIds = idList(req.body?.unit_ids);
  const r = get<any>(db, 'SELECT client_name FROM requirements WHERE id = ?', [id]);
  if (!r) throw new HttpError(404, 'Requirement not found');
  for (const u of unitIds) {
    run(db, 'INSERT OR IGNORE INTO requirement_exclusions (requirement_id, unit_id, created_by) VALUES (?, ?, ?)', [id, u, req.user!.id]);
  }
  if (unitIds.length) {
    logActivity(db, { userId: req.user!.id, action: 'matches_removed', entityType: 'requirement', entityId: id, label: r.client_name, message: `removed ${unitIds.map((u) => unitLabel(db, u)).join(', ')} from matches for ${r.client_name}` });
  }
  res.json({ ok: true });
});

requirementsRouter.delete('/:id/exclusions/:unitId', requirePermission('requirements.manage'), (req, res) => {
  run(req.db, 'DELETE FROM requirement_exclusions WHERE requirement_id = ? AND unit_id = ?', [intParam(req.params.id), intParam(req.params.unitId)]);
  res.json({ ok: true });
});

requirementsRouter.patch('/:id', requirePermission('requirements.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const before = get<any>(db, 'SELECT * FROM requirements WHERE id = ?', [id]);
  if (!before) throw new HttpError(404, 'Requirement not found');
  const data = normalise(coerce(req.body ?? {}, SPEC, true));
  tx(db, () => {
    const keys = Object.keys(data);
    if (keys.length) {
      run(db, `UPDATE requirements SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => data[k]), nowIso(), id]);
      const b = { ...before };
      const a = { ...data };
      delete (a as any).preferred_project_ids;
      delete (a as any).property_types;
      logChanges(db, req.user!, 'requirement', id, data.client_name ?? before.client_name, b, a, LOG);
      if (data.preferred_project_ids !== undefined && data.preferred_project_ids !== before.preferred_project_ids) {
        logActivity(db, { userId: req.user!.id, action: 'updated', entityType: 'requirement', entityId: id, label: before.client_name, field: 'preferred_project_ids', message: `changed preferred projects for ${before.client_name}` });
      }
      if (data.property_types !== undefined && data.property_types !== before.property_types) {
        logActivity(db, { userId: req.user!.id, action: 'updated', entityType: 'requirement', entityId: id, label: before.client_name, field: 'property_types', oldValue: before.property_types, newValue: data.property_types, message: `changed property types for ${before.client_name}` });
      }
      if (data.assigned_user_id && data.assigned_user_id !== before.assigned_user_id && data.assigned_user_id !== req.user!.id) {
        notify(db, data.assigned_user_id, 'assigned', `${req.user!.name} assigned the requirement for ${before.client_name} to you`, `/requirements/${id}`);
      }
      // Criteria changed: current matches are the new baseline for "new match" alerts.
      markMatchesSeen(db, get<RequirementRow>(db, 'SELECT * FROM requirements WHERE id = ?', [id])!);
    }
    if (Array.isArray(req.body?.tag_ids)) setTags(db, 'requirement', id, idList(req.body.tag_ids));
  });
  res.json({ ok: true });
});

requirementsRouter.post('/:id/archive', requirePermission('requirements.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const r = get<any>(db, 'SELECT client_name FROM requirements WHERE id = ?', [id]);
  if (!r) throw new HttpError(404, 'Requirement not found');
  run(db, 'UPDATE requirements SET archived_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), id]);
  logActivity(db, { userId: req.user!.id, action: 'archived', entityType: 'requirement', entityId: id, label: r.client_name, message: `archived the requirement for ${r.client_name}` });
  res.json({ ok: true });
});

requirementsRouter.delete('/:id', requirePermission('records.purge'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const r = get<any>(db, 'SELECT * FROM requirements WHERE id = ?', [id]);
  if (!r) throw new HttpError(404, 'Requirement not found');
  if (String(req.body?.confirm ?? '') !== r.client_name) throw new HttpError(400, 'Type the client name exactly to confirm permanent deletion');
  tx(db, () => {
    deleteEntityFiles(db, 'requirement', id);
    run(db, "DELETE FROM notes WHERE entity_type = 'requirement' AND entity_id = ?", [id]);
    run(db, "DELETE FROM taggings WHERE entity_type = 'requirement' AND entity_id = ?", [id]);
    run(db, 'DELETE FROM requirements WHERE id = ?', [id]);
    logActivity(db, { userId: req.user!.id, action: 'purged', entityType: 'requirement', entityId: id, label: r.client_name, message: `permanently deleted the requirement for ${r.client_name}` });
  });
  res.json({ ok: true });
});
