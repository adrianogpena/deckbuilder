import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { DEV_PORT } from '@deckbuilderkit/server-core/protocol';

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
  },
  server: {
    proxy: {
      // ws: the terminal socket lives under /api
      '/api': { target: `http://127.0.0.1:${DEV_PORT}`, changeOrigin: false, ws: true },
    },
  },
});
