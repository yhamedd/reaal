import { Router } from 'express';
import { all, get, run, tx } from '../db.js';
import { HttpError, generateTempPassword, hashPassword, requireAnyPermission, requireAuth, requirePermission, type AuthUser } from '../auth.js';
import { coerce, intParam, type FieldSpec } from '../util.js';
import { ALL_PERMISSION_KEYS, PERMISSIONS } from '../../shared/permissions.js';
import { logActivity } from '../activity.js';
import { createResetToken } from './auth.js';

export const usersRouter = Router();
export const rolesRouter = Router();

const USER_SPEC: Record<string, FieldSpec> = {
  name: { type: 'text', label: 'Name', required: true, max: 120 },
  email: { type: 'text', label: 'Email', required: true, max: 200 },
  phone: { type: 'text', label: 'Phone', max: 40 },
  role_id: { type: 'id', label: 'Role', required: true },
  status: { type: 'enum', label: 'Status', values: ['active', 'disabled'] },
};

const isSuper = (u: AuthUser) => u.role_key === 'super_admin';

function roleOf(db: import('../db.js').DB, roleId: number) {
  const role = get<any>(db, 'SELECT * FROM roles WHERE id = ?', [roleId]);
  if (!role) throw new HttpError(400, 'Unknown role', { fields: { role_id: 'Unknown role' } });
  return role;
}

function guardTarget(actor: AuthUser, target: any) {
  if (target.role_key === 'super_admin' && !isSuper(actor)) {
    throw new HttpError(403, 'Only a Super Admin can change Super Admin accounts');
  }
}

function activeSuperAdmins(db: import('../db.js').DB) {
  return get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'super_admin' AND u.status = 'active'")!.n;
}

/** Minimal list for assignment dropdowns and @mentions — available to every signed-in user. */
usersRouter.get('/directory', requireAuth, (req, res) => {
  res.json(all(req.db, "SELECT id, name, email, status FROM users ORDER BY status = 'active' DESC, name COLLATE NOCASE"));
});

usersRouter.get('/', requirePermission('users.manage'), (req, res) => {
  const rows = all<any>(
    req.db,
    `SELECT u.id, u.name, u.email, u.phone, u.role_id, r.name AS role_name, r.key AS role_key, u.status, u.created_at,
            u.last_login, u.last_activity, u.locked_until, u.must_change_password,
            (SELECT COUNT(*) FROM units x WHERE x.created_by = u.id) +
            (SELECT COUNT(*) FROM owners x WHERE x.created_by = u.id) +
            (SELECT COUNT(*) FROM requirements x WHERE x.created_by = u.id) AS records_added,
            (SELECT COUNT(*) FROM offers x WHERE x.created_by = u.id) AS offers_created
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.status, u.name COLLATE NOCASE`,
  );
  res.json(rows.map((r) => ({ ...r, locked: !!(r.locked_until && new Date(r.locked_until.replace(' ', 'T') + 'Z') > new Date()) })));
});

usersRouter.post('/', requirePermission('users.manage'), (req, res) => {
  const db = req.db;
  const data = coerce(req.body ?? {}, USER_SPEC, false);
  data.email = String(data.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new HttpError(400, 'Enter a valid email', { fields: { email: 'Enter a valid email' } });
  const role = roleOf(db, data.role_id);
  if (role.key === 'super_admin' && !isSuper(req.user!)) throw new HttpError(403, 'Only a Super Admin can create Super Admin accounts');
  if (get(db, 'SELECT 1 FROM users WHERE email = ? COLLATE NOCASE', [data.email])) {
    throw new HttpError(409, 'A user with this email already exists', { fields: { email: 'Already in use' } });
  }
  const temp = generateTempPassword();
  const { lastId } = run(db, 'INSERT INTO users (name, email, phone, password_hash, role_id, status, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)', [
    data.name,
    data.email,
    data.phone ?? null,
    hashPassword(temp),
    data.role_id,
    data.status ?? 'active',
  ]);
  logActivity(db, { userId: req.user!.id, action: 'user_created', entityType: 'user', entityId: lastId, label: data.name, message: `added ${data.name} to the team as ${role.name}` });
  res.status(201).json({ id: lastId, temporary_password: temp });
});

usersRouter.patch('/:id', requirePermission('users.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const target = get<any>(db, 'SELECT u.*, r.key AS role_key, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id]);
  if (!target) throw new HttpError(404, 'User not found');
  guardTarget(req.user!, target);
  const data = coerce(req.body ?? {}, USER_SPEC, true);
  if (data.email) {
    data.email = String(data.email).toLowerCase();
    if (get(db, 'SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id <> ?', [data.email, id])) throw new HttpError(409, 'Email already in use', { fields: { email: 'Already in use' } });
  }
  if (data.role_id) {
    const role = roleOf(db, data.role_id);
    if (role.key === 'super_admin' && !isSuper(req.user!)) throw new HttpError(403, 'Only a Super Admin can grant the Super Admin role');
    if (target.role_key === 'super_admin' && role.key !== 'super_admin' && activeSuperAdmins(db) <= 1) {
      throw new HttpError(400, 'At least one active Super Admin is required');
    }
  }
  if (data.status === 'disabled') {
    if (id === req.user!.id) throw new HttpError(400, "You can't disable your own account");
    if (target.role_key === 'super_admin' && activeSuperAdmins(db) <= 1) throw new HttpError(400, 'At least one active Super Admin is required');
  }
  tx(db, () => {
    const keys = Object.keys(data);
    if (!keys.length) return;
    run(db, `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), id]);
    if (data.status === 'disabled') run(db, 'DELETE FROM sessions WHERE user_id = ?', [id]);
    for (const k of keys) {
      if (String(data[k] ?? '') === String(target[k] ?? '')) continue;
      let message = `updated ${target.name}'s ${USER_SPEC[k].label.toLowerCase()}`;
      let oldV: any = target[k];
      let newV: any = data[k];
      if (k === 'role_id') {
        oldV = target.role_name;
        newV = roleOf(db, data.role_id).name;
        message = `changed ${target.name}'s role from ${oldV} to ${newV}`;
      }
      if (k === 'status') message = data.status === 'disabled' ? `disabled ${target.name}'s account` : `re-enabled ${target.name}'s account`;
      logActivity(db, { userId: req.user!.id, action: k === 'status' ? `user_${data.status}` : 'user_updated', entityType: 'user', entityId: id, label: target.name, field: k, oldValue: oldV, newValue: newV, message });
    }
  });
  res.json({ ok: true });
});

usersRouter.post('/:id/reset-password', requirePermission('users.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const target = get<any>(db, 'SELECT u.*, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id]);
  if (!target) throw new HttpError(404, 'User not found');
  guardTarget(req.user!, target);
  const mode = req.body?.mode === 'temporary' ? 'temporary' : 'link';
  let result: Record<string, unknown>;
  if (mode === 'temporary') {
    const temp = generateTempPassword();
    run(db, 'UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?', [hashPassword(temp), id]);
    run(db, 'DELETE FROM sessions WHERE user_id = ?', [id]);
    result = { temporary_password: temp };
  } else {
    const { token, expires } = createResetToken(db, id, req.user!.id);
    result = { reset_path: `/reset-password?token=${token}`, expires_at: expires };
  }
  logActivity(db, { userId: req.user!.id, action: 'password_reset_issued', entityType: 'user', entityId: id, label: target.name, message: `reset ${target.name}'s password access` });
  res.json(result);
});

usersRouter.post('/:id/unlock', requirePermission('users.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const target = get<any>(db, 'SELECT name FROM users WHERE id = ?', [id]);
  if (!target) throw new HttpError(404, 'User not found');
  run(db, 'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [id]);
  logActivity(db, { userId: req.user!.id, action: 'user_unlocked', entityType: 'user', entityId: id, label: target.name, message: `unlocked ${target.name}'s account` });
  res.json({ ok: true });
});

usersRouter.patch('/me/profile', requireAuth, (req, res) => {
  const data = coerce(req.body ?? {}, { name: USER_SPEC.name, phone: USER_SPEC.phone }, true);
  const keys = Object.keys(data);
  if (keys.length) run(req.db, `UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), req.user!.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

rolesRouter.get('/', requireAnyPermission('users.manage', 'roles.manage'), (req, res) => {
  const rows = all<any>(req.db, 'SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r ORDER BY r.id');
  res.json({ roles: rows.map((r) => ({ ...r, permissions: JSON.parse(r.permissions) })), catalogue: PERMISSIONS });
});

function cleanPermissions(v: unknown): string[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'Permissions must be a list');
  return [...new Set(v.map(String).filter((p) => ALL_PERMISSION_KEYS.includes(p)))];
}

rolesRouter.post('/', requirePermission('roles.manage'), (req, res) => {
  const db = req.db;
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Role name is required');
  if (get(db, 'SELECT 1 FROM roles WHERE name = ? COLLATE NOCASE', [name])) throw new HttpError(409, 'A role with this name already exists');
  const perms = cleanPermissions(req.body?.permissions ?? []);
  const { lastId } = run(db, 'INSERT INTO roles (name, permissions) VALUES (?, ?)', [name, JSON.stringify(perms)]);
  logActivity(db, { userId: req.user!.id, action: 'role_created', entityType: 'role', entityId: lastId, label: name, message: `created role ${name}` });
  res.status(201).json({ id: lastId });
});

rolesRouter.patch('/:id', requirePermission('roles.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const role = get<any>(db, 'SELECT * FROM roles WHERE id = ?', [id]);
  if (!role) throw new HttpError(404, 'Role not found');
  if (role.key === 'super_admin' && req.body?.permissions) throw new HttpError(400, 'Super Admin always has every permission');
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) throw new HttpError(400, 'Role name is required');
    if (get(db, 'SELECT 1 FROM roles WHERE name = ? COLLATE NOCASE AND id <> ?', [name, id])) throw new HttpError(409, 'A role with this name already exists');
    run(db, 'UPDATE roles SET name = ? WHERE id = ?', [name, id]);
  }
  if (req.body?.permissions) {
    const perms = cleanPermissions(req.body.permissions);
    const before: string[] = JSON.parse(role.permissions);
    run(db, 'UPDATE roles SET permissions = ? WHERE id = ?', [JSON.stringify(perms), id]);
    const added = perms.filter((p) => !before.includes(p));
    const removed = before.filter((p) => !perms.includes(p));
    if (added.length || removed.length) {
      logActivity(db, {
        userId: req.user!.id,
        action: 'role_permissions_changed',
        entityType: 'role',
        entityId: id,
        label: role.name,
        oldValue: removed.join(', '),
        newValue: added.join(', '),
        message: `changed permissions of ${role.name}${added.length ? ` (+${added.join(', ')})` : ''}${removed.length ? ` (−${removed.join(', ')})` : ''}`,
      });
    }
  }
  res.json({ ok: true });
});

rolesRouter.delete('/:id', requirePermission('roles.manage'), (req, res) => {
  const db = req.db;
  const id = intParam(req.params.id);
  const role = get<any>(db, 'SELECT * FROM roles WHERE id = ?', [id]);
  if (!role) throw new HttpError(404, 'Role not found');
  if (role.is_system) throw new HttpError(400, 'Built-in roles cannot be deleted');
  if (get(db, 'SELECT 1 FROM users WHERE role_id = ?', [id])) throw new HttpError(400, 'Move users to another role before deleting this one');
  run(db, 'DELETE FROM roles WHERE id = ?', [id]);
  logActivity(db, { userId: req.user!.id, action: 'role_deleted', entityType: 'role', entityId: id, label: role.name, message: `deleted role ${role.name}` });
  res.json({ ok: true });
});
