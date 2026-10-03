import { defineConfig } from 'vite';
import { createEngineBridge } from './scripts/engine-bridge.mjs';

export default defineConfig({ plugins: [{
  name: 'local-vcmi-engine',
  configureServer(server) {
    const bridge = createEngineBridge();
    server.middlewares.use('/api/engine', bridge.middleware);
    server.httpServer?.once('close', () => bridge.close());
  },
}] });
