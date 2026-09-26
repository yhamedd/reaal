import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Where uploaded files live. With SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set, files go to a
 * private Supabase Storage bucket; otherwise to DATA_DIR/uploads. Either way the app serves them
 * through /api/files, so permission checks always apply and storage URLs never reach the browser.
 */
export interface Storage {
  put(originalName: string, data: Buffer, contentType: string): Promise<string>;
  get(stored: string): Promise<Buffer | null>;
  del(stored: string): Promise<void>;
}

const SUPABASE_PREFIX = 'supabase:';

function safeName(originalName: string) {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

const diskStorage: Storage = {
  async put(originalName, data) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const name = safeName(originalName);
    await fs.promises.writeFile(path.join(config.uploadDir, name), data);
    return name;
  },
  async get(stored) {
    try {
      return await fs.promises.readFile(path.join(config.uploadDir, path.basename(stored)));
    } catch {
      return null;
    }
  },
  async del(stored) {
    await fs.promises.rm(path.join(config.uploadDir, path.basename(stored)), { force: true });
  },
};

type Bucket = ReturnType<ReturnType<typeof import('@supabase/supabase-js').createClient>['storage']['from']>;
let bucketPromise: Promise<Bucket> | null = null;

/** The private bucket, created on first use. */
function bucket(): Promise<Bucket> {
  bucketPromise ??= (async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const name = process.env.SUPABASE_BUCKET || 'reaal-files';
    const { error } = await client.storage.getBucket(name);
    if (error) {
      const created = await client.storage.createBucket(name, { public: false });
      if (created.error && !/already exists/i.test(created.error.message)) throw new Error(`Supabase Storage: ${created.error.message}`);
    }
    return client.storage.from(name);
  })().catch((e) => {
    bucketPromise = null;
    throw e;
  });
  return bucketPromise;
}

const supabaseStorage: Storage = {
  async put(originalName, data, contentType) {
    const key = `uploads/${safeName(originalName)}`;
    const { error } = await (await bucket()).upload(key, data, { contentType, upsert: false });
    if (error) throw new Error(`Could not store the file: ${error.message}`);
    return SUPABASE_PREFIX + key;
  },
  async get(stored) {
    if (!stored.startsWith(SUPABASE_PREFIX)) return diskStorage.get(stored);
    const { data, error } = await (await bucket()).download(stored.slice(SUPABASE_PREFIX.length));
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  },
  async del(stored) {
    if (!stored.startsWith(SUPABASE_PREFIX)) return diskStorage.del(stored);
    await (await bucket()).remove([stored.slice(SUPABASE_PREFIX.length)]);
  },
};

export function storage(): Storage {
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseStorage : diskStorage;
}
