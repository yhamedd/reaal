import { all, run, type DB } from './db.js';
import { HttpError } from './auth.js';
import { parseLooseNumber } from '../shared/format.js';

export type FieldType = 'text' | 'number' | 'int' | 'date' | 'id' | 'enum' | 'json';

export interface FieldSpec {
  type: FieldType;
  label: string;
  values?: readonly string[];
  required?: boolean;
  max?: number;
}

/**
 * Coerces an incoming patch against a field spec, throwing a 400 that names
 * every invalid field. Unknown keys are ignored.
 */
export function coerce(body: Record<string, unknown>, spec: Record<string, FieldSpec>, partial: boolean) {
  const out: Record<string, any> = {};
  const errors: Record<string, string> = {};
  for (const [key, f] of Object.entries(spec)) {
    if (!(key in body)) {
      if (!partial && f.required) errors[key] = `${f.label} is required`;
      continue;
    }
    const raw = body[key];
    const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
    if (empty) {
      if (f.required) errors[key] = `${f.label} is required`;
      else out[key] = null;
      continue;
    }
    switch (f.type) {
      case 'text': {
        const s = String(raw).trim();
        if (f.max && s.length > f.max) errors[key] = `${f.label} is too long`;
        out[key] = s;
        break;
      }
      case 'number':
      case 'int': {
        const n = parseLooseNumber(raw);
        if (n === undefined) out[key] = null;
        else if (Number.isNaN(n) || n < 0) errors[key] = `${f.label} must be a valid number`;
        else out[key] = f.type === 'int' ? Math.round(n) : n;
        break;
      }
      case 'id': {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) errors[key] = `${f.label} is invalid`;
        else out[key] = n;
        break;
      }
      case 'date': {
        const s = String(raw).trim().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) errors[key] = `${f.label} must be a date`;
        else out[key] = s;
        break;
      }
      case 'enum': {
        const s = String(raw).trim();
        const match = f.values?.find((v) => v.toLowerCase() === s.toLowerCase());
        if (!match) errors[key] = `${f.label} must be one of: ${f.values?.join(', ')}`;
        else out[key] = match;
        break;
      }
      case 'json':
        out[key] = raw;
        break;
    }
  }
  if (Object.keys(errors).length) throw new HttpError(400, Object.values(errors)[0], { fields: errors });
  return out;
}

export function intParam(v: unknown, name = 'id'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}`);
  return n;
}

export function idList(v: unknown): number[] {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return arr.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
}

export async function getTags(db: DB, entityType: string, ids: number[]): Promise<Map<number, { id: number; name: string; color: string }[]>> {
  const map = new Map<number, { id: number; name: string; color: string }[]>();
  if (!ids.length) return map;
  const rows = await all<any>(
    db,
    `SELECT tg.entity_id, t.id, t.name, t.color FROM taggings tg JOIN tags t ON t.id = tg.tag_id
      WHERE tg.entity_type = ? AND tg.entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.name`,
    [entityType, ...ids],
  );
  for (const r of rows) {
    if (!map.has(r.entity_id)) map.set(r.entity_id, []);
    map.get(r.entity_id)!.push({ id: r.id, name: r.name, color: r.color });
  }
  return map;
}

export async function setTags(db: DB, entityType: string, entityId: number, tagIds: number[]) {
  await run(db, 'DELETE FROM taggings WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]);
  for (const id of new Set(tagIds)) {
    await run(db, 'INSERT OR IGNORE INTO taggings (tag_id, entity_type, entity_id) SELECT id, ?, ? FROM tags WHERE id = ?', [
      entityType,
      entityId,
      id,
    ]);
  }
}

export function normalizeUnitNumber(v: string | null | undefined): string | null {
  if (!v) return null;
  return String(v).toUpperCase().replace(/[\s\-_/.]/g, '') || null;
}

export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

/** Masks a phone number for users without owners.contact. */
export function maskPhone(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  const d = String(v);
  if (d.length <= 4) return '••••';
  return d.slice(0, 3) + '•'.repeat(Math.max(0, d.length - 5)) + d.slice(-2);
}

export function maskEmail(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  const [user, domain] = String(v).split('@');
  if (!domain) return '•••';
  return `${user.slice(0, 1)}•••@${domain}`;
}
