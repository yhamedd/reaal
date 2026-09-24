import { Router } from 'express';
import { all, get, run, tx, nowIso } from '../db.js';
import { HttpError, can, requirePermission } from '../auth.js';
import { coerce, getTags, idList, intParam, likeEscape, maskEmail, maskPhone, setTags, type FieldSpec } from '../util.js';
import { OWNER_STATUSES } from '../../shared/constants.js';
import { normalizePhone } from '../../shared/phone.js';
import { logActivity, logChanges, notify, notifyPermission, ownerCode, type FieldMeta } from '../activity.js';
import { UNIT_SELECT } from '../services/units.js';
import type { DB } from '../db.js';
import { deleteEntityFiles } from './files.js';
import type { AuthUser } from '../auth.js';

export const ownersRouter = Router();

export const OWNER_SPEC: Record<string, FieldSpec> = {
  name: { type: 'text', label: 'Full name', required: true, max: 200 },
  primary_phone: { type: 'text', label: 'Primary phone', max: 40 },
  secondary_phone: { type: 'text', label: 'Secondary phone', max: 40 },
  whatsapp: { type: 'text', label: 'WhatsApp number', max: 40 },
  email: { type: 'text', label: 'Email', max: 200 },
  assigned_user_id: { type: 'id', label: 'Assigned agent' },
  source: { type: 'text', label: 'Source', max: 100 },
  status: { type: 'enum', label: 'Status', values: OWNER_STATUSES },
  last_contacted: { type: 'date', label: 'Last contacted' },
};

const OWNER_LOG: Record<string, FieldMeta> = Object.fromEntries(Object.entries(OWNER_SPEC).map(([k, f]) => [k, { label: f.label }]));

export const OWNER_SELECT = `
  SELECT o.*, a.name AS agent_name, cb.name AS created_by_name,
         (SELECT COUNT(*) FROM units u WHERE u.owner_id = o.id AND u.archived_at IS NULL) AS unit_count
    FROM owners o
    LEFT JOIN users a ON a.id = o.assigned_user_id
    LEFT JOIN users cb ON cb.id = o.created_by`;

/** Hides contact details from users who lack owners.contact. */
export function redactOwner<T extends Record<string, any>>(user: AuthUser | undefined, row: T): T {
  if (can(user, 'owners.contact')) return row;
  return {
    ...row,
    primary_phone: maskPhone(row.primary_phone),
    secondary_phone: maskPhone(row.secondary_phone),
    whatsapp: maskPhone(row.whatsapp),
    email: maskEmail(row.email),
    primary_phone_norm: undefined,
    secondary_phone_norm: undefined,
    whatsapp_norm: undefined,
    contact_hidden: true,
  };
}

function withNorms(data: Record<string, any>) {
  if ('primary_phone' in data) data.primary_phone_norm = normalizePhone(data.primary_phone) || null;
  if ('secondary_phone' in data) data.secondary_phone_norm = normalizePhone(data.secondary_phone) || null;
  if ('whatsapp' in data) data.whatsapp_norm = normalizePhone(data.whatsapp) || null;
  if (data.email) data.email = String(data.email).toLowerCase();
  return data;
}

export function findOwnerDuplicates(db: DB, data: { name?: string | null; primary_phone?: string | null; secondary_phone?: string | null; whatsapp?: string | null; email?: string | null }, excludeId = 0) {
  const phones = [data.primary_phone, data.secondary_phone, data.whatsapp].map((p) => normalizePhone(p)).filter((p) => p.length >= 7);
  const clauses: string[] = [];
  const params: any[] = [];
  if (phones.length) {
    const ph = phones.map(() => '?').join(',');
    clauses.push(`o.primary_phone_norm IN (${ph}) OR o.secondary_phone_norm IN (${ph}) OR o.whatsapp_norm IN (${ph})`);
    params.push(...phones, ...phones, ...phones);
  }
  if (data.email?.trim()) {
    clauses.push('o.email = ? COLLATE NOCASE');
    params.push(data.email.trim());
  }
  if (data.name?.trim()) {
    clauses.push("TRIM(o.name) = ? COLLATE NOCASE");
    params.push(data.name.trim());
  }
  if (!clauses.length) return [];
  const rows = all<any>(db, `${OWNER_SELECT} WHERE (${clauses.join(' OR ')}) AND o.id <> ? LIMIT 10`, [...params, excludeId]);
  return rows.map((r) => {
    const reasons: string[] = [];
    const rPhones = [r.primary_phone_norm, r.secondary_phone_norm, r.whatsapp_norm].filter(Boolean);
    if (phones.some((p) => rPhones.includes(p))) reasons.push('Same phone number');
    if (data.email && r.email && r.email.toLowerCase() === data.email.trim().toLowerCase()) reasons.push('Same email');
    if (data.name && r.name.trim().toLowerCase() === data.name.trim().toLowerCase()) reasons.push('Same name');
    return { ...r, reasons };
  });
}

export function insertOwner(db: DB, user: AuthUser, data: Record<string, any>) {
  withNorms(data);
  const cols = ['name', 'primary_phone', 'primary_phone_norm', 'secondary_phone', 'secondary_phone_norm', 'whatsapp', 'whatsapp_norm', 'email', 'assigned_user_id', 'source', 'status', 'last_contacted'];
  const values = cols.map((c) => data[c] ?? null);
  if (!data.status) values[cols.indexOf('status')] = 'Active';
  const { lastId } = run(db, `INSERT INTO owners (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`, [...values, user.id]);
  return lastId;
}

ownersRouter.get('/', requirePermission('owners.view'), (req, res) => {
  const db = req.db;
  const q = String(req.query.q ?? '').trim();
  const clauses: string[] = [];
  const params: any[] = [];
  const statuses = String(req.query.status ?? '').split(',').filter(Boolean);
  if (statuses.length) {
    clauses.push(`o.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  } else if (req.query.include_archived !== '1') {
    clauses.push("o.status <> 'Archived'");
  }
  if (q) {
    const like = `%${likeEscape(q)}%`;
    const parts = ["o.name LIKE ? ESCAPE '\\'", "o.email LIKE ? ESCAPE '\\'"];
    params.push(like, like);
    const phone = normalizePhone(q);
    if (phone.length >= 3 && /^[\d\s+()-]+$/.test(q) && can(req.user, 'owners.contact')) {
      parts.push('o.primary_phone_norm LIKE ? OR o.secondary_phone_norm LIKE ? OR o.whatsapp_norm LIKE ?');
      params.push(`%${phone}%`, `%${phone}%`, `%${phone}%`);
    }
    const code = q.match(/^o-?0*(\d+)$/i);
    if (code) {
      parts.push('o.id = ?');
      params.push(Number(code[1]));
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }
  const agents = idList(req.query.assigned);
  if (agents.length) {
    clauses.push(`o.assigned_user_id IN (${agents.map(() => '?').join(',')})`);
    params.push(...agents);
  }
  const tagIds = idList(req.query.tags);
  if (tagIds.length) {
    clauses.push(`o.id IN (SELECT entity_id FROM taggings WHERE entity_type = 'owner' AND tag_id IN (${tagIds.map(() => '?').join(',')}))`);
    params.push(...tagIds);
  }
  if (req.query.source) {
    clauses.push('o.source = ? COLLATE NOCASE');
    params.push(String(req.query.source));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sorts: Record<string, string> = {
    name: 'o.name COLLATE NOCASE',
    created_at: 'o.created_at',
    updated_at: 'o.updated_at',
    last_contacted: 'o.last_contacted',
    unit_count: 'unit_count',
    status: 'o.status',
    agent_name: 'agent_name',
  };
  const sortKey = sorts[String(req.query.sort ?? '')] ?? 'o.updated_at';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const total = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM owners o ${where}`, params)!.n;
  const rows = all<any>(db, `${OWNER_SELECT} ${where} ORDER BY ${sortKey} IS NULL, ${sortKey} ${dir}, o.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const tags = getTags(db, 'owner', rows.map((r) => r.id));
  res.json({ total, rows: rows.map((r) => redactOwner(req.user, { ...r, code: ownerCode(r.id), tags: tags.get(r.id) ?? [] })) });
});

ownersRouter.post('/check-duplicates', requirePermission('owners.view'), (req, res) => {
  const dups = findOwnerDuplicates(req.db, req.body ?? {}, Number(req.body?.exclude_id) || 0);
  res.json({ duplicates: dups.map((d) => redactOwner(req.user, { ...d, code: ownerCode(d.id) })) });
});

ownersRouter.post('/', requirePermission('owners.create'), (req, res) => {
  const db = req.db;
  const data = coerce(req.body ?? {}, OWNER_SPEC, false);
  const dups = findOwnerDuplicates(db, data);
  if (dups.length && !req.body?.confirm_duplicate) {
    return res.status(409).json({
      error: 'Possible duplicate found',
      duplicates: dups.map((d) => redactOwner(req.user, { ...d, code: ownerCode(d.id) })),
    });
  }
  const id = tx(db, () => {
    const id = insertOwner(db, req.user!, data);
    if (Array.isArray(req.body?.tag_ids)) setTags(db, 'owner', id, idList(req.body.tag_ids));
    logActivity(db, { userId: req.user!.id, action: 'created', entityType: 'owner', entityId: id, label: data.name, message: `added a new owner ${data.name}` });
    if (dups.length) {
      logActivity(db, {
        userId: req.user!.id,
        action: 'duplicate_acknowledged',
        entityType: 'owner',
        entityId: id,
        label: data.name,
        newValue: dups.map((d) => d.id).join(','),
        message: `created ${data.name} despite a possible duplicate (${dups.map((d) => ownerCode(d.id)).join(', ')})`,
      });
      notifyPermission(db, 'users.manage', 'duplicate', `${req.user!.name} created a possible duplicate owner: ${data.name}`, `/owners/${id}`, req.user!.id);
    }
    if (data.assigned_user_id && data.assigned_user_id !== req.user!.id) {
      notify(db, data.assigned_user_id, 'assigned', `${req.user!.name} assigned owner ${data.name} to you`, `/owners/${id}`);
    }
    return id;
  });
  res.status(201).json({ id });
});

ownersRouter.get('/:id', requirePermission('owners.view'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const owner = get<any>(db, `${OWNER_SELECT} WHERE o.id = ?`, [id]);
  if (!owner) throw new HttpError(404, 'Owner not found');
  const units = can(req.user, 'inventory.view')
    ? all<any>(db, `${UNIT_SELECT} WHERE u.owner_id = ? ORDER BY u.archived_at IS NOT NULL, u.updated_at DESC`, [id])
    : [];
  const tags = getTags(db, 'owner', [id]).get(id) ?? [];
  res.json({
    ...redactOwner(req.user, { ...owner, code: ownerCode(id), tags }),
    units: units.map((u) => ({ id: u.id, project: u.project, developer: u.developer, phase: u.phase, unit_number: u.unit_number, property_type: u.property_type, bua: u.bua, land_area: u.land_area, bedrooms: u.bedrooms, asking_price: u.asking_price, status: u.status, archived_at: u.archived_at, last_verified: u.last_verified })),
  });
});

ownersRouter.patch('/:id', requirePermission('owners.edit'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const before = get<any>(db, 'SELECT * FROM owners WHERE id = ?', [id]);
  if (!before) throw new HttpError(404, 'Owner not found');
  const data = withNorms(coerce(req.body ?? {}, OWNER_SPEC, true));
  if (!can(req.user, 'owners.contact')) {
    for (const k of ['primary_phone', 'secondary_phone', 'whatsapp', 'email', 'primary_phone_norm', 'secondary_phone_norm', 'whatsapp_norm']) delete data[k];
  }
  if (data.status === 'Archived' && !can(req.user, 'owners.delete')) throw new HttpError(403, "You don't have permission to archive owners");
  tx(db, () => {
    const keys = Object.keys(data);
    if (keys.length) {
      if (data.status === 'Archived' && !before.archived_at) {
        data.archived_at = nowIso();
      } else if (data.status && data.status !== 'Archived' && before.archived_at) {
        data.archived_at = null;
      }
      const setKeys = Object.keys(data);
      run(db, `UPDATE owners SET ${setKeys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...setKeys.map((k) => data[k]), nowIso(), id]);
      logChanges(db, req.user!, 'owner', id, data.name ?? before.name, before, data, OWNER_LOG);
      if (data.assigned_user_id && data.assigned_user_id !== before.assigned_user_id && data.assigned_user_id !== req.user!.id) {
        notify(db, data.assigned_user_id, 'assigned', `${req.user!.name} assigned owner ${data.name ?? before.name} to you`, `/owners/${id}`);
      }
    }
    if (Array.isArray(req.body?.tag_ids)) setTags(db, 'owner', id, idList(req.body.tag_ids));
  });
  res.json({ ok: true });
});

ownersRouter.post('/:id/contacted', requirePermission('owners.view'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const owner = get<any>(db, 'SELECT id, name FROM owners WHERE id = ?', [id]);
  if (!owner) throw new HttpError(404, 'Owner not found');
  const channel = req.body?.channel === 'whatsapp' ? 'WhatsApp' : 'phone';
  run(db, 'UPDATE owners SET last_contacted = ? WHERE id = ?', [nowIso(), id]);
  logActivity(db, { userId: req.user!.id, action: 'contacted', entityType: 'owner', entityId: id, label: owner.name, message: `contacted ${owner.name} by ${channel}` });
  res.json({ ok: true });
});

ownersRouter.post('/:id/archive', requirePermission('owners.delete'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const owner = get<any>(db, 'SELECT * FROM owners WHERE id = ?', [id]);
  if (!owner) throw new HttpError(404, 'Owner not found');
  run(db, "UPDATE owners SET status = 'Archived', archived_at = ?, updated_at = ? WHERE id = ?", [nowIso(), nowIso(), id]);
  logActivity(db, { userId: req.user!.id, action: 'archived', entityType: 'owner', entityId: id, label: owner.name, oldValue: owner.status, newValue: 'Archived', message: `archived owner ${owner.name}` });
  res.json({ ok: true });
});

ownersRouter.post('/:id/restore', requirePermission('owners.delete'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const owner = get<any>(db, 'SELECT * FROM owners WHERE id = ?', [id]);
  if (!owner) throw new HttpError(404, 'Owner not found');
  run(db, "UPDATE owners SET status = 'Active', archived_at = NULL, updated_at = ? WHERE id = ?", [nowIso(), id]);
  logActivity(db, { userId: req.user!.id, action: 'restored', entityType: 'owner', entityId: id, label: owner.name, message: `restored owner ${owner.name}` });
  res.json({ ok: true });
});

ownersRouter.delete('/:id', requirePermission('records.purge'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const owner = get<any>(db, 'SELECT * FROM owners WHERE id = ?', [id]);
  if (!owner) throw new HttpError(404, 'Owner not found');
  if (String(req.body?.confirm ?? '') !== owner.name) throw new HttpError(400, 'Type the owner name exactly to confirm permanent deletion');
  if (!owner.archived_at) throw new HttpError(400, 'Archive the owner before deleting permanently');
  tx(db, () => {
    run(db, 'UPDATE units SET owner_id = NULL WHERE owner_id = ?', [id]);
    deleteEntityFiles(db, 'owner', id);
    run(db, "DELETE FROM notes WHERE entity_type = 'owner' AND entity_id = ?", [id]);
    run(db, "DELETE FROM taggings WHERE entity_type = 'owner' AND entity_id = ?", [id]);
    run(db, 'DELETE FROM owners WHERE id = ?', [id]);
    logActivity(db, { userId: req.user!.id, action: 'purged', entityType: 'owner', entityId: id, label: owner.name, message: `permanently deleted owner ${owner.name}` });
  });
  res.json({ ok: true });
});
