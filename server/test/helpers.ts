import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, get, run } from '../db.js';
import { bootstrap } from '../bootstrap.js';
import { createApp } from '../app.js';
import { hashPassword, clearAllThrottles } from '../auth.js';

process.env.NODE_ENV = 'test';

export function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaal-test-'));
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  const db = openDb(':memory:');
  bootstrap(db, { adminEmail: 'admin@test.local', adminPassword: 'Admin12345', adminName: 'Admin User' });
  clearAllThrottles();
  const app = createApp(db);

  const addUser = (name: string, email: string, roleKey: string, password = 'Password123') => {
    const role = get<any>(db, 'SELECT id FROM roles WHERE key = ?', [roleKey])!;
    return run(db, 'INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)', [name, email, hashPassword(password), role.id]).lastId;
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

export type Client = Awaited<ReturnType<ReturnType<typeof setup>['login']>>;

export function projectId(db: ReturnType<typeof openDb>, name: string): number {
  return get<any>(db, 'SELECT id FROM projects WHERE name = ?', [name])!.id;
}
