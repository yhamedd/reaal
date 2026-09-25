import path from 'node:path';

export const config = {
  dataDir: process.env.DATA_DIR || path.resolve('data'),
  get uploadDir() {
    return process.env.UPLOAD_DIR || path.join(this.dataDir, 'uploads');
  },
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 20),
};
