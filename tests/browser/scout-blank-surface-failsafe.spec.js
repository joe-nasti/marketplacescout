import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('the shell force-recovers a Scout route that remains blank after resume',async()=>{
  const shell=await readFile('src/core/shell.js','utf8');
  expect(shell).toContain("store.get().runtime?.page==='scout'");
  expect(shell).toContain("await bootstrap?.start?.()");
  expect(shell).toContain("next.searchParams.set('_surface_recover'");
  expect(shell).toContain("window.addEventListener('pageshow'");
  expect(shell).toContain("document.addEventListener('visibilitychange'");
  expect(shell).toContain('Scout did not finish restoring. Reload this page to retry.');
});

test('an interrupted Scout module install remains retryable',async()=>{
  const [index,bootstrap]=await Promise.all([
    readFile('src/modules/scout/index.js','utf8'),
    readFile('src/modules/scout/bootstrap.js','utf8')
  ]);
  expect(index).toContain('let installing=null');
  expect(index.indexOf('installed=true')).toBeGreaterThan(index.indexOf("await import('./renderer.js')"));
  expect(index).toContain("throw new Error('Scout renderer did not initialize')");
  expect(index).toContain('finally(()=>{installing=null})');
  expect(bootstrap).toContain("throw new Error('Scout renderer unavailable after install')");
});
