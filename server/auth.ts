import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { get, run, nowIso, type DB } from './db.js';
import { getSettings } from './settings.js';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role_id: number;
  role_key: string | null;
  role_name: string;
  permissions: Set<string>;
  must_change_password: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
      db: DB;
    }
  }
}

export const SESSION_COOKIE = 'reaal_sid';

// ---------------------------------------------------------------------------
// Password hashing (scrypt, per-password salt, constant-time comparison)
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = crypto.scryptSync(password, salt, expected.length, { N });
  return crypto.timingSafeEqual(actual, expected);
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(12);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function toSql(d: Date) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function createSession(db: DB, userId: number, remember: boolean, req: Request) {
  const settings = getSettings(db).security;
  const token = randomToken();
  const lifetimeSeconds = remember ? settings.remember_days * 86400 : settings.session_hours * 3600;
  const expires = addSeconds(new Date(), lifetimeSeconds);
  run(
    db,
    `INSERT INTO sessions (id, user_id, remember, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
    [sha256(token), userId, remember ? 1 : 0, toSql(expires), req.ip ?? null, String(req.headers['user-agent'] ?? '').slice(0, 200)],
  );
  return { token, expires, maxAge: remember ? lifetimeSeconds * 1000 : undefined };
}

export function destroySession(db: DB, token: string) {
  run(db, 'DELETE FROM sessions WHERE id = ?', [sha256(token)]);
}

export function loadUser(db: DB, userId: number): AuthUser | undefined {
  const row = get<any>(
    db,
    `SELECT u.id, u.name, u.email, u.phone, u.role_id, u.status, u.must_change_password,
            r.key AS role_key, r.name AS role_name, r.permissions
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [userId],
  );
  if (!row || row.status !== 'active') return undefined;
  let perms: string[] = [];
  try {
    perms = JSON.parse(row.permissions);
  } catch {
    perms = [];
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role_id: row.role_id,
    role_key: row.role_key,
    role_name: row.role_name,
    permissions: new Set(perms),
    must_change_password: !!row.must_change_password,
  };
}

/**
 * Resolves the session cookie into req.user. Sessions expire both on their
 * absolute lifetime and after the configurable inactivity window.
 */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const db = req.db;
  const id = sha256(token);
  const session = get<any>(db, 'SELECT * FROM sessions WHERE id = ?', [id]);
  if (!session) {
    res.clearCookie(SESSION_COOKIE);
    return next();
  }
  const now = new Date();
  const inactivity = getSettings(db).security.inactivity_minutes;
  const lastSeen = new Date(session.last_seen.replace(' ', 'T') + 'Z');
  const expires = new Date(session.expires_at.replace(' ', 'T') + 'Z');
  const idleExpired = !session.remember && inactivity > 0 && now.getTime() - lastSeen.getTime() > inactivity * 60_000;
  if (expires < now || idleExpired) {
    run(db, 'DELETE FROM sessions WHERE id = ?', [id]);
    res.clearCookie(SESSION_COOKIE);
    res.setHeader('X-Session-Expired', idleExpired ? 'inactivity' : 'expired');
    return next();
  }
  const user = loadUser(db, session.user_id);
  if (!user) {
    run(db, 'DELETE FROM sessions WHERE id = ?', [id]);
    res.clearCookie(SESSION_COOKIE);
    return next();
  }
  req.user = user;
  req.sessionId = id;
  // Heartbeat endpoints must not count as activity or the idle timeout never fires.
  if (!req.path.startsWith('/api/notifications/count')) {
    const ts = nowIso();
    run(db, 'UPDATE sessions SET last_seen = ? WHERE id = ?', [ts, id]);
    run(db, 'UPDATE users SET last_activity = ? WHERE id = ?', [ts, user.id]);
  }
  next();
}

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue'));
  next();
}

export function can(user: AuthUser | undefined, permission: string): boolean {
  return !!user && user.permissions.has(permission);
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in to continue'));
    const missing = permissions.filter((p) => !req.user!.permissions.has(p));
    if (missing.length) return next(new HttpError(403, `You don't have permission to do this (${missing.join(', ')})`));
    next();
  };
}

export function requireAnyPermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in to continue'));
    if (!permissions.some((p) => req.user!.permissions.has(p)))
      return next(new HttpError(403, "You don't have permission to do this"));
    next();
  };
}

// ---------------------------------------------------------------------------
// Login throttling: per-account lockout (persisted) plus a per-IP window
// (in memory) so one address cannot spray many accounts.
// ---------------------------------------------------------------------------

const ipAttempts = new Map<string, { count: number; resetAt: number }>();
const IP_WINDOW_MS = 15 * 60_000;
const IP_MAX = 30;

export function checkIpThrottle(ip: string): boolean {
  const now = Date.now();
  const entry = ipAttempts.get(ip);
  if (!entry || entry.resetAt < now) return true;
  return entry.count < IP_MAX;
}

export function recordIpFailure(ip: string) {
  const now = Date.now();
  const entry = ipAttempts.get(ip);
  if (!entry || entry.resetAt < now) ipAttempts.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
  else entry.count++;
}

export function resetIpThrottle(ip: string) {
  ipAttempts.delete(ip);
}

export function clearAllThrottles() {
  ipAttempts.clear();
}

export function validatePassword(db: DB, password: unknown): string | null {
  const min = getSettings(db).security.min_password_length;
  if (typeof password !== 'string' || password.length < min) return `Password must be at least ${min} characters`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must include letters and numbers';
  return null;
}
