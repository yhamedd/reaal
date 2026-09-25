import { Router, type Response } from 'express';
import { all } from '../db.js';
import { HttpError, can, requirePermission } from '../auth.js';
import { idList, maskEmail, maskPhone } from '../util.js';
import { buildCsv, buildXlsx, type ExportColumn } from '../services/spreadsheet.js';
import { queryUnits } from './units.js';
import { logActivity, ownerCode, requirementCode } from '../activity.js';
import { getSettings } from '../settings.js';

export const exportsRouter = Router();

export const UNIT_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'code', header: 'Unit ID', width: 10 },
  { key: 'owner_name', header: 'Owner', width: 22 },
  { key: 'owner_phone', header: 'Phone', width: 16 },
  { key: 'developer', header: 'Developer', width: 16 },
  { key: 'project', header: 'Project', width: 18 },
  { key: 'phase', header: 'Phase' },
  { key: 'unit_number', header: 'Unit Number' },
  { key: 'property_type', header: 'Property Type', width: 16 },
  { key: 'bua', header: 'BUA', type: 'number' },
  { key: 'land_area', header: 'Land', type: 'number' },
  { key: 'bedrooms', header: 'Bedrooms', type: 'number' },
  { key: 'bathrooms', header: 'Bathrooms', type: 'number' },
  { key: 'floors', header: 'Floors', type: 'number' },
  { key: 'finishing', header: 'Finishing', width: 16 },
  { key: 'furnished', header: 'Furnishing' },
  { key: 'view', header: 'View' },
  { key: 'location', header: 'Location', width: 20 },
  { key: 'delivery', header: 'Delivery' },
  { key: 'asking_price', header: 'Asking Price', type: 'money', width: 16 },
  { key: 'original_price', header: 'Original Price', type: 'money', width: 16 },
  { key: 'paid_amount', header: 'Paid Amount', type: 'money', width: 16 },
  { key: 'remaining_amount', header: 'Remaining Amount', type: 'money', width: 16 },
  { key: 'maintenance', header: 'Maintenance', type: 'money' },
  { key: 'payment_notes', header: 'Payment Notes', width: 24 },
  { key: 'status', header: 'Status', width: 14 },
  { key: 'agent_name', header: 'Assigned Agent', width: 18 },
  { key: 'source', header: 'Source' },
  { key: 'tag_names', header: 'Tags', width: 20 },
  { key: 'last_verified', header: 'Last Verified', width: 14 },
  { key: 'created_at', header: 'Created At', width: 18 },
  { key: 'updated_at', header: 'Updated At', width: 18 },
];

async function send(res: Response, format: string, name: string, columns: ExportColumn[], rows: Record<string, any>[]) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.csv"`);
    return res.send(buildCsv(columns, rows));
  }
  const buf = await buildXlsx(name, columns, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.xlsx"`);
  res.send(buf);
}

function logExport(req: Express.Request, entity: string, count: number, scope: string, format: string) {
  const threshold = getSettings(req.db).general.export_log_threshold;
  if (count < threshold) return;
  logActivity(req.db, {
    userId: req.user!.id,
    action: 'exported',
    entityType: entity,
    newValue: count,
    message: `exported ${count} ${entity} record${count === 1 ? '' : 's'} (${scope}, ${format.toUpperCase()})`,
  });
}

exportsRouter.get('/units', requirePermission('inventory.view', 'inventory.export'), async (req, res) => {
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const ids = idList(req.query.ids);
  let rows: any[];
  let scope: string;
  if (ids.length) {
    rows = queryUnits(req.db, req.user!, { include_archived: true }, req.query.sort, 50000).rows.filter((r) => ids.includes(r.id));
    scope = 'selected rows';
  } else {
    const filters = req.query.filters ? String(req.query.filters) : '';
    rows = queryUnits(req.db, req.user!, filters || {}, req.query.sort, 50000).rows;
    scope = filters && filters !== '{}' ? 'filtered inventory' : 'entire inventory';
  }
  const wanted = String(req.query.columns ?? '').split(',').filter(Boolean);
  const columns = wanted.length ? UNIT_EXPORT_COLUMNS.filter((c) => wanted.includes(c.key) || c.key === 'code') : UNIT_EXPORT_COLUMNS;
  const out = rows.map((r) => ({ ...r, tag_names: (r.tags ?? []).map((t: any) => t.name).join(', ') }));
  logExport(req, 'inventory', out.length, scope, format);
  await send(res, format, 'inventory', columns, out);
});

exportsRouter.get('/owners', requirePermission('owners.view', 'owners.export'), async (req, res) => {
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const contact = can(req.user, 'owners.contact');
  const ids = idList(req.query.ids);
  const rows = all<any>(
    req.db,
    `SELECT o.*, a.name AS agent_name, (SELECT COUNT(*) FROM units u WHERE u.owner_id = o.id AND u.archived_at IS NULL) AS unit_count,
            (SELECT group_concat(t.name, ', ') FROM taggings tg JOIN tags t ON t.id = tg.tag_id WHERE tg.entity_type = 'owner' AND tg.entity_id = o.id) AS tag_names
       FROM owners o LEFT JOIN users a ON a.id = o.assigned_user_id
      ${ids.length ? `WHERE o.id IN (${ids.map(() => '?').join(',')})` : req.query.include_archived === '1' ? '' : "WHERE o.status <> 'Archived'"}
      ORDER BY o.name COLLATE NOCASE`,
    ids,
  ).map((o) => ({
    ...o,
    code: ownerCode(o.id),
    primary_phone: contact ? o.primary_phone : maskPhone(o.primary_phone),
    secondary_phone: contact ? o.secondary_phone : maskPhone(o.secondary_phone),
    whatsapp: contact ? o.whatsapp : maskPhone(o.whatsapp),
    email: contact ? o.email : maskEmail(o.email),
  }));
  const columns: ExportColumn[] = [
    { key: 'code', header: 'Owner ID' },
    { key: 'name', header: 'Full Name', width: 24 },
    { key: 'primary_phone', header: 'Primary Phone', width: 16 },
    { key: 'secondary_phone', header: 'Secondary Phone', width: 16 },
    { key: 'whatsapp', header: 'WhatsApp', width: 16 },
    { key: 'email', header: 'Email', width: 24 },
    { key: 'agent_name', header: 'Assigned Agent', width: 18 },
    { key: 'source', header: 'Source' },
    { key: 'status', header: 'Status' },
    { key: 'unit_count', header: 'Units Owned', type: 'number' },
    { key: 'tag_names', header: 'Tags', width: 20 },
    { key: 'last_contacted', header: 'Last Contacted', width: 18 },
    { key: 'created_at', header: 'Created', width: 18 },
    { key: 'updated_at', header: 'Last Updated', width: 18 },
  ];
  logExport(req, 'owner', rows.length, ids.length ? 'selected rows' : 'owner database', format);
  await send(res, format, 'owners', columns, rows);
});

exportsRouter.get('/requirements', requirePermission('requirements.view', 'requirements.export'), async (req, res) => {
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const contact = can(req.user, 'owners.contact');
  const projects = new Map(all<any>(req.db, 'SELECT id, name FROM projects').map((p) => [p.id, p.name]));
  const rows = all<any>(
    req.db,
    `SELECT r.*, a.name AS agent_name, d.name AS developer FROM requirements r
       LEFT JOIN users a ON a.id = r.assigned_user_id LEFT JOIN developers d ON d.id = r.developer_id
      WHERE r.archived_at IS NULL ORDER BY r.created_at DESC`,
  ).map((r) => ({
    ...r,
    code: requirementCode(r.id),
    phone: contact ? r.phone : maskPhone(r.phone),
    whatsapp: contact ? r.whatsapp : maskPhone(r.whatsapp),
    projects: (JSON.parse(r.preferred_project_ids || '[]') as number[]).map((id) => projects.get(id)).filter(Boolean).join(', '),
    types: (JSON.parse(r.property_types || '[]') as string[]).join(', '),
  }));
  const columns: ExportColumn[] = [
    { key: 'code', header: 'Request ID' },
    { key: 'client_name', header: 'Client Name', width: 22 },
    { key: 'phone', header: 'Phone', width: 16 },
    { key: 'whatsapp', header: 'WhatsApp', width: 16 },
    { key: 'agent_name', header: 'Assigned Agent', width: 18 },
    { key: 'developer', header: 'Developer' },
    { key: 'projects', header: 'Preferred Projects', width: 24 },
    { key: 'types', header: 'Property Type', width: 18 },
    { key: 'min_bua', header: 'Minimum BUA', type: 'number' },
    { key: 'max_bua', header: 'Maximum BUA', type: 'number' },
    { key: 'min_bedrooms', header: 'Minimum Bedrooms', type: 'number' },
    { key: 'min_price', header: 'Minimum Price', type: 'money', width: 16 },
    { key: 'max_price', header: 'Maximum Price', type: 'money', width: 16 },
    { key: 'finishing', header: 'Finishing' },
    { key: 'delivery_preference', header: 'Delivery Preference' },
    { key: 'priority', header: 'Priority' },
    { key: 'status', header: 'Status' },
    { key: 'created_at', header: 'Created', width: 18 },
  ];
  logExport(req, 'request', rows.length, 'requests', format);
  await send(res, format, 'requests', columns, rows);
});

exportsRouter.use((_req, _res, next) => next(new HttpError(404, 'Unknown export')));
