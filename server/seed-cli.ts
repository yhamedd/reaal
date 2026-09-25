import { connectFromEnv } from './connect.js';
import { seedDemo } from './seed.js';

const db = await connectFromEnv();
const count = Number(process.argv[2] || 240);
console.log((await seedDemo(db, { units: count })) ? `Seeded ${count} demo units. Team logins use password "Password123".` : 'Inventory is not empty – skipped seeding.');
