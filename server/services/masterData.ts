import { all, get, run, type DB } from '../db.js';

export async function findDeveloper(db: DB, name: string | null | undefined): Promise<number | null> {
  if (!name?.trim()) return null;
  return (await get<{ id: number }>(db, 'SELECT id FROM developers WHERE name = ? COLLATE NOCASE', [name.trim()]))?.id ?? null;
}

export async function ensureDeveloper(db: DB, name: string): Promise<number> {
  return await findDeveloper(db, name) ?? (await run(db, 'INSERT INTO developers (name) VALUES (?)', [name.trim()])).lastId;
}

export async function findProject(db: DB, name: string | null | undefined): Promise<{ id: number; developer_id: number | null } | null> {
  if (!name?.trim()) return null;
  return await get<any>(db, 'SELECT id, developer_id FROM projects WHERE name = ? COLLATE NOCASE', [name.trim()]) ?? null;
}

export async function ensureProject(db: DB, name: string, developerId: number | null) {
  const found = await findProject(db, name);
  if (found) return found;
  const { lastId } = await run(db, 'INSERT INTO projects (name, developer_id) VALUES (?, ?)', [name.trim(), developerId]);
  return { id: lastId, developer_id: developerId };
}

/** Returns the canonical spelling of a master value ("villa" → "Villa"), or null if unknown. */
export async function canonicalValue(db: DB, category: string, value: string | null | undefined): Promise<string | null> {
  if (!value?.trim()) return null;
  return (await get<{ value: string }>(db, 'SELECT value FROM master_values WHERE category = ? AND value = ? COLLATE NOCASE', [category, value.trim()]))?.value ?? null;
}

export async function masterValues(db: DB, category: string): Promise<string[]> {
  return (await all<{ value: string }>(db, 'SELECT value FROM master_values WHERE category = ? AND active = 1 ORDER BY sort, value', [category])).map((r) => r.value);
}
