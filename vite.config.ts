import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    // Allow GitHub Codespaces' forwarded URLs (*.app.github.dev) to reach the dev server.
    allowedHosts: ['.app.github.dev'],
    proxy: { '/api': 'http://localhost:3000' },
  },
});
