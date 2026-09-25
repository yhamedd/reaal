import { all, get, run, type DB } from '../db.js';
import { UNIT_SELECT } from './units.js';
import { notify, unitLabel, requirementCode } from '../activity.js';

export interface RequirementRow {
  id: number;
  client_name: string;
  assigned_user_id: number | null;
  developer_id: number | null;
  preferred_project_ids: string | number[];
  property_types: string | string[];
  min_bua: number | null;
  max_bua: number | null;
  min_bedrooms: number | null;
  min_price: number | null;
  max_price: number | null;
  finishing: string | null;
  delivery_preference: string | null;
  status: string;
}

function arr<T>(v: string | T[] | null | undefined): T[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Builds SQL that selects inventory satisfying a requirement. Hard criteria:
 * project (or developer), property type, price range, BUA range, minimum
 * bedrooms and Available status. Finishing and delivery only affect ranking.
 */
function matchSql(r: RequirementRow) {
  const clauses = ["u.status = 'Available'", 'u.archived_at IS NULL'];
  const params: any[] = [];
  const projects = arr<number>(r.preferred_project_ids);
  const types = arr<string>(r.property_types);
  if (projects.length) {
    clauses.push(`u.project_id IN (${projects.map(() => '?').join(',')})`);
    params.push(...projects);
  } else if (r.developer_id) {
    clauses.push('u.developer_id = ?');
    params.push(r.developer_id);
  }
  if (types.length) {
    clauses.push(`u.property_type COLLATE NOCASE IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  // Units with no price/BUA recorded can't be ruled in, so they're excluded when a range is set.
  if (r.min_price != null) {
    clauses.push('u.asking_price >= ?');
    params.push(r.min_price);
  }
  if (r.max_price != null) {
    clauses.push('u.asking_price <= ?');
    params.push(r.max_price);
  }
  if (r.min_bua != null) {
    clauses.push('u.bua >= ?');
    params.push(r.min_bua);
  }
  if (r.max_bua != null) {
    clauses.push('u.bua <= ?');
    params.push(r.max_bua);
  }
  if (r.min_bedrooms != null) {
    clauses.push('u.bedrooms >= ?');
    params.push(r.min_bedrooms);
  }
  return { where: clauses.join(' AND '), params };
}

export function scoreMatch(r: RequirementRow, u: any): { score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];
  const projects = arr<number>(r.preferred_project_ids);
  if (projects.includes(u.project_id)) {
    score += 15;
    reasons.push('Preferred project');
  }
  if (r.finishing && u.finishing && r.finishing.toLowerCase() === String(u.finishing).toLowerCase()) {
    score += 10;
    reasons.push(`${u.finishing}`);
  }
  if (r.delivery_preference && u.delivery && String(u.delivery).toLowerCase().includes(r.delivery_preference.toLowerCase())) {
    score += 10;
    reasons.push(`Delivery ${u.delivery}`);
  }
  if (r.max_price && u.asking_price) {
    const ratio = u.asking_price / r.max_price;
    // Reward options comfortably inside budget, lightly.
    if (ratio <= 0.9) {
      score += 5;
      reasons.push('Within budget');
    }
  }
  if (u.last_verified) {
    const days = (Date.now() - new Date(u.last_verified + 'T00:00:00').getTime()) / 86_400_000;
    if (days <= 14) {
      score += 10;
      reasons.push('Recently verified');
    }
  }
  return { score: Math.min(100, score), reasons };
}

export function findMatches(db: DB, r: RequirementRow, { includeExcluded = false } = {}) {
  const { where, params } = matchSql(r);
  const excluded = new Set(
    all<{ unit_id: number }>(db, 'SELECT unit_id FROM requirement_exclusions WHERE requirement_id = ?', [r.id]).map((x) => x.unit_id),
  );
  const rows = all<any>(db, `${UNIT_SELECT} WHERE ${where} LIMIT 500`, params);
  return rows
    .map((u) => ({ ...u, ...scoreMatch(r, u), excluded: excluded.has(u.id) }))
    .filter((u) => includeExcluded || !u.excluded)
    .sort((a, b) => b.score - a.score || (a.asking_price ?? 0) - (b.asking_price ?? 0));
}

export function unitMatchesRequirement(db: DB, r: RequirementRow, unitId: number): boolean {
  const { where, params } = matchSql(r);
  return !!get(db, `SELECT 1 FROM units u WHERE u.id = ? AND ${where}`, [unitId, ...params]);
}

/**
 * Called after a unit is created or changed: tells the agents of active
 * requirements that a new matching unit exists. Each pair notifies once.
 */
export function notifyNewMatches(db: DB, unitId: number, actorId: number) {
  const reqs = all<RequirementRow>(db, "SELECT * FROM requirements WHERE status IN ('Active', 'Contacted') AND archived_at IS NULL");
  if (!reqs.length) return 0;
  let n = 0;
  const label = unitLabel(db, unitId);
  for (const r of reqs) {
    if (get(db, 'SELECT 1 FROM requirement_match_seen WHERE requirement_id = ? AND unit_id = ?', [r.id, unitId])) continue;
    if (get(db, 'SELECT 1 FROM requirement_exclusions WHERE requirement_id = ? AND unit_id = ?', [r.id, unitId])) continue;
    if (!unitMatchesRequirement(db, r, unitId)) continue;
    run(db, 'INSERT OR IGNORE INTO requirement_match_seen (requirement_id, unit_id) VALUES (?, ?)', [r.id, unitId]);
    const target = r.assigned_user_id;
    if (target && target !== actorId) {
      notify(db, target, 'match', `New match for ${r.client_name} (${requirementCode(r.id)}): ${label}`, `/requirements/${r.id}`);
    }
    n++;
  }
  return n;
}

/** Marks all current matches as seen so a new requirement doesn't flood its agent later. */
export function markMatchesSeen(db: DB, r: RequirementRow) {
  for (const u of findMatches(db, r, { includeExcluded: true })) {
    run(db, 'INSERT OR IGNORE INTO requirement_match_seen (requirement_id, unit_id) VALUES (?, ?)', [r.id, u.id]);
  }
}
