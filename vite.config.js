import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2020', sourcemap: false },
  server: { port: 3000, host: '0.0.0.0' },
  test: { environment: 'node', include: ['src/engine/__tests__/**/*.test.ts'] }
});
