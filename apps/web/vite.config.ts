/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The shared .env lives at the repo root (one level up from apps/web).
const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');
  const apiPort = env.PORT || '3001';
  const webPort = Number(env.WEB_PORT || '5173');
  return {
    plugins: [react()],
    server: {
      port: webPort,
      // Proxy /api to the API; follows PORT so changing the API port just works.
      proxy: { '/api': `http://localhost:${apiPort}` },
    },
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./vitest.setup.ts'],
      css: false,
    },
  };
});
