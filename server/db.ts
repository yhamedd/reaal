import { createClient, type Client, type InValue, type Transaction } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Database handle: either the client or an open transaction. Both expose
 * execute(), so helpers accept either and code inside tx() transparently
 * runs on the transaction.
 */
export type DB = (Client | Transaction) & { __tx?: boolean };
export type Params = unknown[];

const SCHEMA = `

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT,
  last_activity TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remember INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS developers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  developer_id INTEGER REFERENCES developers(id) ON DELETE SET NULL,
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS master_values (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  value TEXT NOT NULL COLLATE NOCASE,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (category, value)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT 'gray'
);

CREATE TABLE IF NOT EXISTS taggings (
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  PRIMARY KEY (tag_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_taggings_entity ON taggings(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS owners (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  primary_phone TEXT,
  primary_phone_norm TEXT,
  secondary_phone TEXT,
  secondary_phone_norm TEXT,
  whatsapp TEXT,
  whatsapp_norm TEXT,
  email TEXT,
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  last_contacted TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_owners_phone ON owners(primary_phone_norm);
CREATE INDEX IF NOT EXISTS idx_owners_phone2 ON owners(secondary_phone_norm);
CREATE INDEX IF NOT EXISTS idx_owners_wa ON owners(whatsapp_norm);
CREATE INDEX IF NOT EXISTS idx_owners_name ON owners(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER REFERENCES owners(id) ON DELETE SET NULL,
  developer_id INTEGER REFERENCES developers(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  phase TEXT,
  unit_number TEXT,
  unit_number_norm TEXT,
  property_type TEXT,
  bua REAL,
  land_area REAL,
  bedrooms INTEGER,
  bathrooms INTEGER,
  floors INTEGER,
  finishing TEXT,
  furnished TEXT,
  view TEXT,
  location TEXT,
  delivery TEXT,
  asking_price REAL,
  original_price REAL,
  paid_amount REAL,
  remaining_amount REAL,
  maintenance REAL,
  payment_notes TEXT,
  status TEXT NOT NULL DEFAULT 'Available',
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source TEXT,
  last_verified TEXT,
  verification_notified_level TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_units_owner ON units(owner_id);
CREATE INDEX IF NOT EXISTS idx_units_project ON units(project_id, unit_number_norm);
CREATE INDEX IF NOT EXISTS idx_units_status ON units(status);

CREATE TABLE IF NOT EXISTS requirements (
  id INTEGER PRIMARY KEY,
  client_name TEXT NOT NULL,
  phone TEXT,
  phone_norm TEXT,
  whatsapp TEXT,
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  developer_id INTEGER REFERENCES developers(id) ON DELETE SET NULL,
  preferred_project_ids TEXT NOT NULL DEFAULT '[]',
  property_types TEXT NOT NULL DEFAULT '[]',
  min_bua REAL,
  max_bua REAL,
  min_bedrooms INTEGER,
  min_price REAL,
  max_price REAL,
  finishing TEXT,
  delivery_preference TEXT,
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'Active',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_req_phone ON requirements(phone_norm);

CREATE TABLE IF NOT EXISTS requirement_exclusions (
  requirement_id INTEGER NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (requirement_id, unit_id)
);

CREATE TABLE IF NOT EXISTS requirement_match_seen (
  requirement_id INTEGER NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  PRIMARY KEY (requirement_id, unit_id)
);

CREATE TABLE IF NOT EXISTS offer_templates (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  header TEXT NOT NULL DEFAULT '',
  unit_block TEXT NOT NULL DEFAULT '',
  separator TEXT NOT NULL DEFAULT '',
  footer TEXT NOT NULL DEFAULT '',
  include_owner INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  client_name TEXT,
  requirement_id INTEGER REFERENCES requirements(id) ON DELETE SET NULL,
  template TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offer_units (
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (offer_id, unit_id)
);
CREATE INDEX IF NOT EXISTS idx_offer_units_unit ON offer_units(unit_id);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'document',
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  entity_label TEXT,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS saved_views (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL DEFAULT 'units',
  name TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  shared INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'inventory',
  status TEXT NOT NULL DEFAULT 'uploaded',
  headers TEXT NOT NULL DEFAULT '[]',
  rows TEXT NOT NULL DEFAULT '[]',
  mapping TEXT,
  summary TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
`;

export interface OpenOptions {
  url: string;
  authToken?: string;
}

/**
 * Opens a local file (file:./data/reaal.db), an in-memory database (:memory:)
 * or a remote Turso/libSQL database (libsql://…), then applies the schema.
 */
export async function openDb(opts: OpenOptions | string): Promise<Client> {
  const o = typeof opts === 'string' ? { url: opts } : opts;
  let url = o.url;
  if (url !== ':memory:' && !/^[a-z]+:/i.test(url)) url = `file:${url}`;
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
  const client = createClient({ url, authToken: o.authToken, intMode: 'number' });
  if (url.startsWith('file:')) {
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA busy_timeout = 5000');
  }
  await client.execute('PRAGMA foreign_keys = ON');
  await client.executeMultiple(SCHEMA);
  return client;
}

function args(params: Params): InValue[] {
  return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as InValue)));
}

export async function all<T = any>(db: DB, sql: string, params: Params = []): Promise<T[]> {
  const rs = await db.execute({ sql, args: args(params) });
  return rs.rows.map((r) => {
    const o: Record<string, unknown> = {};
    rs.columns.forEach((c, i) => (o[c] = r[i]));
    return o as T;
  });
}

export async function get<T = any>(db: DB, sql: string, params: Params = []): Promise<T | undefined> {
  return (await all<T>(db, sql, params))[0];
}

export async function run(db: DB, sql: string, params: Params = []) {
  const rs = await db.execute({ sql, args: args(params) });
  return { changes: rs.rowsAffected, lastId: Number(rs.lastInsertRowid ?? 0) };
}

/** Runs fn inside a write transaction; nested calls reuse the outer transaction. */
export async function tx<T>(db: DB, fn: (db: DB) => Promise<T>): Promise<T> {
  if (db.__tx) return fn(db);
  const t = (await (db as Client).transaction('write')) as DB;
  t.__tx = true;
  try {
    const result = await fn(t);
    await (t as Transaction).commit();
    return result;
  } catch (e) {
    try {
      await (t as Transaction).rollback();
    } catch {
      /* already closed */
    }
    throw e;
  } finally {
    (t as Transaction).close();
  }
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
