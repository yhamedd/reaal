import { all, get, type DB, type Params } from '../db.js';
import type { UnitFilters, SortSpec } from '../../shared/filters.js';
import { normalizePhone } from '../../shared/phone.js';
import { UNIT_STATUSES, FURNISHING } from '../../shared/constants.js';
import { likeEscape, normalizeUnitNumber, type FieldSpec } from '../util.js';
import type { FieldMeta } from '../activity.js';
import { money } from '../activity.js';

export const UNIT_SPEC: Record<string, FieldSpec> = {
  owner_id: { type: 'id', label: 'Owner' },
  developer_id: { type: 'id', label: 'Developer' },
  project_id: { type: 'id', label: 'Project' },
  phase: { type: 'text', label: 'Phase', max: 100 },
  unit_number: { type: 'text', label: 'Unit number', max: 100 },
  property_type: { type: 'text', label: 'Property type', max: 100 },
  bua: { type: 'number', label: 'BUA' },
  land_area: { type: 'number', label: 'Land area' },
  bedrooms: { type: 'int', label: 'Bedrooms' },
  bathrooms: { type: 'int', label: 'Bathrooms' },
  floors: { type: 'int', label: 'Floors' },
  finishing: { type: 'text', label: 'Finishing', max: 100 },
  furnished: { type: 'enum', label: 'Furnishing', values: FURNISHING },
  view: { type: 'text', label: 'View', max: 100 },
  location: { type: 'text', label: 'Location', max: 300 },
  delivery: { type: 'text', label: 'Delivery', max: 100 },
  asking_price: { type: 'number', label: 'Asking price' },
  original_price: { type: 'number', label: 'Original price' },
  paid_amount: { type: 'number', label: 'Paid amount' },
  remaining_amount: { type: 'number', label: 'Remaining amount' },
  maintenance: { type: 'number', label: 'Maintenance' },
  payment_notes: { type: 'text', label: 'Payment notes', max: 2000 },
  status: { type: 'enum', label: 'Status', values: UNIT_STATUSES },
  assigned_user_id: { type: 'id', label: 'Assigned agent' },
  source: { type: 'text', label: 'Source', max: 100 },
  last_verified: { type: 'date', label: 'Last verified' },
};

export const UNIT_LOG_FIELDS: Record<string, FieldMeta> = Object.fromEntries(
  Object.entries(UNIT_SPEC).map(([k, f]) => [
    k,
    { label: f.label, format: ['asking_price', 'original_price', 'paid_amount', 'remaining_amount', 'maintenance'].includes(k) ? money : undefined },
  ]),
);

export const UNIT_SELECT = `
  SELECT u.*,
         o.name AS owner_name, o.primary_phone AS owner_phone, o.secondary_phone AS owner_secondary_phone,
         o.whatsapp AS owner_whatsapp, o.email AS owner_email, o.status AS owner_status,
         d.name AS developer, p.name AS project,
         a.name AS agent_name, a.phone AS agent_phone, cb.name AS created_by_name,
         (SELECT COUNT(*) FROM files f WHERE f.entity_type = 'unit' AND f.entity_id = u.id AND f.category = 'image') AS image_count
    FROM units u
    LEFT JOIN owners o ON o.id = u.owner_id
    LEFT JOIN developers d ON d.id = u.developer_id
    LEFT JOIN projects p ON p.id = u.project_id
    LEFT JOIN users a ON a.id = u.assigned_user_id
    LEFT JOIN users cb ON cb.id = u.created_by`;

export const UNIT_SORTS: Record<string, string> = {
  id: 'u.id',
  owner_name: 'o.name COLLATE NOCASE',
  owner_phone: 'o.primary_phone',
  developer: 'd.name COLLATE NOCASE',
  project: 'p.name COLLATE NOCASE',
  phase: 'u.phase COLLATE NOCASE',
  unit_number: 'u.unit_number COLLATE NOCASE',
  property_type: 'u.property_type COLLATE NOCASE',
  bua: 'u.bua',
  land_area: 'u.land_area',
  bedrooms: 'u.bedrooms',
  bathrooms: 'u.bathrooms',
  floors: 'u.floors',
  finishing: 'u.finishing',
  furnished: 'u.furnished',
  view: 'u.view',
  location: 'u.location',
  delivery: 'u.delivery',
  asking_price: 'u.asking_price',
  original_price: 'u.original_price',
  paid_amount: 'u.paid_amount',
  remaining_amount: 'u.remaining_amount',
  maintenance: 'u.maintenance',
  status: 'u.status',
  agent_name: 'a.name COLLATE NOCASE',
  source: 'u.source',
  last_verified: 'u.last_verified',
  created_at: 'u.created_at',
  updated_at: 'u.updated_at',
};

function inList(col: string, values: unknown[], params: unknown[]) {
  params.push(...values);
  return `${col} IN (${values.map(() => '?').join(',')})`;
}

export function buildUnitWhere(
  f: UnitFilters,
  ctx: { userId: number; thresholds: { attention: number; outdated: number } },
): { where: string; params: Params } {
  const clauses: string[] = [];
  const params: any[] = [];

  if (!f.include_archived && !(f.status ?? []).includes('Archived')) clauses.push("u.archived_at IS NULL AND u.status <> 'Archived'");

  if (f.q?.trim()) {
    const q = f.q.trim();
    const like = `%${likeEscape(q)}%`;
    const parts = [
      "p.name LIKE ? ESCAPE '\\'",
      "d.name LIKE ? ESCAPE '\\'",
      "u.unit_number LIKE ? ESCAPE '\\'",
      "u.phase LIKE ? ESCAPE '\\'",
      "u.property_type LIKE ? ESCAPE '\\'",
      "o.name LIKE ? ESCAPE '\\'",
      "a.name LIKE ? ESCAPE '\\'",
      "u.location LIKE ? ESCAPE '\\'",
    ];
    params.push(like, like, like, like, like, like, like, like);
    // "Mivida A12" should match project + unit number
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      const wordClauses = words.map((w) => {
        const wl = `%${likeEscape(w)}%`;
        params.push(wl, wl, wl, wl, wl);
        return "(p.name LIKE ? ESCAPE '\\' OR u.unit_number LIKE ? ESCAPE '\\' OR u.phase LIKE ? ESCAPE '\\' OR u.property_type LIKE ? ESCAPE '\\' OR o.name LIKE ? ESCAPE '\\')";
      });
      parts.push(`(${wordClauses.join(' AND ')})`);
    }
    const unitNo = normalizeUnitNumber(q);
    if (unitNo) {
      parts.push("u.unit_number_norm LIKE ? ESCAPE '\\'");
      params.push(`%${likeEscape(unitNo)}%`);
    }
    const phone = normalizePhone(q);
    if (phone.length >= 4 && /^[\d\s+()-]+$/.test(q)) {
      parts.push("o.primary_phone_norm LIKE ? OR o.secondary_phone_norm LIKE ? OR o.whatsapp_norm LIKE ?");
      params.push(`%${phone}%`, `%${phone}%`, `%${phone}%`);
    }
    const code = q.match(/^u-?0*(\d+)$/i);
    if (code) {
      parts.push('u.id = ?');
      params.push(Number(code[1]));
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }

  if (f.status?.length) clauses.push(inList('u.status', f.status, params));
  if (f.developer_ids?.length) clauses.push(inList('u.developer_id', f.developer_ids, params));
  if (f.project_ids?.length) clauses.push(inList('u.project_id', f.project_ids, params));
  if (f.property_types?.length) clauses.push(inList('u.property_type COLLATE NOCASE', f.property_types, params));
  if (f.finishing?.length) clauses.push(inList('u.finishing COLLATE NOCASE', f.finishing, params));
  if (f.assigned_user_ids?.length) clauses.push(inList('u.assigned_user_id', f.assigned_user_ids, params));
  if (f.tag_ids?.length) {
    clauses.push(`u.id IN (SELECT entity_id FROM taggings WHERE entity_type = 'unit' AND ${inList('tag_id', f.tag_ids, params)})`);
  }
  const range = (col: string, min?: number, max?: number) => {
    if (min !== undefined && min !== null && !Number.isNaN(min)) {
      clauses.push(`${col} >= ?`);
      params.push(min);
    }
    if (max !== undefined && max !== null && !Number.isNaN(max)) {
      clauses.push(`${col} <= ?`);
      params.push(max);
    }
  };
  range('u.bedrooms', f.bedrooms_min, f.bedrooms_max);
  range('u.bathrooms', f.bathrooms_min, undefined);
  range('u.asking_price', f.price_min, f.price_max);
  range('u.bua', f.bua_min, f.bua_max);
  range('u.land_area', f.land_min, f.land_max);
  if (f.phase?.trim()) {
    clauses.push("u.phase LIKE ? ESCAPE '\\'");
    params.push(`%${likeEscape(f.phase.trim())}%`);
  }
  if (f.delivery?.trim()) {
    clauses.push("u.delivery LIKE ? ESCAPE '\\'");
    params.push(`%${likeEscape(f.delivery.trim())}%`);
  }
  if (f.verification?.length) {
    const age = "(julianday('now') - julianday(u.last_verified))";
    const opts = f.verification.map((v) => {
      if (v === 'never') return 'u.last_verified IS NULL';
      if (v === 'current') return `${age} < ${Number(ctx.thresholds.attention)}`;
      if (v === 'attention') return `(${age} >= ${Number(ctx.thresholds.attention)} AND ${age} < ${Number(ctx.thresholds.outdated)})`;
      return `${age} >= ${Number(ctx.thresholds.outdated)}`;
    });
    clauses.push(`(${opts.join(' OR ')})`);
  }
  if (f.updated_from) {
    clauses.push('u.updated_at >= ?');
    params.push(f.updated_from);
  }
  if (f.updated_to) {
    clauses.push('u.updated_at < date(?, \'+1 day\')');
    params.push(f.updated_to);
  }
  if (f.has_media === true) clauses.push("EXISTS (SELECT 1 FROM files fi WHERE fi.entity_type = 'unit' AND fi.entity_id = u.id)");
  if (f.has_media === false) clauses.push("NOT EXISTS (SELECT 1 FROM files fi WHERE fi.entity_type = 'unit' AND fi.entity_id = u.id)");
  if (f.mine) {
    clauses.push('(u.assigned_user_id = ? OR u.created_by = ?)');
    params.push(ctx.userId, ctx.userId);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function orderBy(sort: SortSpec[] | undefined, map: Record<string, string>, fallback: string) {
  const parts = (sort ?? [])
    .filter((s) => map[s.key])
    .map((s) => `${map[s.key]} IS NULL, ${map[s.key]} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`);
  return `ORDER BY ${parts.length ? parts.join(', ') + ', ' : ''}${fallback}`;
}

export function parseFilters(raw: unknown): UnitFilters {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw as UnitFilters;
}

export function parseSort(raw: unknown): SortSpec[] {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function getUnitRow(db: DB, id: number) {
  return get<any>(db, `${UNIT_SELECT} WHERE u.id = ?`, [id]);
}

export function findUnitDuplicates(
  db: DB,
  { project_id, unit_number, phase }: { project_id?: number | null; unit_number?: string | null; phase?: string | null },
  excludeId?: number,
) {
  const norm = normalizeUnitNumber(unit_number);
  if (!project_id || !norm) return [];
  const rows = all<any>(
    db,
    `${UNIT_SELECT} WHERE u.project_id = ? AND u.unit_number_norm = ? AND u.id <> ? AND u.archived_at IS NULL`,
    [project_id, norm, excludeId ?? 0],
  );
  // Same unit number in different phases is a weaker signal but still worth showing.
  return rows.map((r) => ({ ...r, same_phase: (r.phase ?? '').toLowerCase() === (phase ?? '').toLowerCase() }));
}
