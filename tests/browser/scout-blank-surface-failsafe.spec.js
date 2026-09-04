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
