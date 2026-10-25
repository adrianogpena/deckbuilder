import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { DEV_PORT } from '@kedalion/server-core/protocol';

// lru-cache (via the xterm ligatures addon) imports node:diagnostics_channel; the browser has none, so stub it with no-op channels.
const STUB_ID = 'virtual:diagnostics-channel-stub';
const STUB_SOURCE = `const ch = { hasSubscribers: false, publish() {}, subscribe() {}, unsubscribe() {} };
const tr = { ...ch, traceSync: (fn, _c, ...a) => fn(...a), tracePromise: (fn, _c, ...a) => fn(...a), traceCallback: (fn, _p, _c, ...a) => fn(...a) };
export const channel = () => ch;
export const tracingChannel = () => tr;
export default { channel, tracingChannel };`;
const diagnosticsChannelStub = (): Plugin => ({
  name: 'stub-diagnostics-channel',
  enforce: 'pre',
  resolveId: (id) => (id === 'node:diagnostics_channel' || id === 'diagnostics_channel' ? STUB_ID : undefined),
  load: (id) => (id === STUB_ID ? STUB_SOURCE : undefined),
});

// Dev: `deckbuilder dev` runs the server on DEV_PORT; Vite proxies the API there. changeOrigin
// stays false: the server's Origin check needs the browser's Origin and Host.
export default defineConfig({
  root: 'web',
  plugins: [diagnosticsChannelStub(), react()],
  // Dev pre-bundles dependencies with esbuild, which skips the plugin above.
  optimizeDeps: {
    esbuildOptions: {
      plugins: [{
        name: 'stub-diagnostics-channel',
        setup(build) {
          build.onResolve({ filter: /^(node:)?diagnostics_channel$/ }, () => ({ path: STUB_ID, namespace: 'stub' }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: STUB_SOURCE, loader: 'js' }));
        },
      }],
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // Chunk budget: 700 kB for our own chunks; split with manualChunks instead of raising it.
    // The limit is 1500 only because two unsplittable vendor files exceed 700 (elk ~1479 kB from mermaid, pdf.worker.min ~1376 kB from pdf.js); both load on demand. Any other chunk must stay under 700 kB.
    // The editor chunks (CodeMirror and its language parsers) load lazily with the first file tab; the editor/terminal barrels must not be imported statically at startup (use the ./options and ./session subpaths).
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xterm/')) return 'xterm';
          if (id.includes('/marked/') || id.includes('/dompurify/')) return 'markdown';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'react';
          if (/react-(grid-layout|resizable|draggable)|prop-types|clsx/.test(id)) return 'grid';
          const view = /packages[\/](sql-ui)[\/]/.exec(id);
          if (view) return view[1];
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
