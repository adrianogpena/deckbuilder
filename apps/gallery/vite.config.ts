import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { DEV_PORT } from '@deckbuilder/server-core/protocol';

// Dev: `deckbuilder dev` runs the server on DEV_PORT; Vite proxies the API there. changeOrigin
// stays false: the server's Origin check needs the browser's Origin and Host.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // The editor chunk (CodeMirror and its language parsers, ~700 kB) loads lazily with the first file tab.
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: {
      // ws: the terminal socket lives under /api
      '/api': { target: `http://127.0.0.1:${DEV_PORT}`, changeOrigin: false, ws: true },
    },
  },
});
