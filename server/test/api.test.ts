import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { get, run } from '../db.js';
import { setup, projectId, type Client } from './helpers.js';
import { runVerificationCheck } from '../jobs.js';

let ctx: ReturnType<typeof setup>;
let admin: Client;

beforeEach(async () => {
  ctx = setup();
  admin = await ctx.login('admin@test.local', 'Admin12345');
});

async function createOwner(c: Client, body: object) {
  const res = await c.post('/api/owners', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as number;
}

async function createUnit(c: Client, body: object) {
  const res = await c.post('/api/units', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as number;
}

describe('authentication', () => {
  it('rejects unauthenticated access', async () => {
    const r = await (await import('supertest')).default(ctx.app).get('/api/units');
    expect(r.status).toBe(401);
  });

  it('requires the CSRF header on writes', async () => {
    const r = await admin.raw.post('/api/owners').send({ name: 'X' });
    expect(r.status).toBe(403);
  });

  it('locks an account after repeated failures', async () => {
    ctx.addUser('Agent A', 'a@test.local', 'agent');
    const st = (await import('supertest')).default;
    for (let i = 0; i < 4; i++) {
      const r = await st(ctx.app).post('/api/auth/login').set('X-Requested-With', 'reaal').send({ email: 'a@test.local', password: 'wrong' });
      expect(r.status).toBe(401);
    }
    const locked = await st(ctx.app).post('/api/auth/login').set('X-Requested-With', 'reaal').send({ email: 'a@test.local', password: 'wrong' });
    expect(locked.status).toBe(423);
    const correct = await st(ctx.app).post('/api/auth/login').set('X-Requested-With', 'reaal').send({ email: 'a@test.local', password: 'Password123' });
    expect(correct.status).toBe(423);
  });

  it('blocks disabled accounts and ends their sessions', async () => {
    const id = ctx.addUser('Agent B', 'b@test.local', 'agent');
    const agent = await ctx.login('b@test.local', 'Password123');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await admin.patch(`/api/users/${id}`, { status: 'disabled' })).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('expires idle sessions', async () => {
    const id = ctx.addUser('Agent C', 'c@test.local', 'agent');
    const agent = await ctx.login('c@test.local', 'Password123');
    run(ctx.db, "UPDATE sessions SET last_seen = datetime('now', '-2 hours') WHERE user_id = ?", [id]);
    const r = await agent.get('/api/auth/me');
    expect(r.status).toBe(401);
    expect(r.headers['x-session-expired']).toBe('inactivity');
  });

  it('supports admin-issued reset links', async () => {
    const id = ctx.addUser('Agent D', 'd@test.local', 'agent');
    const r = await admin.post(`/api/users/${id}/reset-password`, { mode: 'link' });
    const token = new URL('http://x' + r.body.reset_path).searchParams.get('token')!;
    const st = (await import('supertest')).default;
    const reset = await st(ctx.app).post('/api/auth/reset').set('X-Requested-With', 'reaal').send({ token, password: 'NewPass123' });
    expect(reset.status).toBe(200);
    await ctx.login('d@test.local', 'NewPass123');
    const reuse = await st(ctx.app).post('/api/auth/reset').set('X-Requested-With', 'reaal').send({ token, password: 'Other1234' });
    expect(reuse.status).toBe(400);
  });

  it('forces temporary passwords to be changed', async () => {
    const res = await admin.post('/api/users', { name: 'New Agent', email: 'new@test.local', role_id: get<any>(ctx.db, "SELECT id FROM roles WHERE key='agent'").id });
    const agent = await ctx.login('new@test.local', res.body.temporary_password);
    expect((await agent.get('/api/units')).status).toBe(428);
    expect((await agent.post('/api/auth/change-password', { current_password: res.body.temporary_password, new_password: 'MyPass1234' })).status).toBe(200);
    expect((await agent.get('/api/units')).status).toBe(200);
  });
});

describe('permissions', () => {
  it('agents cannot export or manage users by default', async () => {
    ctx.addUser('Agent', 'agent@test.local', 'agent');
    const agent = await ctx.login('agent@test.local', 'Password123');
    expect((await agent.get('/api/export/units')).status).toBe(403);
    expect((await agent.get('/api/users')).status).toBe(403);
    expect((await agent.get('/api/activity')).status).toBe(200); // own activity only
  });

  it('permissions are configurable per role', async () => {
    ctx.addUser('Agent', 'agent@test.local', 'agent');
    const agentRole = get<any>(ctx.db, "SELECT * FROM roles WHERE key='agent'");
    const perms = [...JSON.parse(agentRole.permissions), 'inventory.export'];
    expect((await admin.patch(`/api/roles/${agentRole.id}`, { permissions: perms })).status).toBe(200);
    const agent = await ctx.login('agent@test.local', 'Password123');
    expect((await agent.get('/api/export/units?format=csv')).status).toBe(200);
  });

  it('masks owner contact details without owners.contact', async () => {
    await createOwner(admin, { name: 'Ahmed Mohamed', primary_phone: '01012345678' });
    const role = get<any>(ctx.db, "SELECT * FROM roles WHERE key='agent'");
    const perms = JSON.parse(role.permissions).filter((p: string) => p !== 'owners.contact');
    run(ctx.db, 'UPDATE roles SET permissions = ? WHERE id = ?', [JSON.stringify(perms), role.id]);
    ctx.addUser('Agent', 'agent@test.local', 'agent');
    const agent = await ctx.login('agent@test.local', 'Password123');
    const list = await agent.get('/api/owners');
    expect(list.body.rows[0].primary_phone).not.toBe('01012345678');
    expect(list.body.rows[0].contact_hidden).toBe(true);
  });

  it('managers cannot modify super admin accounts', async () => {
    ctx.addUser('Manager', 'm@test.local', 'admin');
    const mgr = await ctx.login('m@test.local', 'Password123');
    const adminId = get<any>(ctx.db, "SELECT id FROM users WHERE email='admin@test.local'").id;
    expect((await mgr.patch(`/api/users/${adminId}`, { status: 'disabled' })).status).toBe(403);
    const superRole = get<any>(ctx.db, "SELECT id FROM roles WHERE key='super_admin'").id;
    expect((await mgr.post('/api/users', { name: 'X', email: 'x@test.local', role_id: superRole })).status).toBe(403);
  });
});

describe('owners and search', () => {
  it('finds owners by phone regardless of formatting', async () => {
    const id = await createOwner(admin, { name: 'Ahmed Mohamed', primary_phone: '+20 101 234 5678' });
    await createUnit(admin, { owner_id: id, project_id: projectId(ctx.db, 'Mivida'), unit_number: 'A12', property_type: 'villa' });
    const res = await admin.get('/api/search?q=01012345678');
    expect(res.body.owners).toHaveLength(1);
    expect(res.body.owners[0].name).toBe('Ahmed Mohamed');
    expect(res.body.owners[0].unit_count).toBe(1);
    const partial = await admin.get('/api/search?q=2345678');
    expect(partial.body.owners).toHaveLength(1);
  });

  it('detects duplicate owners by phone and logs acknowledged duplicates', async () => {
    await createOwner(admin, { name: 'Ahmed Mohamed', primary_phone: '01012345678' });
    const dup = await admin.post('/api/owners', { name: 'A. Mohamed', primary_phone: '0020 10 1234 5678' });
    expect(dup.status).toBe(409);
    expect(dup.body.duplicates[0].reasons).toContain('Same phone number');
    const forced = await admin.post('/api/owners', { name: 'A. Mohamed', primary_phone: '0020 10 1234 5678', confirm_duplicate: true });
    expect(forced.status).toBe(201);
    expect(get(ctx.db, "SELECT 1 FROM activity WHERE action = 'duplicate_acknowledged'")).toBeTruthy();
  });

  it('owner profile lists owned units', async () => {
    const id = await createOwner(admin, { name: 'Owner', primary_phone: '01011111111' });
    await createUnit(admin, { owner_id: id, project_id: projectId(ctx.db, 'Mivida'), unit_number: 'A12' });
    await createUnit(admin, { owner_id: id, project_id: projectId(ctx.db, 'Marassi'), unit_number: 'V81' });
    const res = await admin.get(`/api/owners/${id}`);
    expect(res.body.units.map((u: any) => u.project).sort()).toEqual(['Marassi', 'Mivida']);
  });
});

describe('inventory', () => {
  it('fills developer from project and canonicalises master values', async () => {
    const id = await createUnit(admin, { project_id: projectId(ctx.db, 'Mivida'), unit_number: 'a-12', property_type: 'VILLA', asking_price: '42M' });
    const u = (await admin.get(`/api/units/${id}`)).body;
    expect(u.developer).toBe('Emaar');
    expect(u.property_type).toBe('Villa');
    expect(u.asking_price).toBe(42_000_000);
  });

  it('flags project/unit duplicates, allowing an acknowledged create', async () => {
    const p = projectId(ctx.db, 'Mivida');
    await createUnit(admin, { project_id: p, unit_number: 'A12' });
    const dup = await admin.post('/api/units', { project_id: p, unit_number: 'a 12' });
    expect(dup.status).toBe(409);
    expect(dup.body.duplicates).toHaveLength(1);
    expect((await admin.post('/api/units', { project_id: p, unit_number: 'a 12', confirm_duplicate: true })).status).toBe(201);
  });

  it('creates a new owner together with a unit', async () => {
    const res = await admin.post('/api/units', { project_id: projectId(ctx.db, 'Mivida'), unit_number: 'B1', new_owner: { name: 'Fresh Owner', primary_phone: '01234567890' } });
    expect(res.status).toBe(201);
    expect(res.body.owner_id).toBeTruthy();
  });

  it('filters combinations of criteria', async () => {
    const mivida = projectId(ctx.db, 'Mivida');
    await createUnit(admin, { project_id: mivida, unit_number: 'A1', property_type: 'Villa', bedrooms: 4, asking_price: 42e6, bua: 350 });
    await createUnit(admin, { project_id: mivida, unit_number: 'A2', property_type: 'Villa', bedrooms: 3, asking_price: 42e6, bua: 350 });
    await createUnit(admin, { project_id: mivida, unit_number: 'A3', property_type: 'Villa', bedrooms: 5, asking_price: 60e6, bua: 400 });
    await createUnit(admin, { project_id: mivida, unit_number: 'A4', property_type: 'Villa', bedrooms: 4, asking_price: 35e6, bua: 320, status: 'Sold' });
    const filters = { project_ids: [mivida], property_types: ['Villa'], bedrooms_min: 4, price_min: 30e6, price_max: 50e6, bua_min: 300, status: ['Available'] };
    const res = await admin.get(`/api/units?filters=${encodeURIComponent(JSON.stringify(filters))}`);
    expect(res.body.rows.map((r: any) => r.unit_number)).toEqual(['A1']);
  });

  it('searches "Mivida A12" across project and unit number', async () => {
    await createUnit(admin, { project_id: projectId(ctx.db, 'Mivida'), unit_number: 'A12' });
    await createUnit(admin, { project_id: projectId(ctx.db, 'Marassi'), unit_number: 'A12' });
    const res = await admin.get(`/api/units?filters=${encodeURIComponent(JSON.stringify({ q: 'Mivida A12' }))}`);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].project).toBe('Mivida');
  });

  it('logs field changes including price and status', async () => {
    const id = await createUnit(admin, { project_id: projectId(ctx.db, 'Mivida'), unit_number: 'A12', asking_price: 40e6 });
    await admin.patch(`/api/units/${id}`, { asking_price: 42e6 });
    await admin.patch(`/api/units/${id}`, { status: 'Sold' });
    const log = (await admin.get(`/api/activity?entity_type=unit&entity_id=${id}`)).body.rows;
    const messages = log.map((l: any) => l.message);
    expect(messages).toContain('changed Mivida A12 asking price from 40,000,000 to 42,000,000');
    expect(messages).toContain('changed Mivida A12 from Available to Sold');
    const status = log.find((l: any) => l.action === 'status_changed');
    expect(status.old_value).toBe('Available');
    expect(status.new_value).toBe('Sold');
  });

  it('rejects invalid inline values with a field error', async () => {
    const id = await createUnit(admin, { project_id: projectId(ctx.db, 'Mivida'), unit_number: 'A12' });
    const res = await admin.patch(`/api/units/${id}`, { bua: 'large' });
    expect(res.status).toBe(400);
    expect(res.body.fields.bua).toBeTruthy();
  });

  it('bulk updates and verifies', async () => {
    const p = projectId(ctx.db, 'Mivida');
    const a = await createUnit(admin, { project_id: p, unit_number: 'A1' });
    const b = await createUnit(admin, { project_id: p, unit_number: 'A2' });
    expect((await admin.post('/api/units/bulk', { ids: [a, b], patch: { status: 'Reserved' } })).status).toBe(200);
    expect((await admin.post('/api/units/verify', { ids: [a, b] })).status).toBe(200);
    const rows = (await admin.get('/api/units')).body.rows;
    expect(rows.every((r: any) => r.status === 'Reserved' && r.last_verified)).toBe(true);
  });

  it('archives rather than deleting, and purge needs confirmation', async () => {
    const id = await createUnit(admin, { project_id: projectId(ctx.db, 'Mivida'), unit_number: 'A12' });
    expect((await admin.delete(`/api/units/${id}`, { confirm: 'U-00001' })).status).toBe(400); // not archived yet
    await admin.post(`/api/units/${id}/archive`);
    expect((await admin.get('/api/units')).body.total).toBe(0);
    expect((await admin.delete(`/api/units/${id}`, { confirm: 'nope' })).status).toBe(400);
    expect((await admin.delete(`/api/units/${id}`, { confirm: `U-${String(id).padStart(5, '0')}` })).status).toBe(200);
  });

  it('agents cannot purge', async () => {
    ctx.addUser('Agent', 'agent@test.local', 'agent');
    const agent = await ctx.login('agent@test.local', 'Password123');
    const id = await createUnit(agent, { project_id: projectId(ctx.db, 'Mivida'), unit_number: 'A12' });
    expect((await agent.post(`/api/units/${id}/archive`)).status).toBe(403);
    expect((await agent.patch(`/api/units/${id}`, { status: 'Archived' })).status).toBe(403);
  });

  it('notifies agents about stale verification once per level', async () => {
    const id = await createUnit(admin, { project_id: projectId(ctx.db, 'Mivida'), unit_number: 'A12', last_verified: '2020-01-01' });
    expect(runVerificationCheck(ctx.db)).toBe(1);
    expect(runVerificationCheck(ctx.db)).toBe(0);
    await admin.post('/api/units/verify', { ids: [id] });
    expect(runVerificationCheck(ctx.db)).toBe(0);
  });
});

describe('requirements, matching and offers', () => {
  it('matches only suitable inventory and supports manual removal', async () => {
    const mivida = projectId(ctx.db, 'Mivida');
    const good = await createUnit(admin, { project_id: mivida, unit_number: 'A12', property_type: 'Villa', bedrooms: 4, bua: 350, asking_price: 42e6 });
    const alsoGood = await createUnit(admin, { project_id: mivida, unit_number: 'C21', property_type: 'Villa', bedrooms: 5, bua: 380, asking_price: 45e6 });
    await createUnit(admin, { project_id: mivida, unit_number: 'B18', property_type: 'Villa', bedrooms: 4, bua: 350, asking_price: 42e6, status: 'Sold' });
    await createUnit(admin, { project_id: mivida, unit_number: 'X1', property_type: 'Apartment', bedrooms: 4, bua: 350, asking_price: 42e6 });
    await createUnit(admin, { project_id: mivida, unit_number: 'X2', property_type: 'Villa', bedrooms: 4, bua: 350, asking_price: 80e6 });
    const r = await admin.post('/api/requirements', { client_name: 'Karim', preferred_project_ids: [mivida], property_types: ['Villa'], min_bedrooms: 4, max_price: 50e6, min_bua: 300 });
    expect(r.status).toBe(201);
    const matches = (await admin.get(`/api/requirements/${r.body.id}/matches`)).body;
    expect(matches.map((m: any) => m.id).sort()).toEqual([good, alsoGood].sort());
    await admin.post(`/api/requirements/${r.body.id}/exclusions`, { unit_ids: [alsoGood] });
    const after = (await admin.get(`/api/requirements/${r.body.id}/matches`)).body;
    expect(after.map((m: any) => m.id)).toEqual([good]);
  });

  it('notifies the requirement agent when a new matching unit appears', async () => {
    const agentId = ctx.addUser('Sarah', 'sarah@test.local', 'agent');
    const mivida = projectId(ctx.db, 'Mivida');
    await admin.post('/api/requirements', { client_name: 'Karim', preferred_project_ids: [mivida], assigned_user_id: agentId });
    await createUnit(admin, { project_id: mivida, unit_number: 'Z9' });
    const n = get<any>(ctx.db, "SELECT * FROM notifications WHERE user_id = ? AND type = 'match'", [agentId]);
    expect(n.message).toContain('Mivida Z9');
  });

  it('generates, saves and lists a multi-unit offer without editing the database', async () => {
    const owner = await createOwner(admin, { name: 'Ahmed Mohamed', primary_phone: '01012345678' });
    const mivida = projectId(ctx.db, 'Mivida');
    const a = await createUnit(admin, { owner_id: owner, project_id: mivida, unit_number: 'A12', property_type: 'Standalone Villa', bua: 350, land_area: 500, bedrooms: 4, finishing: 'Fully Finished', asking_price: 42e6 });
    const b = await createUnit(admin, { owner_id: owner, project_id: mivida, unit_number: 'C21', property_type: 'Townhouse', bua: 250, asking_price: 30e6 });
    const gen = await admin.post('/api/offers/generate', { unit_ids: [a, b], template: 'whatsapp', client_name: 'Karim' });
    expect(gen.status).toBe(200);
    expect(gen.body.content).toContain('Hello Karim');
    expect(gen.body.content).toContain('*1) MIVIDA*');
    expect(gen.body.content).toContain('*2) MIVIDA*');
    expect(gen.body.content).not.toContain('01012345678');
    expect(gen.body.tokens.price).toContain('42,000,000 EGP');

    const internal = await admin.post('/api/offers/generate', { unit_ids: [a], template: 'internal' });
    expect(internal.body.content).toContain('01012345678');

    const edited = gen.body.content + '\nSpecial note for Karim';
    const saved = await admin.post('/api/offers', { unit_ids: [a, b], template: 'whatsapp', content: edited, client_name: 'Karim' });
    expect(saved.status).toBe(201);
    const offer = (await admin.get(`/api/offers/${saved.body.id}`)).body;
    expect(offer.content).toBe(edited);
    expect(offer.units.map((u: any) => u.id)).toEqual([a, b]);
    const unit = (await admin.get(`/api/units/${a}`)).body;
    expect(unit.asking_price).toBe(42e6);
    expect(unit.offers).toHaveLength(1);
  });

  it('produces a PDF', async () => {
    const a = await createUnit(admin, { project_id: projectId(ctx.db, 'Mivida'), unit_number: 'A12', property_type: 'Villa', bua: 350, asking_price: 42e6 });
    const res = await admin.raw.post('/api/offers/pdf').set('X-Requested-With', 'reaal').send({ unit_ids: [a] }).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('notes and mentions', () => {
  it('stores notes and notifies mentioned users', async () => {
    const sarah = ctx.addUser('Sarah Ali', 'sarah@test.local', 'agent');
    const owner = await createOwner(admin, { name: 'Owner', primary_phone: '01011111111' });
    const res = await admin.post('/api/notes', { entity_type: 'owner', entity_id: owner, content: 'Owner willing to negotiate slightly. Call after 5 PM. @Sarah Ali' });
    expect(res.status).toBe(201);
    const notes = (await admin.get(`/api/notes?entity_type=owner&entity_id=${owner}`)).body;
    expect(notes[0].author_name).toBe('Admin User');
    expect(get(ctx.db, "SELECT 1 FROM notifications WHERE user_id = ? AND type = 'mention'", [sarah])).toBeTruthy();
  });
});

describe('import and export', () => {
  async function xlsx(rows: (string | number)[][]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('runs the full upload → map → validate → confirm flow', async () => {
    await createUnit(admin, { project_id: projectId(ctx.db, 'Mivida'), unit_number: 'A12' });
    const file = await xlsx([
      ['Client Name', 'Mobile', 'Compound', 'Unit', 'Type', 'BUA', 'Price', 'Random Column'],
      ['Ahmed Mohamed', '01012345678', 'Mivida', 'A12', 'Villa', '350', '42M', 'x'],
      ['Mona Adel', '01122334455', 'Mivida', 'C21', 'townhouse', '250', '30,000,000', 'y'],
      ['Mona Adel', '01122334455', 'New Compound', 'Z1', 'Apartment', '150', '8.5m', 'z'],
      ['Bad Phone', '123', 'Mivida', 'B2', 'Villa', 'big', '10M', ''],
      ['No Project', '01000000000', '', 'Q1', 'Villa', '100', '10M', ''],
    ]);
    const up = await admin.upload('/api/imports').field('kind', 'inventory').attach('file', file, 'inventory.xlsx');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.total).toBe(5);
    expect(up.body.mapping).toMatchObject({ 'Client Name': 'owner_name', Mobile: 'primary_phone', Compound: 'project', Price: 'asking_price' });

    const val = await admin.post(`/api/imports/${up.body.id}/validate`, { mapping: up.body.mapping });
    expect(val.status).toBe(200);
    expect(val.body.summary).toMatchObject({ total: 5, ready: 2, duplicates: 1, errors: 2 });
    expect(val.body.summary.ignored_columns).toContain('Random Column');
    expect(val.body.summary.new_projects).toContain('New Compound');
    const bad = val.body.rows.find((r: any) => r.row === 5);
    expect(bad.errors.join(' ')).toMatch(/Invalid phone/);
    expect(bad.errors.join(' ')).toMatch(/Invalid number in BUA/);

    const done = await admin.post(`/api/imports/${up.body.id}/confirm`, { duplicates: 'skip' });
    expect(done.status).toBe(200);
    expect(done.body.result).toMatchObject({ created_units: 2, skipped: 1, errors: 2, created_owners: 1 });
    const mona = get<any>(ctx.db, "SELECT COUNT(*) AS n FROM owners WHERE name = 'Mona Adel'");
    expect(mona.n).toBe(1); // both of Mona's rows share one owner
    expect(get<any>(ctx.db, "SELECT property_type FROM units WHERE unit_number = 'C21'").property_type).toBe('Townhouse');
    expect(get(ctx.db, "SELECT 1 FROM projects WHERE name = 'New Compound'")).toBeTruthy();
  });

  it('imports CSV owners and updates duplicates when asked', async () => {
    await createOwner(admin, { name: 'Ahmed Mohamed', primary_phone: '01012345678' });
    const csv = Buffer.from('Name,Phone,Email\nAhmed Mohamed,+201012345678,ahmed@example.com\nNew Person,01111111111,\n');
    const up = await admin.upload('/api/imports').field('kind', 'owners').attach('file', csv, 'owners.csv');
    expect(up.status).toBe(201);
    const val = await admin.post(`/api/imports/${up.body.id}/validate`, {});
    expect(val.body.summary).toMatchObject({ ready: 1, duplicates: 1 });
    const done = await admin.post(`/api/imports/${up.body.id}/confirm`, { duplicates: 'update' });
    expect(done.body.result).toMatchObject({ created_owners: 1, updated_owners: 1 });
    expect(get<any>(ctx.db, "SELECT email FROM owners WHERE name = 'Ahmed Mohamed'").email).toBe('ahmed@example.com');
  });

  it('exports filtered inventory and logs the export', async () => {
    const p = projectId(ctx.db, 'Mivida');
    await createUnit(admin, { project_id: p, unit_number: 'A1', status: 'Available' });
    await createUnit(admin, { project_id: p, unit_number: 'A2', status: 'Sold' });
    const res = await admin.get(`/api/export/units?format=csv&filters=${encodeURIComponent(JSON.stringify({ status: ['Sold'] }))}`);
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('A2');
    const log = get<any>(ctx.db, "SELECT * FROM activity WHERE action = 'exported'");
    expect(log.message).toContain('exported 1 inventory record (filtered inventory, CSV)');
  });

  it('neutralises formula injection in exports', async () => {
    await createOwner(admin, { name: '=HYPERLINK("http://evil")', primary_phone: '01099999999' });
    const res = await admin.get('/api/export/owners?format=csv');
    expect(res.text).toContain(`"'=HYPERLINK`);
  });
});

describe('saved views and settings', () => {
  it('shares views with the team', async () => {
    ctx.addUser('Agent', 'agent@test.local', 'agent');
    await admin.post('/api/views', { name: 'Mivida Villas', shared: true, config: { filters: { property_types: ['Villa'] }, sort: [] } });
    await admin.post('/api/views', { name: 'Private', shared: false, config: { filters: {}, sort: [] } });
    const agent = await ctx.login('agent@test.local', 'Password123');
    const views = (await agent.get('/api/views')).body;
    expect(views.map((v: any) => v.name)).toEqual(['Mivida Villas']);
    expect((await agent.delete(`/api/views/${views[0].id}`)).status).toBe(403);
  });

  it('prevents case-variant master data duplicates', async () => {
    const res = await admin.post('/api/master/projects', { name: 'MIVIDA' });
    expect(res.status).toBe(409);
  });

  it('updates configurable thresholds', async () => {
    const res = await admin.patch('/api/settings', { verification: { attention_days: 7, outdated_days: 21 } });
    expect(res.body.verification.attention_days).toBe(7);
    const me = (await admin.get('/api/auth/me')).body;
    expect(me.config.verification).toEqual({ attention: 7, outdated: 21 });
  });
});
