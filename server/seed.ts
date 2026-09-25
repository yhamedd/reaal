import { all, get, run, tx, type DB } from './db.js';
import { hashPassword } from './auth.js';
import { normalizePhone } from '../shared/phone.js';
import { normalizeUnitNumber } from './util.js';

/** Populates realistic demo data. Only runs on an empty inventory. */
export async function seedDemo(db: DB, { units = 240 } = {}) {
  if ((await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM units'))!.n > 0) return false;
  let seed = 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

  await tx(db, async (db) => {
    const roles = new Map((await all<any>(db, 'SELECT id, key FROM roles')).map((r) => [r.key, r.id]));
    const team = [
      ['Ahmed Hassan', 'ahmed@reaal.local', 'admin', '01001112233'],
      ['Youssef Nabil', 'youssef@reaal.local', 'agent', '01002223344'],
      ['Sarah Mostafa', 'sarah@reaal.local', 'agent', '01003334455'],
      ['Mariam Fathy', 'mariam@reaal.local', 'agent', '01004445566'],
    ];
    for (const [name, email, role, phone] of team) {
      if (!await get(db, 'SELECT 1 FROM users WHERE email = ?', [email])) {
        await run(db, 'INSERT INTO users (name, email, phone, password_hash, role_id) VALUES (?, ?, ?, ?, ?)', [name, email, phone, hashPassword('Password123'), roles.get(role)]);
      }
    }
    const userIds = (await all<{ id: number }>(db, 'SELECT id FROM users')).map((u) => u.id);
    const projects = await all<any>(db, 'SELECT id, name, developer_id FROM projects');
    const first = ['Ahmed', 'Mohamed', 'Mahmoud', 'Omar', 'Karim', 'Hany', 'Tarek', 'Mona', 'Nadia', 'Heba', 'Rania', 'Dina', 'Sherif', 'Amr', 'Laila', 'Yasmin', 'Khaled', 'Hossam'];
    const last = ['Mohamed', 'Hassan', 'Ali', 'Ibrahim', 'Adel', 'Fawzy', 'Samir', 'Farouk', 'Gamal', 'Zaki', 'Kamal', 'Salah', 'Mansour', 'Sabry'];
    const owners: number[] = [];
    for (let i = 0; i < Math.ceil(units / 2); i++) {
      const phone = `01${pick(['0', '1', '2', '5'])}${String(Math.floor(rand() * 1e8)).padStart(8, '0')}`;
      const name = `${pick(first)} ${pick(last)}`;
      const { lastId } = await run(
        db,
        `INSERT INTO owners (name, primary_phone, primary_phone_norm, whatsapp, whatsapp_norm, email, assigned_user_id, source, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
        [name, phone, normalizePhone(phone), phone, normalizePhone(phone), rand() > 0.6 ? `${name.split(' ')[0].toLowerCase()}${i}@example.com` : null, pick(userIds), pick(['Referral', 'Facebook', 'Walk-in', 'Broker', 'Website']), rand() > 0.93 ? 'Do Not Contact' : 'Active', pick(userIds), `-${Math.floor(rand() * 200)} days`],
      );
      owners.push(lastId);
    }
    const types: [string, number, number, number][] = [
      ['Apartment', 110, 220, 0],
      ['Standalone Villa', 280, 480, 500],
      ['Townhouse', 190, 260, 250],
      ['Twin House', 230, 320, 350],
      ['Chalet', 90, 180, 0],
      ['Duplex', 200, 300, 0],
      ['Penthouse', 180, 300, 0],
    ];
    const statuses = ['Available', 'Available', 'Available', 'Available', 'Reserved', 'Sold', 'Off Market', 'Pending Verification'];
    for (let i = 0; i < units; i++) {
      const p = pick(projects);
      const [type, minB, maxB, land] = pick(types);
      const bua = Math.round(minB + rand() * (maxB - minB));
      const beds = Math.max(1, Math.round(bua / 70));
      const pricePerM = 45000 + rand() * 90000;
      const asking = Math.round((bua * pricePerM) / 100000) * 100000;
      const original = Math.round((asking * (0.55 + rand() * 0.3)) / 100000) * 100000;
      const paid = Math.round((original * rand()) / 10000) * 10000;
      const unitNo = `${pick(['A', 'B', 'C', 'D', 'V', 'T'])}${Math.floor(rand() * 200) + 1}`;
      const verifiedDaysAgo = rand() > 0.15 ? Math.floor(rand() * 60) : null;
      await run(
        db,
        `INSERT INTO units (owner_id, developer_id, project_id, phase, unit_number, unit_number_norm, property_type, bua, land_area, bedrooms, bathrooms, floors,
                            finishing, furnished, view, delivery, asking_price, original_price, paid_amount, remaining_amount, maintenance, status,
                            assigned_user_id, source, last_verified, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`,
        [
          pick(owners), p.developer_id, p.id, `Phase ${Math.floor(rand() * 6) + 1}`, unitNo, normalizeUnitNumber(unitNo), type, bua,
          land ? Math.round(land * (0.8 + rand() * 0.6)) : null, beds, Math.max(1, beds - (rand() > 0.5 ? 1 : 0)), land ? pick([2, 3]) : 1,
          pick(['Fully Finished', 'Semi Finished', 'Core & Shell']), pick(['Unfurnished', 'Unfurnished', 'Semi Furnished', 'Furnished']),
          pick(['Garden', 'Pool', 'Lagoon', 'Landscape', 'Street']), pick(['Ready to move', '2026', '2027', '2028']), asking, original, paid,
          original - paid, Math.round(original * 0.08), pick(statuses), pick(userIds), pick(['Referral', 'Broker', 'Developer', 'Facebook']),
          verifiedDaysAgo === null ? null : new Date(Date.now() - verifiedDaysAgo * 86400000).toISOString().slice(0, 10), pick(userIds),
          `-${Math.floor(rand() * 120)} days`, `-${Math.floor(rand() * 30)} days`,
        ],
      );
    }
    const mivida = projects.find((p) => p.name === 'Mivida');
    const reqs = [
      ['Karim Samy', '01099887766', [mivida?.id], ['Standalone Villa', 'Twin House'], 250, null, 3, 20_000_000, 60_000_000, 'High'],
      ['Nour El Din', '01155667788', [], ['Apartment'], 120, 200, 2, 5_000_000, 15_000_000, 'Medium'],
      ['Hala Mahmoud', '01233445566', [], ['Chalet'], null, null, 2, null, 20_000_000, 'Urgent'],
    ] as const;
    for (const [name, phone, projectIds, typesWanted, minBua, maxBua, minBeds, minPrice, maxPrice, priority] of reqs) {
      await run(
        db,
        `INSERT INTO requirements (client_name, phone, phone_norm, whatsapp, assigned_user_id, preferred_project_ids, property_types, min_bua, max_bua, min_bedrooms, min_price, max_price, priority, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, phone, normalizePhone(phone), phone, pick(userIds), JSON.stringify(projectIds.filter(Boolean)), JSON.stringify(typesWanted), minBua, maxBua, minBeds, minPrice, maxPrice, priority, pick(userIds)],
      );
    }
    await run(db, "INSERT INTO activity (user_id, action, message) VALUES (?, 'seeded', 'loaded demo data')", [userIds[0]]);
  });
  return true;
}
