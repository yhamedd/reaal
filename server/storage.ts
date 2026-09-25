import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Where uploaded files live. On Vercel (BLOB_READ_WRITE_TOKEN set) files go to
 * Vercel Blob; locally they go to DATA_DIR/uploads. Either way the app serves
 * them through /api/files so permission checks always apply — blob URLs are
 * random and never sent to the browser.
 */
export interface Storage {
  put(originalName: string, data: Buffer, contentType: string): Promise<string>;
  get(stored: string): Promise<Buffer | null>;
  del(stored: string): Promise<void>;
}

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

const blobStorage: Storage = {
  async put(originalName, data, contentType) {
    const { put } = await import('@vercel/blob');
    const r = await put(`uploads/${safeName(originalName)}`, data, { access: 'public', contentType, addRandomSuffix: true });
    return r.url;
  },
  async get(stored) {
    if (!stored.startsWith('https://')) return diskStorage.get(stored);
    const res = await fetch(stored);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  },
  async del(stored) {
    if (!stored.startsWith('https://')) return diskStorage.del(stored);
    const { del } = await import('@vercel/blob');
    await del(stored);
  },
};

export function storage(): Storage {
  return process.env.BLOB_READ_WRITE_TOKEN ? blobStorage : diskStorage;
}
