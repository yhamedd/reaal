import { Router } from 'express';
import { all, get, run, tx, nowIso, today, type DB } from '../db.js';
import { HttpError, can, requirePermission, type AuthUser } from '../auth.js';
import { coerce, getTags, idList, intParam, maskEmail, maskPhone, normalizeUnitNumber, setTags } from '../util.js';
import { logActivity, logChanges, notify, notifyPermission, unitCode, unitLabel } from '../activity.js';
import {
  UNIT_LOG_FIELDS,
  UNIT_SELECT,
  UNIT_SORTS,
  UNIT_SPEC,
  buildUnitWhere,
  findUnitDuplicates,
  getUnitRow,
  orderBy,
  parseFilters,
  parseSort,
} from '../services/units.js';
import { canonicalValue } from '../services/masterData.js';
import { notifyNewMatches } from '../services/matching.js';
import { getSettings } from '../settings.js';
import { OWNER_SPEC, findOwnerDuplicates, insertOwner } from './owners.js';
import { deleteEntityFiles } from './files.js';

export const unitsRouter = Router();

export function presentUnit(user: AuthUser | undefined, row: any, tags?: any[]) {
  if (!row) return row;
  const out = { ...row, code: unitCode(row.id), tags: tags ?? row.tags ?? [] };
  if (!can(user, 'owners.contact')) {
    out.owner_phone = maskPhone(out.owner_phone);
    out.owner_secondary_phone = maskPhone(out.owner_secondary_phone);
    out.owner_whatsapp = maskPhone(out.owner_whatsapp);
    out.owner_email = maskEmail(out.owner_email);
    out.contact_hidden = true;
  }
  if (!can(user, 'owners.view')) {
    out.owner_name = out.owner_id ? 'Restricted' : null;
    out.owner_phone = null;
    out.owner_secondary_phone = null;
    out.owner_whatsapp = null;
    out.owner_email = null;
  }
  delete out.unit_number_norm;
  delete out.verification_notified_level;
  return out;
}

export async function queryUnits(db: DB, user: AuthUser, rawFilters: unknown, rawSort: unknown, limit: number, offset = 0) {
  const s = (await getSettings(db)).verification;
  const filters = parseFilters(rawFilters);
  const { where, params } = buildUnitWhere(filters, { userId: user.id, thresholds: { attention: s.attention_days, outdated: s.outdated_days } });
  const total = (await get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM units u LEFT JOIN owners o ON o.id = u.owner_id LEFT JOIN developers d ON d.id = u.developer_id
       LEFT JOIN projects p ON p.id = u.project_id LEFT JOIN users a ON a.id = u.assigned_user_id ${where}`,
    params,
  ))!.n;
  const p = Array.isArray(params) ? params : [];
  const rows = await all<any>(db, `${UNIT_SELECT} ${where} ${orderBy(parseSort(rawSort), UNIT_SORTS, 'u.updated_at DESC, u.id DESC')} LIMIT ? OFFSET ?`, [...p, limit, offset]);
  const tags = await getTags(db, 'unit', rows.map((r) => r.id));
  return { total, rows: rows.map((r) => presentUnit(user, r, tags.get(r.id) ?? [])) };
}

/** Normalises project/developer/type consistency before writing. */
async function prepareUnitData(db: DB, data: Record<string, any>, before?: any) {
  if ('project_id' in data && data.project_id) {
    const project = await get<any>(db, 'SELECT id, developer_id FROM projects WHERE id = ?', [data.project_id]);
    if (!project) throw new HttpError(400, 'Unknown project', { fields: { project_id: 'Unknown project' } });
    if (project.developer_id && (!('developer_id' in data) || !data.developer_id || data.project_id !== before?.project_id)) {
      data.developer_id = project.developer_id;
    }
  }
  if ('developer_id' in data && data.developer_id && !await get(db, 'SELECT 1 FROM developers WHERE id = ?', [data.developer_id])) {
    throw new HttpError(400, 'Unknown developer', { fields: { developer_id: 'Unknown developer' } });
  }
  if ('owner_id' in data && data.owner_id && !await get(db, 'SELECT 1 FROM owners WHERE id = ?', [data.owner_id])) {
    throw new HttpError(400, 'Unknown owner', { fields: { owner_id: 'Unknown owner' } });
  }
  if ('assigned_user_id' in data && data.assigned_user_id && !await get(db, 'SELECT 1 FROM users WHERE id = ?', [data.assigned_user_id])) {
    throw new HttpError(400, 'Unknown agent', { fields: { assigned_user_id: 'Unknown agent' } });
  }
  if (data.property_type) data.property_type = await canonicalValue(db, 'property_type', data.property_type) ?? data.property_type;
  if (data.finishing) data.finishing = await canonicalValue(db, 'finishing', data.finishing) ?? data.finishing;
  if (data.view) data.view = await canonicalValue(db, 'view', data.view) ?? data.view;
  if ('unit_number' in data) data.unit_number_norm = normalizeUnitNumber(data.unit_number);
  return data;
}

export async function insertUnit(db: DB, user: AuthUser, data: Record<string, any>) {
  await prepareUnitData(db, data);
  const cols = [...Object.keys(UNIT_SPEC), 'unit_number_norm'].filter((c) => c in data && data[c] !== undefined);
  if (!data.status) {
    cols.push('status');
    data.status = 'Available';
  }
  if (!cols.includes('assigned_user_id')) {
    cols.push('assigned_user_id');
    data.assigned_user_id = user.id;
  }
  const { lastId } = await run(
    db,
    `INSERT INTO units (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
    [...cols.map((c) => data[c] ?? null), user.id],
  );
  return lastId;
}

async function applyUnitPatch(db: DB, user: AuthUser, id: number, patch: Record<string, any>) {
  const before = await get<any>(db, 'SELECT * FROM units WHERE id = ?', [id]);
  if (!before) throw new HttpError(404, 'Unit not found');
  const data = await prepareUnitData(db, { ...patch }, before);
  if (data.status === 'Archived' && before.status !== 'Archived' && !can(user, 'inventory.delete')) {
    throw new HttpError(403, "You don't have permission to archive units");
  }
  if (data.status === 'Archived' && !before.archived_at) data.archived_at = nowIso();
  if (data.status && data.status !== 'Archived' && before.archived_at) data.archived_at = null;
  const keys = Object.keys(data);
  if (!keys.length) return before;
  const label = await unitLabel(db, id);
  await run(db, `UPDATE units SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => data[k]), nowIso(), id]);
  const displayBefore = { ...before };
  const displayAfter: Record<string, any> = { ...data };
  // Log names rather than ids for relational fields
  const nameOf = async (table: string, v: any) => (v ? (await get<any>(db, `SELECT name FROM ${table} WHERE id = ?`, [v]))?.name ?? v : null);
  for (const [field, table] of [['project_id', 'projects'], ['developer_id', 'developers'], ['owner_id', 'owners'], ['assigned_user_id', 'users']] as const) {
    if (field in displayAfter) {
      displayBefore[field] = await nameOf(table, before[field]);
      displayAfter[field] = await nameOf(table, data[field]);
    }
  }
  await logChanges(db, user, 'unit', id, label, displayBefore, displayAfter, UNIT_LOG_FIELDS);
  if (data.assigned_user_id && data.assigned_user_id !== before.assigned_user_id && data.assigned_user_id !== user.id) {
    await notify(db, data.assigned_user_id, 'assigned', `${user.name} assigned ${label} to you`, `/inventory/${id}`);
  }
  if ('last_verified' in data) await run(db, 'UPDATE units SET verification_notified_level = NULL WHERE id = ?', [id]);
  const after = await get<any>(db, 'SELECT status FROM units WHERE id = ?', [id]);
  if (after?.status === 'Available') await notifyNewMatches(db, id, user.id);
  return before;
}

unitsRouter.get('/', requirePermission('inventory.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 5000, 20000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json(await queryUnits(req.db, req.user!, req.query.filters, req.query.sort, limit, offset));
});

unitsRouter.get('/lookup', requirePermission('inventory.view'), async (req, res) => {
  const { rows } = await queryUnits(req.db, req.user!, { q: String(req.query.q ?? '') }, [], 20);
  res.json(rows);
});

unitsRouter.post('/check-duplicates', requirePermission('inventory.view'), async (req, res) => {
  const dups = await findUnitDuplicates(req.db, req.body ?? {}, Number(req.body?.exclude_id) || 0);
  res.json({ duplicates: dups.map((d) => presentUnit(req.user, d)) });
});

unitsRouter.post('/', requirePermission('inventory.create'), async (req, res) => {
  const db = req.db;
  const body = req.body ?? {};
  const data = coerce(body, UNIT_SPEC, false);
  let newOwner: Record<string, any> | null = null;
  if (body.new_owner && !data.owner_id) {
    if (!can(req.user, 'owners.create')) throw new HttpError(403, "You don't have permission to create owners");
    newOwner = coerce(body.new_owner, OWNER_SPEC, false);
  }
  if (data.project_id) {
    const p = await get<any>(db, 'SELECT developer_id FROM projects WHERE id = ?', [data.project_id]);
    if (p?.developer_id && !data.developer_id) data.developer_id = p.developer_id;
  }
  const dups = await findUnitDuplicates(db, data);
  const ownerDups = newOwner ? await findOwnerDuplicates(db, newOwner) : [];
  if ((dups.length || ownerDups.length) && !body.confirm_duplicate) {
    return res.status(409).json({
      error: 'Possible duplicate found',
      duplicates: dups.map((d) => presentUnit(req.user, d)),
      owner_duplicates: ownerDups.map((o) => ({ id: o.id, name: o.name, reasons: o.reasons, unit_count: o.unit_count })),
    });
  }
  const id = await tx(db, async (db) => {
    if (newOwner) {
      data.owner_id = await insertOwner(db, req.user!, newOwner);
      await logActivity(db, { userId: req.user!.id, action: 'created', entityType: 'owner', entityId: data.owner_id, label: newOwner.name, message: `added a new owner ${newOwner.name}` });
    }
    const id = await insertUnit(db, req.user!, data);
    const label = await unitLabel(db, id);
    if (Array.isArray(body.tag_ids)) await setTags(db, 'unit', id, idList(body.tag_ids));
    await logActivity(db, { userId: req.user!.id, action: 'created', entityType: 'unit', entityId: id, label, message: `added ${label}` });
    if (dups.length) {
      await logActivity(db, {
        userId: req.user!.id,
        action: 'duplicate_acknowledged',
        entityType: 'unit',
        entityId: id,
        label,
        newValue: dups.map((d) => d.id).join(','),
        message: `created ${label} despite a possible duplicate (${dups.map((d) => unitCode(d.id)).join(', ')})`,
      });
      await notifyPermission(db, 'users.manage', 'duplicate', `${req.user!.name} created a possible duplicate unit: ${label}`, `/inventory/${id}`, req.user!.id);
    }
    if (data.assigned_user_id && data.assigned_user_id !== req.user!.id) {
      await notify(db, data.assigned_user_id, 'assigned', `${req.user!.name} assigned ${label} to you`, `/inventory/${id}`);
    }
    if ((data.status ?? 'Available') === 'Available') await notifyNewMatches(db, id, req.user!.id);
    return id;
  });
  res.status(201).json({ id, owner_id: data.owner_id ?? null });
});

unitsRouter.get('/:id', requirePermission('inventory.view'), async (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const row = await getUnitRow(db, id);
  if (!row) throw new HttpError(404, 'Unit not found');
  const files = await all<any>(db, "SELECT f.*, u.name AS uploaded_by_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE entity_type = 'unit' AND entity_id = ? ORDER BY created_at", [id]);
  const offers = await all<any>(
    db,
    `SELECT o.id, o.template, o.client_name, o.created_at, us.name AS created_by_name FROM offers o
       JOIN offer_units ou ON ou.offer_id = o.id LEFT JOIN users us ON us.id = o.created_by
      WHERE ou.unit_id = ? ORDER BY o.created_at DESC LIMIT 20`,
    [id],
  );
  const tags = (await getTags(db, 'unit', [id])).get(id) ?? [];
  res.json({ ...presentUnit(req.user, row, tags), files, offers });
});

unitsRouter.patch('/:id', requirePermission('inventory.edit'), async (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const patch = coerce(req.body ?? {}, UNIT_SPEC, true);
  await tx(db, async (db) => {
    await applyUnitPatch(db, req.user!, id, patch);
    if (Array.isArray(req.body?.tag_ids)) await setTags(db, 'unit', id, idList(req.body.tag_ids));
  });
  const tags = (await getTags(db, 'unit', [id])).get(id) ?? [];
  res.json(presentUnit(req.user, await getUnitRow(db, id), tags));
});

unitsRouter.post('/bulk', requirePermission('inventory.edit', 'inventory.bulk_edit'), async (req, res) => {
  const db = req.db;
  const ids = idList(req.body?.ids);
  if (!ids.length) throw new HttpError(400, 'Select at least one unit');
  if (ids.length > 5000) throw new HttpError(400, 'Too many units in one update');
  const patch = coerce(req.body?.patch ?? {}, UNIT_SPEC, true);
  const addTags = idList(req.body?.add_tag_ids);
  if (!Object.keys(patch).length && !addTags.length) throw new HttpError(400, 'Nothing to update');
  await tx(db, async (db) => {
    for (const id of ids) {
      if (Object.keys(patch).length) await applyUnitPatch(db, req.user!, id, patch);
      for (const t of addTags) await run(db, "INSERT OR IGNORE INTO taggings (tag_id, entity_type, entity_id) VALUES (?, 'unit', ?)", [t, id]);
    }
    await logActivity(db, {
      userId: req.user!.id,
      action: 'bulk_updated',
      entityType: 'unit',
      message: `bulk updated ${ids.length} unit${ids.length === 1 ? '' : 's'} (${[...Object.keys(patch).map((k) => UNIT_SPEC[k]?.label ?? k), ...(addTags.length ? ['tags'] : [])].join(', ')})`,
    });
  });
  res.json({ ok: true, updated: ids.length });
});

unitsRouter.post('/verify', requirePermission('inventory.edit'), async (req, res) => {
  const db = req.db;
  const ids = idList(req.body?.ids);
  if (!ids.length) throw new HttpError(400, 'Select at least one unit');
  const d = today();
  await tx(db, async (db) => {
    for (const id of ids) {
      const before = await get<any>(db, 'SELECT last_verified FROM units WHERE id = ?', [id]);
      if (!before) continue;
      await run(db, 'UPDATE units SET last_verified = ?, verification_notified_level = NULL, updated_at = ? WHERE id = ?', [d, nowIso(), id]);
      await logActivity(db, { userId: req.user!.id, action: 'verified', entityType: 'unit', entityId: id, label: await unitLabel(db, id), field: 'last_verified', oldValue: before.last_verified, newValue: d, message: `marked ${await unitLabel(db, id)} as verified` });
    }
  });
  res.json({ ok: true, last_verified: d });
});

unitsRouter.post('/:id/archive', requirePermission('inventory.delete'), async (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  await tx(db, async (db) => await applyUnitPatch(db, req.user!, id, { status: 'Archived' }));
  res.json({ ok: true });
});

unitsRouter.post('/:id/restore', requirePermission('inventory.delete'), async (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  await tx(db, async (db) => await applyUnitPatch(db, req.user!, id, { status: 'Pending Verification' }));
  res.json({ ok: true });
});

unitsRouter.delete('/:id', requirePermission('records.purge'), async (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const unit = await get<any>(db, 'SELECT * FROM units WHERE id = ?', [id]);
  if (!unit) throw new HttpError(404, 'Unit not found');
  if (!unit.archived_at) throw new HttpError(400, 'Archive the unit before deleting permanently');
  const label = await unitLabel(db, id);
  if (String(req.body?.confirm ?? '') !== unitCode(id)) throw new HttpError(400, `Type ${unitCode(id)} to confirm permanent deletion`);
  if (await get(db, 'SELECT 1 FROM offer_units WHERE unit_id = ?', [id]) && !req.body?.force) {
    throw new HttpError(400, 'This unit appears in saved offers. Keeping it archived preserves offer history.');
  }
  await tx(db, async (db) => {
    await deleteEntityFiles(db, 'unit', id);
    await run(db, "DELETE FROM notes WHERE entity_type = 'unit' AND entity_id = ?", [id]);
    await run(db, "DELETE FROM taggings WHERE entity_type = 'unit' AND entity_id = ?", [id]);
    // Explicit cleanup: hosted libSQL connections don't guarantee foreign-key cascades.
    await run(db, 'DELETE FROM offer_units WHERE unit_id = ?', [id]);
    await run(db, 'DELETE FROM requirement_exclusions WHERE unit_id = ?', [id]);
    await run(db, 'DELETE FROM requirement_match_seen WHERE unit_id = ?', [id]);
    await run(db, 'DELETE FROM units WHERE id = ?', [id]);
    await logActivity(db, { userId: req.user!.id, action: 'purged', entityType: 'unit', entityId: id, label, message: `permanently deleted ${label}` });
  });
  res.json({ ok: true });
});
