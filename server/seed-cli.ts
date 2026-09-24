import path from 'node:path';
import { openDb } from './db.js';
import { bootstrap } from './bootstrap.js';
import { seedDemo } from './seed.js';
import { config } from './config.js';

const db = openDb(process.env.DATABASE_FILE || path.join(config.dataDir, 'reaal.db'));
bootstrap(db, { adminEmail: process.env.ADMIN_EMAIL, adminPassword: process.env.ADMIN_PASSWORD });
const count = Number(process.argv[2] || 240);
console.log(seedDemo(db, { units: count }) ? `Seeded ${count} demo units. Team logins use password "Password123".` : 'Inventory is not empty – skipped seeding.');
