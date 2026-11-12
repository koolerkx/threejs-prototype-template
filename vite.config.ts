import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs work from any static host path (GitLab Pages, subfolders).
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 }, // three/webgpu is large; size is not a concern here
});
