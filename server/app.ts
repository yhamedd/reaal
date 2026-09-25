import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import type { DB } from './db.js';
import { HttpError, sessionMiddleware } from './auth.js';
import { authRouter } from './routes/auth.js';
import { ownersRouter } from './routes/owners.js';
import { unitsRouter } from './routes/units.js';
import { requirementsRouter } from './routes/requirements.js';
import { offersRouter } from './routes/offers.js';
import { filesRouter } from './routes/files.js';
import { notesRouter } from './routes/notes.js';
import { searchRouter } from './routes/search.js';
import { dashboardRouter } from './routes/dashboard.js';
import { activityRouter } from './routes/activity.js';
import { notificationsRouter } from './routes/notifications.js';
import { usersRouter, rolesRouter } from './routes/users.js';
import { settingsRouter, masterRouter, templatesRouter, publicRouter } from './routes/settings.js';
import { viewsRouter } from './routes/views.js';
import { importsRouter } from './routes/imports.js';
import { exportsRouter } from './routes/exports.js';

export function createApp(db: DB, opts: { staticDir?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

  app.use((req, res, next) => {
    req.db = db;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // CSRF defence: state-changing API calls must come from our own frontend,
  // which always sends this header (browsers won't add it cross-site without CORS).
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('X-Requested-With') !== 'reaal') return next(new HttpError(403, 'Invalid request origin'));
    next();
  });

  app.use('/api', sessionMiddleware);
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Accounts with a temporary password may only change it.
    if (req.user?.must_change_password && !/^\/(auth|public)\//.test(req.path)) {
      return next(new HttpError(428, 'Please set a new password to continue'));
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/owners', ownersRouter);
  app.use('/api/units', unitsRouter);
  app.use('/api/requirements', requirementsRouter);
  app.use('/api/offers', offersRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/master', masterRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/views', viewsRouter);
  app.use('/api/imports', importsRouter);
  app.use('/api/export', exportsRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(opts.staticDir!, 'index.html'));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.details && typeof err.details === 'object' ? (err.details as object) : {}) });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    if (String(err?.message).includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'This record already exists' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
