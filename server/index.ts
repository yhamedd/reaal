import path from 'node:path';
import { connectFromEnv } from './connect.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';

const db = await connectFromEnv();
startJobs(db);

const app = createApp(db, { staticDir: path.resolve('dist') });
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Reaal is running on http://localhost:${port}`));
