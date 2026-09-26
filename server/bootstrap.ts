import { all, get, run, tx, type DB } from './db.js';
import { DEFAULT_ROLES, ALL_PERMISSION_KEYS } from '../shared/permissions.js';
import { hashPassword } from './auth.js';
import { DEFAULT_TEMPLATES } from './services/offerText.js';

export const DEFAULT_MASTER: Record<string, string[]> = {
  property_type: ['Apartment', 'Villa', 'Standalone Villa', 'Townhouse', 'Twin House', 'Chalet', 'Duplex', 'Penthouse', 'Studio', 'Office', 'Retail'],
  finishing: ['Fully Finished', 'Semi Finished', 'Core & Shell', 'Ultra Super Lux', 'Super Lux'],
  source: ['Referral', 'Walk-in', 'Website', 'Facebook', 'Instagram', 'WhatsApp', 'Cold Call', 'Broker', 'Developer', 'Import'],
  view: ['Garden', 'Pool', 'Lagoon', 'Sea', 'Landscape', 'Street', 'Club House', 'Golf'],
};

/** Developer → [project, location]. Projects carry a location so inventory can be grouped by area. */
export const DEFAULT_DEVELOPERS: Record<string, [string, string][]> = {
  'Emaar Misr': [
    ['Marassi', 'North Coast'],
    ['Mivida', 'New Cairo'],
    ['Uptown Cairo', 'Mokattam'],
    ['Cairo Gate', 'Sheikh Zayed'],
  ],
  SODIC: [
    ['Villette', 'New Cairo'],
    ['SODIC West', 'Sheikh Zayed'],
    ['Eastown', 'New Cairo'],
  ],
  'Palm Hills': [
    ['Palm Hills October', '6th of October'],
    ['Palm Hills New Cairo', 'New Cairo'],
    ['Hacienda Bay', 'North Coast'],
  ],
  'Mountain View': [
    ['Mountain View iCity', 'New Cairo'],
    ['Mountain View Hyde Park', 'New Cairo'],
  ],
};

export const DEFAULT_TAGS: [string, string][] = [
  ['Motivated Seller', 'orange'],
  ['Exclusive', 'purple'],
  ['Urgent', 'red'],
  ['Cash Buyer', 'green'],
  ['Hot Unit', 'red'],
  ['Needs Verification', 'yellow'],
];

/** Idempotent: safe to call on every start. Creates roles, the first admin and default master data. */
export async function bootstrap(db: DB, opts: { adminEmail?: string; adminPassword?: string; adminName?: string } = {}) {
  await tx(db, async (db) => {
    // Several serverless instances can start at once; let one seed at a time.
    await db.query('SELECT pg_advisory_xact_lock(727275)', []);
    for (const role of DEFAULT_ROLES) {
      const existing = await get<any>(db, 'SELECT id FROM roles WHERE key = ?', [role.key]);
      if (!existing) {
        await run(db, 'INSERT INTO roles (key, name, permissions, is_system) VALUES (?, ?, ?, 1)', [
          role.key,
          role.name,
          JSON.stringify(role.permissions),
        ]);
      } else if (role.key === 'super_admin') {
        // Super Admin always holds every permission, including ones added in later versions.
        await run(db, 'UPDATE roles SET permissions = ? WHERE id = ?', [JSON.stringify(ALL_PERMISSION_KEYS), existing.id]);
      }
    }

    const userCount = (await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users'))!.n;
    if (userCount === 0) {
      const superRole = await get<any>(db, "SELECT id FROM roles WHERE key = 'super_admin'")!;
      const email = opts.adminEmail || 'admin@reaal.local';
      const password = opts.adminPassword || 'ChangeMe123';
      await run(db, 'INSERT INTO users (name, email, password_hash, role_id, must_change_password) VALUES (?, ?, ?, ?, ?)', [
        opts.adminName || 'System Admin',
        email,
        hashPassword(password),
        superRole.id,
        opts.adminPassword ? 0 : 1,
      ]);
      if (!opts.adminPassword && process.env.NODE_ENV !== 'test') {
        console.log(`\n  Created first Super Admin → ${email} / ${password} (you will be asked to change it)\n`);
      }
    }

    const hasMaster = (await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM master_values'))!.n;
    if (!hasMaster) {
      for (const [category, values] of Object.entries(DEFAULT_MASTER)) {
        for (const [i, v] of values.entries()) await run(db, 'INSERT INTO master_values (category, value, sort) VALUES (?, ?, ?)', [category, v, i]);
      }
      for (const [dev, projects] of Object.entries(DEFAULT_DEVELOPERS)) {
        const { lastId } = await run(db, 'INSERT INTO developers (name) VALUES (?)', [dev]);
        for (const [p, location] of projects) await run(db, 'INSERT INTO projects (name, developer_id, location) VALUES (?, ?, ?)', [p, lastId, location]);
      }
      for (const [name, color] of DEFAULT_TAGS) await run(db, 'INSERT INTO tags (name, color) VALUES (?, ?)', [name, color]);
    }

    const existingTemplates = new Set((await all<{ key: string }>(db, 'SELECT key FROM offer_templates')).map((t) => t.key));
    for (const t of DEFAULT_TEMPLATES) {
      if (existingTemplates.has(t.key)) continue;
      await run(
        db,
        `INSERT INTO offer_templates (key, name, description, header, unit_block, separator, footer, include_owner)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.key, t.name, t.description ?? '', t.header, t.unit_block, t.separator, t.footer, t.include_owner ? 1 : 0],
      );
    }
  });
}
