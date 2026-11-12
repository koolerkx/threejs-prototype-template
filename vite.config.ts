import { fileURLToPath } from 'node:url';
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs work from any static host path (GitLab Pages, subfolders).
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 }, // three/webgpu is large; size is not a concern here
  // Unit tests only for pure logic (src/lib, experiment math); visuals are checked with `yarn shot`.
  test: { include: ['src/**/*.test.ts'] },
});
