import { all, get, run, type DB } from './db.js';
import type { AuthUser } from './auth.js';
import { formatNumber } from '../shared/format.js';

export interface ActivityInput {
  userId: number | null;
  action: string;
  entityType?: string;
  entityId?: number | null;
  label?: string | null;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  message: string;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function logActivity(db: DB, a: ActivityInput) {
  run(
    db,
    `INSERT INTO activity (user_id, action, entity_type, entity_id, entity_label, field, old_value, new_value, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      a.userId,
      a.action,
      a.entityType ?? null,
      a.entityId ?? null,
      a.label ?? null,
      a.field ?? null,
      str(a.oldValue),
      str(a.newValue),
      a.message,
    ],
  );
}

export interface FieldMeta {
  label: string;
  format?: (v: any) => string;
}

export const money = (v: any) => (v === null || v === undefined || v === '' ? '' : formatNumber(Number(v)));

function display(meta: FieldMeta, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'empty';
  return meta.format ? meta.format(v) || 'empty' : String(v);
}

/** Writes one activity row per changed field, e.g. "changed Mivida A12 asking price from 40,000,000 to 42,000,000". */
export function logChanges(
  db: DB,
  user: AuthUser,
  entityType: string,
  entityId: number,
  label: string,
  before: Record<string, any>,
  after: Record<string, any>,
  fields: Record<string, FieldMeta>,
) {
  const changed: string[] = [];
  for (const [key, meta] of Object.entries(fields)) {
    if (!(key in after)) continue;
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (String(a ?? '') === String(b ?? '')) continue;
    changed.push(key);
    const isStatus = key === 'status';
    logActivity(db, {
      userId: user.id,
      action: isStatus ? 'status_changed' : 'updated',
      entityType,
      entityId,
      label,
      field: key,
      oldValue: a,
      newValue: b,
      message: isStatus
        ? `changed ${label} from ${display(meta, a)} to ${display(meta, b)}`
        : `changed ${label} ${meta.label.toLowerCase()} from ${display(meta, a)} to ${display(meta, b)}`,
    });
  }
  return changed;
}

export function notify(db: DB, userId: number | null | undefined, type: string, message: string, link?: string) {
  if (!userId) return;
  run(db, 'INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)', [userId, type, message, link ?? null]);
}

/** Notifies every active user holding a permission, except the actor. */
export function notifyPermission(db: DB, permission: string, type: string, message: string, link?: string, exceptUserId?: number) {
  const users = all<{ id: number; permissions: string }>(
    db,
    `SELECT u.id, r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.status = 'active'`,
  );
  for (const u of users) {
    if (u.id === exceptUserId) continue;
    try {
      if ((JSON.parse(u.permissions) as string[]).includes(permission)) notify(db, u.id, type, message, link);
    } catch {
      /* skip */
    }
  }
}

export function unitLabel(db: DB, unitId: number): string {
  const row = get<any>(
    db,
    `SELECT u.id, u.unit_number, p.name AS project FROM units u LEFT JOIN projects p ON p.id = u.project_id WHERE u.id = ?`,
    [unitId],
  );
  if (!row) return `Unit ${unitId}`;
  const parts = [row.project, row.unit_number].filter(Boolean);
  return parts.length ? parts.join(' ') : unitCode(row.id);
}

export const unitCode = (id: number) => `U-${String(id).padStart(5, '0')}`;
export const ownerCode = (id: number) => `O-${String(id).padStart(5, '0')}`;
export const requirementCode = (id: number) => `R-${String(id).padStart(5, '0')}`;
export const offerCode = (id: number) => `OF-${String(id).padStart(5, '0')}`;
