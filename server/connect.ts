import path from 'node:path';
import { openDb } from './db.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';

/** Local development keeps its database here (PGlite); production uses DATABASE_URL (Supabase). */
export const localDbDir = () => path.join(config.dataDir, 'pg');

/**
 * Connects to Supabase/Postgres when DATABASE_URL is set, otherwise to an embedded
 * Postgres in DATA_DIR/pg, then makes sure roles, the first admin and master data exist.
 */
export async function connectFromEnv() {
  if (process.env.VERCEL && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Add the Supabase connection string in the Vercel project settings.');
  const db = await openDb(process.env.DATABASE_URL || localDbDir());
  await bootstrap(db, {
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    adminName: process.env.ADMIN_NAME,
  });
  return db;
}
