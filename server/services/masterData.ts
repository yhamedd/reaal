import { all, get, run, type DB } from '../db.js';

export function findDeveloper(db: DB, name: string | null | undefined): number | null {
  if (!name?.trim()) return null;
  return get<{ id: number }>(db, 'SELECT id FROM developers WHERE name = ? COLLATE NOCASE', [name.trim()])?.id ?? null;
}

export function ensureDeveloper(db: DB, name: string): number {
  return findDeveloper(db, name) ?? run(db, 'INSERT INTO developers (name) VALUES (?)', [name.trim()]).lastId;
}

export function findProject(db: DB, name: string | null | undefined): { id: number; developer_id: number | null } | null {
  if (!name?.trim()) return null;
  return get<any>(db, 'SELECT id, developer_id FROM projects WHERE name = ? COLLATE NOCASE', [name.trim()]) ?? null;
}

export function ensureProject(db: DB, name: string, developerId: number | null) {
  const found = findProject(db, name);
  if (found) return found;
  const { lastId } = run(db, 'INSERT INTO projects (name, developer_id) VALUES (?, ?)', [name.trim(), developerId]);
  return { id: lastId, developer_id: developerId };
}

/** Returns the canonical spelling of a master value ("villa" → "Villa"), or null if unknown. */
export function canonicalValue(db: DB, category: string, value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return get<{ value: string }>(db, 'SELECT value FROM master_values WHERE category = ? AND value = ? COLLATE NOCASE', [category, value.trim()])?.value ?? null;
}

export function masterValues(db: DB, category: string): string[] {
  return all<{ value: string }>(db, 'SELECT value FROM master_values WHERE category = ? AND active = 1 ORDER BY sort, value', [category]).map((r) => r.value);
}
