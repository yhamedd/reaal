import path from 'node:path';
import { openDb } from './db.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';

/**
 * Connects to Turso/libSQL when TURSO_DATABASE_URL (or DATABASE_URL) is set —
 * as on Vercel — otherwise to a local SQLite file in DATA_DIR. Then makes sure
 * roles, the first admin and default master data exist.
 */
export async function connectFromEnv() {
  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || process.env.DATABASE_FILE || path.join(config.dataDir, 'reaal.db');
  const db = await openDb({ url, authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN });
  await bootstrap(db, {
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    adminName: process.env.ADMIN_NAME,
  });
  return db;
}
