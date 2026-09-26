import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { connectFromEnv } from './connect.js';
import { createApp } from './app.js';

// One app per warm function instance; the database connection is reused across requests.
let appPromise: Promise<Express> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  appPromise ??= connectFromEnv()
    .then((db) => createApp(db))
    .catch((e) => {
      appPromise = null; // retry on the next request instead of caching the failure
      throw e;
    });
  let app: Express;
  try {
    app = await appPromise;
  } catch (e) {
    console.error('Startup failed', e);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'The server could not connect to its database. Check DATABASE_URL (the Supabase connection string) in the Vercel project settings.' }));
    return;
  }
  app(req as any, res as any);
}
