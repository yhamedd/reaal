import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setup } from './helpers.js';
import { get } from '../db.js';

/** A minimal stand-in for the Supabase Storage REST API (bucket lookup/create, upload, download, remove). */
function fakeSupabase() {
  const buckets = new Map<string, { public: boolean }>();
  const objects = new Map<string, { data: Buffer; type: string }>();
  const auth: string[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    auth.push(String(req.headers.authorization));
    const url = new URL(req.url!, 'http://x');
    const p = url.pathname.replace(/^\/storage\/v1/, '');
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    let m: RegExpMatchArray | null;
    if (req.method === 'GET' && (m = p.match(/^\/bucket\/([^/]+)$/))) {
      const b = buckets.get(m[1]);
      return b ? json(200, { id: m[1], name: m[1], public: b.public }) : json(400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    }
    if (req.method === 'POST' && p === '/bucket') {
      const b = JSON.parse(body.toString());
      buckets.set(b.id ?? b.name, { public: !!b.public });
      return json(200, { name: b.name });
    }
    if (req.method === 'POST' && (m = p.match(/^\/object\/([^/]+)\/(.+)$/))) {
      if (!buckets.has(m[1])) return json(400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
      objects.set(`${m[1]}/${m[2]}`, { data: body, type: String(req.headers['content-type']) });
      return json(200, { Key: `${m[1]}/${m[2]}` });
    }
    if (req.method === 'GET' && (m = p.match(/^\/object\/([^/]+)\/(.+)$/))) {
      const o = objects.get(`${m[1]}/${m[2]}`);
      if (!o) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      res.writeHead(200, { 'Content-Type': o.type });
      return res.end(o.data);
    }
    if (req.method === 'DELETE' && (m = p.match(/^\/object\/([^/]+)$/))) {
      const { prefixes } = JSON.parse(body.toString());
      for (const k of prefixes) objects.delete(`${m[1]}/${k}`);
      return json(200, []);
    }
    json(404, { message: `unexpected ${req.method} ${p}` });
  });
  return { server, buckets, objects, auth };
}

describe('Supabase Storage', () => {
  const fake = fakeSupabase();
  beforeAll(async () => {
    await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', r));
    process.env.SUPABASE_URL = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  });
  afterAll(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    fake.server.close();
  });

  it('stores uploads in a private bucket and serves them only through the API', async () => {
    const ctx = await setup();
    const admin = await ctx.login('admin@test.local', 'Admin12345');
    const project = await admin.post('/api/master/projects', { name: 'Marassi' });
    const unit = await admin.post('/api/units', { project_id: project.body.id, unit_number: 'V-V-1' });
    expect(unit.status, JSON.stringify(unit.body)).toBe(201);
    const pdf = Buffer.from('%PDF-1.4 test');
    const up = await admin.upload('/api/files').field('entity_type', 'unit').field('entity_id', String(unit.body.id)).field('category', 'document').attach('files', pdf, { filename: 'contract.pdf', contentType: 'application/pdf' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);

    expect(fake.buckets.get('reaal-files')).toEqual({ public: false });
    const row = await get<any>(ctx.db, 'SELECT stored_name FROM files WHERE id = ?', [up.body.ids[0]]);
    expect(row.stored_name).toMatch(/^supabase:uploads\/\d+-[0-9a-f]{16}\.pdf$/);
    expect(fake.objects.get(`reaal-files/${row.stored_name.slice('supabase:'.length)}`)?.data).toEqual(pdf);
    expect(fake.auth.every((a) => a === 'Bearer service-role-test-key')).toBe(true);

    const res = await admin.get(`/api/files/${up.body.ids[0]}`).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(res.body)).toEqual(pdf);

    expect((await admin.delete(`/api/files/${up.body.ids[0]}`)).status).toBe(200);
    expect(fake.objects.size).toBe(0);
  });
});
