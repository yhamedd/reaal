import { Router } from 'express';
import fs from 'node:fs';
import { all, get, run } from '../db.js';
import { HttpError, requireAuth, requirePermission } from '../auth.js';
import { intParam } from '../util.js';
import { getSettings, updateSettings } from '../settings.js';
import { logActivity } from '../activity.js';
import { MASTER_CATEGORIES, UNIT_STATUSES, OWNER_STATUSES, REQUIREMENT_STATUSES, PRIORITIES, FURNISHING, FILE_CATEGORIES } from '../../shared/constants.js';
import { DEFAULT_TEMPLATES, renderOffer, type TemplateDef } from '../services/offerText.js';
import { filePath } from './files.js';

export const settingsRouter = Router();
export const masterRouter = Router();
export const templatesRouter = Router();
export const publicRouter = Router();

// ---------------------------------------------------------------------------
// Public branding for the login screen
// ---------------------------------------------------------------------------

publicRouter.get('/branding', (req, res) => {
  const s = getSettings(req.db);
  res.json({ company_name: s.company.name, has_logo: !!s.company.logo_file_id });
});

publicRouter.get('/logo', (req, res) => {
  const s = getSettings(req.db);
  const f = s.company.logo_file_id ? get<any>(req.db, 'SELECT * FROM files WHERE id = ?', [s.company.logo_file_id]) : null;
  if (!f || !fs.existsSync(filePath(f.stored_name))) throw new HttpError(404, 'No logo');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Cache-Control', 'public, max-age=300');
  fs.createReadStream(filePath(f.stored_name)).pipe(res);
});

// ---------------------------------------------------------------------------
// System settings
// ---------------------------------------------------------------------------

settingsRouter.get('/', requirePermission('settings.manage'), (req, res) => {
  res.json(getSettings(req.db));
});

settingsRouter.patch('/', requirePermission('settings.manage'), (req, res) => {
  const before = getSettings(req.db);
  const after = updateSettings(req.db, req.body ?? {});
  const changed: string[] = [];
  for (const section of Object.keys(after) as (keyof typeof after)[]) {
    for (const [k, v] of Object.entries(after[section])) {
      if (JSON.stringify((before[section] as any)[k]) !== JSON.stringify(v)) changed.push(`${section}.${k}`);
    }
  }
  if (changed.length) {
    logActivity(req.db, { userId: req.user!.id, action: 'settings_changed', entityType: 'settings', label: 'System settings', newValue: changed.join(', '), message: `changed system settings (${changed.join(', ')})` });
  }
  res.json(after);
});

// ---------------------------------------------------------------------------
// Master data: developers, projects, dropdown values, tags
// ---------------------------------------------------------------------------

masterRouter.get('/', requireAuth, (req, res) => {
  const db = req.db;
  const values: Record<string, { id: number; value: string; active: number; sort: number }[]> = {};
  for (const c of MASTER_CATEGORIES) values[c.key] = [];
  for (const v of all<any>(db, 'SELECT * FROM master_values ORDER BY sort, value COLLATE NOCASE')) {
    (values[v.category] ??= []).push({ id: v.id, value: v.value, active: v.active, sort: v.sort });
  }
  res.json({
    developers: all(db, `SELECT d.*, (SELECT COUNT(*) FROM units u WHERE u.developer_id = d.id) AS unit_count FROM developers d ORDER BY name COLLATE NOCASE`),
    projects: all(
      db,
      `SELECT p.*, d.name AS developer, (SELECT COUNT(*) FROM units u WHERE u.project_id = p.id) AS unit_count
         FROM projects p LEFT JOIN developers d ON d.id = p.developer_id ORDER BY p.name COLLATE NOCASE`,
    ),
    values,
    categories: MASTER_CATEGORIES,
    tags: all(db, `SELECT t.*, (SELECT COUNT(*) FROM taggings tg WHERE tg.tag_id = t.id) AS usage FROM tags t ORDER BY name COLLATE NOCASE`),
    statuses: { unit: UNIT_STATUSES, owner: OWNER_STATUSES, requirement: REQUIREMENT_STATUSES },
    priorities: PRIORITIES,
    furnishing: FURNISHING,
    file_categories: FILE_CATEGORIES,
  });
});

function requireName(v: unknown, label = 'Name') {
  const s = String(v ?? '').trim();
  if (!s) throw new HttpError(400, `${label} is required`);
  if (s.length > 120) throw new HttpError(400, `${label} is too long`);
  return s;
}

function conflict(db: import('../db.js').DB, table: string, name: string, excludeId = 0) {
  const existing = get<any>(db, `SELECT id, name FROM ${table} WHERE name = ? COLLATE NOCASE AND id <> ?`, [name, excludeId]);
  if (existing) throw new HttpError(409, `“${existing.name}” already exists`);
}

masterRouter.post('/developers', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const name = requireName(req.body?.name);
  conflict(db, 'developers', name);
  const { lastId } = run(db, 'INSERT INTO developers (name) VALUES (?)', [name]);
  logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'developer', entityId: lastId, label: name, message: `added developer ${name}` });
  res.status(201).json({ id: lastId });
});

masterRouter.patch('/developers/:id', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const before = get<any>(db, 'SELECT * FROM developers WHERE id = ?', [id]);
  if (!before) throw new HttpError(404, 'Developer not found');
  if (req.body?.name !== undefined) {
    const name = requireName(req.body.name);
    conflict(db, 'developers', name, id);
    run(db, 'UPDATE developers SET name = ? WHERE id = ?', [name, id]);
    if (name !== before.name) logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'developer', entityId: id, label: name, oldValue: before.name, newValue: name, message: `renamed developer ${before.name} to ${name}` });
  }
  if (req.body?.active !== undefined) run(db, 'UPDATE developers SET active = ? WHERE id = ?', [req.body.active ? 1 : 0, id]);
  res.json({ ok: true });
});

masterRouter.delete('/developers/:id', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const d = get<any>(db, 'SELECT * FROM developers WHERE id = ?', [id]);
  if (!d) throw new HttpError(404, 'Developer not found');
  const inUse = get(db, 'SELECT 1 FROM units WHERE developer_id = ? UNION SELECT 1 FROM projects WHERE developer_id = ? UNION SELECT 1 FROM requirements WHERE developer_id = ?', [id, id, id]);
  if (inUse) {
    run(db, 'UPDATE developers SET active = 0 WHERE id = ?', [id]);
    return res.json({ ok: true, deactivated: true });
  }
  run(db, 'DELETE FROM developers WHERE id = ?', [id]);
  logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'developer', entityId: id, label: d.name, message: `removed developer ${d.name}` });
  res.json({ ok: true });
});

masterRouter.post('/projects', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const name = requireName(req.body?.name);
  conflict(db, 'projects', name);
  const developerId = Number(req.body?.developer_id) || null;
  if (developerId && !get(db, 'SELECT 1 FROM developers WHERE id = ?', [developerId])) throw new HttpError(400, 'Unknown developer');
  const { lastId } = run(db, 'INSERT INTO projects (name, developer_id, location) VALUES (?, ?, ?)', [name, developerId, req.body?.location ? String(req.body.location) : null]);
  logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'project', entityId: lastId, label: name, message: `added project ${name}` });
  res.status(201).json({ id: lastId });
});

masterRouter.patch('/projects/:id', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const before = get<any>(db, 'SELECT * FROM projects WHERE id = ?', [id]);
  if (!before) throw new HttpError(404, 'Project not found');
  if (req.body?.name !== undefined) {
    const name = requireName(req.body.name);
    conflict(db, 'projects', name, id);
    run(db, 'UPDATE projects SET name = ? WHERE id = ?', [name, id]);
    if (name !== before.name) logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'project', entityId: id, label: name, oldValue: before.name, newValue: name, message: `renamed project ${before.name} to ${name}` });
  }
  if (req.body?.developer_id !== undefined) {
    const developerId = Number(req.body.developer_id) || null;
    run(db, 'UPDATE projects SET developer_id = ? WHERE id = ?', [developerId, id]);
    // Keep units consistent with their project's developer
    if (developerId) run(db, 'UPDATE units SET developer_id = ? WHERE project_id = ?', [developerId, id]);
  }
  if (req.body?.location !== undefined) run(db, 'UPDATE projects SET location = ? WHERE id = ?', [req.body.location ? String(req.body.location) : null, id]);
  if (req.body?.active !== undefined) run(db, 'UPDATE projects SET active = ? WHERE id = ?', [req.body.active ? 1 : 0, id]);
  res.json({ ok: true });
});

masterRouter.delete('/projects/:id', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const p = get<any>(db, 'SELECT * FROM projects WHERE id = ?', [id]);
  if (!p) throw new HttpError(404, 'Project not found');
  if (get(db, 'SELECT 1 FROM units WHERE project_id = ?', [id])) {
    run(db, 'UPDATE projects SET active = 0 WHERE id = ?', [id]);
    return res.json({ ok: true, deactivated: true });
  }
  run(db, 'DELETE FROM projects WHERE id = ?', [id]);
  logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'project', entityId: id, label: p.name, message: `removed project ${p.name}` });
  res.json({ ok: true });
});

masterRouter.post('/values', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const category = String(req.body?.category ?? '');
  if (!MASTER_CATEGORIES.some((c) => c.key === category)) throw new HttpError(400, 'Unknown category');
  const value = requireName(req.body?.value, 'Value');
  if (get(db, 'SELECT 1 FROM master_values WHERE category = ? AND value = ? COLLATE NOCASE', [category, value])) throw new HttpError(409, `“${value}” already exists`);
  const sort = get<{ n: number }>(db, 'SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM master_values WHERE category = ?', [category])!.n;
  const { lastId } = run(db, 'INSERT INTO master_values (category, value, sort) VALUES (?, ?, ?)', [category, value, sort]);
  logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'master_value', entityId: lastId, label: value, message: `added ${value} to ${category.replace('_', ' ')}` });
  res.status(201).json({ id: lastId });
});

masterRouter.patch('/values/:id', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const v = get<any>(db, 'SELECT * FROM master_values WHERE id = ?', [id]);
  if (!v) throw new HttpError(404, 'Value not found');
  if (req.body?.value !== undefined) {
    const value = requireName(req.body.value, 'Value');
    if (get(db, 'SELECT 1 FROM master_values WHERE category = ? AND value = ? COLLATE NOCASE AND id <> ?', [v.category, value, id])) throw new HttpError(409, `“${value}” already exists`);
    run(db, 'UPDATE master_values SET value = ? WHERE id = ?', [value, id]);
    // Rename in place on records so data stays consistent
    const column = { property_type: 'property_type', finishing: 'finishing', source: 'source', view: 'view' }[v.category as string];
    if (column) run(db, `UPDATE units SET ${column} = ? WHERE ${column} = ? COLLATE NOCASE`, [value, v.value]);
    if (v.category === 'source') run(db, 'UPDATE owners SET source = ? WHERE source = ? COLLATE NOCASE', [value, v.value]);
    logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'master_value', entityId: id, label: value, oldValue: v.value, newValue: value, message: `renamed ${v.value} to ${value}` });
  }
  if (req.body?.active !== undefined) run(db, 'UPDATE master_values SET active = ? WHERE id = ?', [req.body.active ? 1 : 0, id]);
  if (req.body?.sort !== undefined) run(db, 'UPDATE master_values SET sort = ? WHERE id = ?', [Number(req.body.sort) || 0, id]);
  res.json({ ok: true });
});

masterRouter.delete('/values/:id', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const v = get<any>(db, 'SELECT * FROM master_values WHERE id = ?', [id]);
  if (!v) throw new HttpError(404, 'Value not found');
  run(db, 'DELETE FROM master_values WHERE id = ?', [id]);
  logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'master_value', entityId: id, label: v.value, message: `removed ${v.value} from ${v.category.replace('_', ' ')}` });
  res.json({ ok: true });
});

const TAG_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];

masterRouter.post('/tags', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const name = requireName(req.body?.name);
  conflict(db, 'tags', name);
  const color = TAG_COLORS.includes(req.body?.color) ? req.body.color : 'gray';
  const { lastId } = run(db, 'INSERT INTO tags (name, color) VALUES (?, ?)', [name, color]);
  logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'tag', entityId: lastId, label: name, message: `added tag ${name}` });
  res.status(201).json({ id: lastId });
});

masterRouter.patch('/tags/:id', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  if (!get(db, 'SELECT 1 FROM tags WHERE id = ?', [id])) throw new HttpError(404, 'Tag not found');
  if (req.body?.name !== undefined) {
    const name = requireName(req.body.name);
    conflict(db, 'tags', name, id);
    run(db, 'UPDATE tags SET name = ? WHERE id = ?', [name, id]);
  }
  if (req.body?.color !== undefined && TAG_COLORS.includes(req.body.color)) run(db, 'UPDATE tags SET color = ? WHERE id = ?', [req.body.color, id]);
  res.json({ ok: true });
});

masterRouter.delete('/tags/:id', requirePermission('masterdata.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const t = get<any>(db, 'SELECT * FROM tags WHERE id = ?', [id]);
  if (!t) throw new HttpError(404, 'Tag not found');
  run(db, 'DELETE FROM tags WHERE id = ?', [id]);
  logActivity(db, { userId: req.user!.id, action: 'masterdata_changed', entityType: 'tag', entityId: id, label: t.name, message: `removed tag ${t.name}` });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Offer templates
// ---------------------------------------------------------------------------

templatesRouter.get('/', requirePermission('templates.manage'), (req, res) => {
  res.json(all(req.db, 'SELECT * FROM offer_templates'));
});

templatesRouter.patch('/:key', requirePermission('templates.manage'), (req, res) => {
  const db = req.db;
  const key = String(req.params.key);
  const t = get<any>(db, 'SELECT * FROM offer_templates WHERE key = ?', [key]);
  if (!t) throw new HttpError(404, 'Template not found');
  const fields = ['name', 'description', 'header', 'unit_block', 'separator', 'footer'] as const;
  const updates: Record<string, any> = {};
  for (const f of fields) if (typeof req.body?.[f] === 'string') updates[f] = req.body[f].slice(0, 10_000);
  if (req.body?.include_owner !== undefined) updates.include_owner = req.body.include_owner ? 1 : 0;
  if (updates.name !== undefined && !updates.name.trim()) throw new HttpError(400, 'Template name is required');
  const keys = Object.keys(updates);
  if (keys.length) {
    run(db, `UPDATE offer_templates SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE key = ?`, [...keys.map((k) => updates[k]), key]);
    logActivity(db, { userId: req.user!.id, action: 'template_changed', entityType: 'template', label: t.name, message: `edited the ${t.name} offer template` });
  }
  res.json({ ok: true });
});

templatesRouter.post('/:key/reset', requirePermission('templates.manage'), (req, res) => {
  const db = req.db;
  const def = DEFAULT_TEMPLATES.find((t) => t.key === req.params.key);
  if (!def) throw new HttpError(404, 'Template not found');
  run(db, `UPDATE offer_templates SET name = ?, description = ?, header = ?, unit_block = ?, separator = ?, footer = ?, include_owner = ?, updated_at = datetime('now') WHERE key = ?`, [
    def.name,
    def.description ?? '',
    def.header,
    def.unit_block,
    def.separator,
    def.footer,
    def.include_owner ? 1 : 0,
    def.key,
  ]);
  logActivity(db, { userId: req.user!.id, action: 'template_changed', entityType: 'template', label: def.name, message: `reset the ${def.name} offer template to default` });
  res.json({ ok: true });
});

/** Renders a draft template against sample data so admins can preview edits before saving. */
templatesRouter.post('/preview', requirePermission('templates.manage'), (req, res) => {
  const t = req.body as TemplateDef;
  const sample = [
    { id: 12, developer: 'Emaar Misr', project: 'Mivida', phase: 'Parcel 5', unit_number: 'A12', property_type: 'Standalone Villa', bua: 350, land_area: 500, bedrooms: 4, bathrooms: 4, finishing: 'Fully Finished', delivery: 'Ready to move', asking_price: 42_000_000, original_price: 30_000_000, paid_amount: 18_000_000, remaining_amount: 12_000_000, status: 'Available', owner_name: 'Ahmed Mohamed', owner_phone: '01012345678' },
    { id: 21, developer: 'Emaar Misr', project: 'Mivida', phase: 'Parcel 7', unit_number: 'C21', property_type: 'Townhouse', bua: 260, land_area: 300, bedrooms: 3, bathrooms: 3, finishing: 'Semi Finished', delivery: '2027', asking_price: 31_500_000, status: 'Available', owner_name: 'Mona Adel', owner_phone: '01122334455' },
  ];
  const s = getSettings(req.db);
  const content = renderOffer({
    template: { key: 'preview', name: 'Preview', header: String(t.header ?? ''), unit_block: String(t.unit_block ?? ''), separator: String(t.separator ?? ''), footer: String(t.footer ?? ''), include_owner: !!t.include_owner },
    units: req.body?.single ? sample.slice(0, 1) : sample,
    currency: s.general.currency,
    global: { company_name: s.company.name, company_phone: s.company.phone, agent_name: req.user!.name, agent_phone: req.user!.phone || s.company.phone, client_name: 'Mr. Karim' },
    includeOwner: !!t.include_owner,
  });
  res.json({ content });
});
