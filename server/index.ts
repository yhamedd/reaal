import path from 'node:path';
import { openDb } from './db.js';
import { bootstrap } from './bootstrap.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';
import { config } from './config.js';

const db = openDb(process.env.DATABASE_FILE || path.join(config.dataDir, 'reaal.db'));
bootstrap(db, {
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminName: process.env.ADMIN_NAME,
});
startJobs(db);

const app = createApp(db, { staticDir: path.resolve('dist') });
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Reaal is running on http://localhost:${port}`));
