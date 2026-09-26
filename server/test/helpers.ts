import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, get, run, type DB } from '../db.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { hashPassword, clearAllThrottles } from '../auth.js';

process.env.NODE_ENV = 'test';

/**
 * A fresh, empty database: in-memory PGlite by default, or a new database on a real PostgreSQL
 * server when TEST_DATABASE_URL is set (e.g. postgres://postgres@127.0.0.1:5432/postgres).
 */
export async function testDb(): Promise<DB> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDb(':memory:');
  const name = `reaal_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = await openRaw(url);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(url);
  u.pathname = `/${name}`;
  return openDb(u.toString());
}

async function openRaw(url: string) {
  const { default: postgres } = await import('postgres');
  return postgres(url, { max: 1, onnotice: () => undefined });
}

export async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaal-test-'));
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  const db = await testDb();
  await bootstrap(db, { adminEmail: 'admin@test.local', adminPassword: 'Admin12345', adminName: 'Admin User' });
  clearAllThrottles();
  const app = createApp(db);

  const addUser = async (name: string, email: string, roleKey: string, password = 'Password123') => {
    const role = await get<any>(db, 'SELECT id FROM roles WHERE key = ?', [roleKey])!;
    return (await run(db, 'INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)', [name, email, hashPassword(password), role.id])).lastId;
  };

  const login = async (email: string, password: string) => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').set('X-Requested-With', 'reaal').send({ email, password });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return wrap(agent);
  };

  return { db, app, addUser, login, dir };
}

/** Agent wrapper that always sends the CSRF header. */
function wrap(agent: ReturnType<typeof request.agent>) {
  const h = (r: request.Test) => r.set('X-Requested-With', 'reaal');
  return {
    raw: agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => h(agent.post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => h(agent.patch(url)).send(body ?? {}),
    delete: (url: string, body?: object) => h(agent.delete(url)).send(body ?? {}),
    upload: (url: string) => h(agent.post(url)),
  };
}

export type Client = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['login']>>;

export async function projectId(db: DB, name: string): Promise<number> {
  return (await get<any>(db, 'SELECT id FROM projects WHERE name = ?', [name]))!.id;
}
