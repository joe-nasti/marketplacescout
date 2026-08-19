import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: resolve(process.cwd(), 'vite-index.html')
    }
  }
});
