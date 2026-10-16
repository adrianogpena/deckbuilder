import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { DEV_PORT } from '@deckbuilderkit/server-core/protocol';

// Dev: `deckbuilder dev` runs the server on DEV_PORT; Vite proxies the API there. changeOrigin
// stays false: the server's Origin check needs the browser's Origin and Host.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // Chunk budget: 700 kB. Never raise it; split with manualChunks instead.
    // The editor chunks (CodeMirror and its language parsers) load lazily with the first file tab; the editor/terminal barrels must not be imported statically at startup (use the ./options and ./session subpaths).
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@codemirror/legacy-modes')) return 'cm-legacy-modes';
          if (id.includes('@codemirror/') || id.includes('@lezer/') || id.includes('/codemirror/')) return 'codemirror';
        },
      },
    },
  },
  server: {
    proxy: {
      // ws: the terminal socket lives under /api
      '/api': { target: `http://127.0.0.1:${DEV_PORT}`, changeOrigin: false, ws: true },
    },
  },
});
