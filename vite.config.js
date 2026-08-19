import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const buildSha=process.env.GITHUB_SHA||'dev-local';
const buildRevision=process.env.COLLECTISH_WEB_REVISION||(
  process.env.GITHUB_RUN_NUMBER?`r${process.env.GITHUB_RUN_NUMBER}`:'dev'
);

export default defineConfig({
  base: './',
  define: {
    __COLLECTISH_BUILD_SHA__: JSON.stringify(buildSha),
    __COLLECTISH_BUILD_REVISION__: JSON.stringify(buildRevision)
  },
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
