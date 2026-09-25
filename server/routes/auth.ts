import { Router } from 'express';
import { get, run, nowIso } from '../db.js';
import {
  HttpError,
  SESSION_COOKIE,
  checkIpThrottle,
  createSession,
  destroySession,
  hashPassword,
  randomToken,
  recordIpFailure,
  requireAuth,
  resetIpThrottle,
  sha256,
  validatePassword,
  verifyPassword,
} from '../auth.js';
import { getSettings } from '../settings.js';
import { logActivity, notifyPermission } from '../activity.js';

export const authRouter = Router();

const GENERIC_LOGIN_ERROR = 'Incorrect email or password';

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'),
    path: '/',
    ...(maxAge ? { maxAge } : {}),
  };
}

export function publicUser(req: Express.Request) {
  const u = req.user!;
  const s = getSettings(req.db);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role_id: u.role_id,
    role_key: u.role_key,
    role_name: u.role_name,
    permissions: [...u.permissions].sort(),
    must_change_password: u.must_change_password,
    config: {
      inactivity_minutes: s.security.inactivity_minutes,
      verification: { attention: s.verification.attention_days, outdated: s.verification.outdated_days },
      company_name: s.company.name,
      currency: s.general.currency,
    },
  };
}

authRouter.post('/login', (req, res) => {
  const db = req.db;
  const ip = req.ip ?? 'unknown';
  const { email, password, remember } = req.body ?? {};
  if (!checkIpThrottle(ip)) throw new HttpError(429, 'Too many sign-in attempts. Please wait a few minutes and try again.');
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new HttpError(400, 'Enter your email and password');
  }
  const sec = getSettings(db).security;
  const user = get<any>(db, 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email.trim()]);
  if (!user) {
    // Run a hash anyway so response time doesn't reveal whether the account exists.
    verifyPassword(password, hashPassword('timing-equaliser'));
    recordIpFailure(ip);
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }
  if (user.locked_until && new Date(user.locked_until.replace(' ', 'T') + 'Z') > new Date()) {
    throw new HttpError(423, 'This account is temporarily locked after too many failed attempts. Try again later or ask an administrator.');
  }
  if (!verifyPassword(password, user.password_hash)) {
    recordIpFailure(ip);
    const attempts = user.failed_attempts + 1;
    if (attempts >= sec.max_login_attempts) {
      const until = new Date(Date.now() + sec.lockout_minutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);
      run(db, 'UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?', [until, user.id]);
      logActivity(db, { userId: user.id, action: 'account_locked', entityType: 'user', entityId: user.id, label: user.name, message: `was locked out after ${attempts} failed sign-in attempts` });
      throw new HttpError(423, `Too many failed attempts. The account is locked for ${sec.lockout_minutes} minutes.`);
    }
    run(db, 'UPDATE users SET failed_attempts = ? WHERE id = ?', [attempts, user.id]);
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }
  if (user.status !== 'active') throw new HttpError(403, 'This account has been disabled. Contact your administrator.');

  resetIpThrottle(ip);
  run(db, 'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = ?, last_activity = ? WHERE id = ?', [nowIso(), nowIso(), user.id]);
  const session = createSession(db, user.id, !!remember, req);
  res.cookie(SESSION_COOKIE, session.token, cookieOptions(session.maxAge));
  req.user = undefined;
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) destroySession(req.db, token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req));
});

authRouter.post('/change-password', requireAuth, (req, res) => {
  const db = req.db;
  const { current_password, new_password } = req.body ?? {};
  const row = get<any>(db, 'SELECT password_hash FROM users WHERE id = ?', [req.user!.id]);
  if (!row || typeof current_password !== 'string' || !verifyPassword(current_password, row.password_hash)) {
    throw new HttpError(400, 'Current password is incorrect', { fields: { current_password: 'Current password is incorrect' } });
  }
  const problem = validatePassword(db, new_password);
  if (problem) throw new HttpError(400, problem, { fields: { new_password: problem } });
  if (current_password === new_password) throw new HttpError(400, 'Choose a password different from the current one');
  run(db, 'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hashPassword(new_password), req.user!.id]);
  // Sign out other sessions
  run(db, 'DELETE FROM sessions WHERE user_id = ? AND id <> ?', [req.user!.id, req.sessionId ?? '']);
  logActivity(db, { userId: req.user!.id, action: 'password_changed', entityType: 'user', entityId: req.user!.id, label: req.user!.name, message: 'changed their password' });
  res.json({ ok: true });
});

authRouter.post('/forgot', (req, res) => {
  const db = req.db;
  const email = String(req.body?.email ?? '').trim();
  const ip = req.ip ?? 'unknown';
  if (!checkIpThrottle(ip)) throw new HttpError(429, 'Too many requests. Please wait a few minutes.');
  recordIpFailure(ip); // counts toward the IP window to deter enumeration/spam
  const user = email ? get<any>(db, "SELECT id, name, email FROM users WHERE email = ? COLLATE NOCASE AND status = 'active'", [email]) : undefined;
  if (user) {
    notifyPermission(db, 'users.manage', 'password_reset', `${user.name} (${user.email}) requested a password reset`, `/team?user=${user.id}`);
    logActivity(db, { userId: user.id, action: 'password_reset_requested', entityType: 'user', entityId: user.id, label: user.name, message: 'requested a password reset' });
  }
  // Same answer either way so the endpoint can't be used to discover accounts.
  res.json({ ok: true, message: 'If an account exists for that email, an administrator has been notified and will send you a reset link.' });
});

export function createResetToken(db: import('../db.js').DB, userId: number, createdBy: number | null) {
  const token = randomToken();
  const expires = new Date(Date.now() + 24 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  run(db, 'UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [nowIso(), userId]);
  run(db, 'INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)', [sha256(token), userId, expires, createdBy]);
  return { token, expires };
}

authRouter.get('/reset/:token', (req, res) => {
  const row = get<any>(
    req.db,
    `SELECT pr.*, u.name, u.email FROM password_resets pr JOIN users u ON u.id = pr.user_id
      WHERE pr.token_hash = ? AND pr.used_at IS NULL AND pr.expires_at > datetime('now')`,
    [sha256(String(req.params.token))],
  );
  if (!row) throw new HttpError(404, 'This reset link is invalid or has expired');
  res.json({ name: row.name, email: row.email });
});

authRouter.post('/reset', (req, res) => {
  const db = req.db;
  const { token, password } = req.body ?? {};
  const row = get<any>(
    db,
    `SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`,
    [sha256(String(token ?? ''))],
  );
  if (!row) throw new HttpError(400, 'This reset link is invalid or has expired');
  const problem = validatePassword(db, password);
  if (problem) throw new HttpError(400, problem, { fields: { password: problem } });
  run(db, 'UPDATE users SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL WHERE id = ?', [hashPassword(password), row.user_id]);
  run(db, 'UPDATE password_resets SET used_at = ? WHERE token_hash = ?', [nowIso(), row.token_hash]);
  run(db, 'DELETE FROM sessions WHERE user_id = ?', [row.user_id]);
  logActivity(db, { userId: row.user_id, action: 'password_reset', entityType: 'user', entityId: row.user_id, message: 'reset their password using a reset link' });
  res.json({ ok: true });
});
