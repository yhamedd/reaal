import fs from 'node:fs';
import { config } from './config.js';
import { localDbDir } from './connect.js';

// Deletes the LOCAL database and uploaded files so the app starts empty.
// It never touches Supabase. Usage: npm run reset -- --yes
if (process.env.DATABASE_URL) {
  console.log('DATABASE_URL is set: this command only resets the local database. Unset it to reset local data.');
  process.exit(1);
}
if (!process.argv.includes('--yes')) {
  console.log(`This permanently deletes ALL local data:\n  ${localDbDir()}\n  ${config.uploadDir}\nStop the app first, then run:  npm run reset -- --yes`);
  process.exit(1);
}
fs.rmSync(localDbDir(), { recursive: true, force: true });
fs.rmSync(config.uploadDir, { recursive: true, force: true });
console.log('All local data deleted. Start the app with "npm run dev"; the first Super Admin is created again.');
