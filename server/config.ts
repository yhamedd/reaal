import path from 'node:path';

export const config = {
  dataDir: process.env.DATA_DIR || path.resolve('data'),
  get uploadDir() {
    return process.env.UPLOAD_DIR || path.join(this.dataDir, 'uploads');
  },
  // Vercel functions accept request bodies up to 4.5 MB.
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || (process.env.VERCEL ? 4 : 20)),
};
