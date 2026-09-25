import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Deletes the local database and uploaded files so the app starts empty.
// Usage: npm run reset -- --yes
const dbFile = process.env.DATABASE_FILE || path.join(config.dataDir, 'reaal.db');
if (!process.argv.includes('--yes')) {
  console.log(`This permanently deletes ALL data:\n  ${dbFile}\n  ${config.uploadDir}\nStop the app first, then run:  npm run reset -- --yes`);
  process.exit(1);
}
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(config.uploadDir, { recursive: true, force: true });
console.log('All data deleted. Start the app with "npm run dev"; the first Super Admin is created again.');
