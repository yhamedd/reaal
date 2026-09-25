import { afterEach, describe, expect, it, vi } from 'vitest';

const blobs = new Map<string, Buffer>();
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key: string, data: Buffer, opts: { access: string }) => {
    expect(opts.access).toBe('public');
    const url = `https://blob.example/${key}-rnd`;
    blobs.set(url, data);
    return { url };
  }),
  del: vi.fn(async (url: string) => void blobs.delete(url)),
}));

describe('storage', () => {
  afterEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    vi.unstubAllGlobals();
  });

  it('uses Vercel Blob when a token is configured', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'test';
    vi.stubGlobal('fetch', async (url: string) => {
      const b = blobs.get(url);
      return { ok: !!b, arrayBuffer: async () => b!.buffer.slice(b!.byteOffset, b!.byteOffset + b!.length) };
    });
    const { storage } = await import('./storage.js');
    const stored = await storage().put('Front Photo.JPG', Buffer.from('img'), 'image/jpeg');
    expect(stored).toMatch(/^https:\/\/blob\.example\/uploads\/\d+-[0-9a-f]+\.jpg-rnd$/);
    expect((await storage().get(stored))?.toString()).toBe('img');
    await storage().del(stored);
    expect(await storage().get(stored)).toBeNull();
  });

  it('falls back to local disk', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reaal-store-'));
    const { storage } = await import('./storage.js');
    const stored = await storage().put('plan.png', Buffer.from('png'), 'image/png');
    expect(stored).not.toContain('/');
    expect((await storage().get(stored))?.toString()).toBe('png');
    await storage().del(stored);
    expect(await storage().get(stored)).toBeNull();
  });
});
