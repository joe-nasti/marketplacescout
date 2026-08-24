import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const adminIndex=path.join(process.cwd(),'src/modules/admin/index.js');
const properPass=path.join(process.cwd(),'src/modules/admin/proper-pass.js');

test('Admin vNext has one Overview owner and no floating Singles navigator',async()=>{
  const source=await readFile(adminIndex,'utf8');
  expect(source).toContain("import('./proper-pass.js')");
  expect(source).not.toContain("import('./overview-vnext.js')");
  expect(source).not.toContain("import('./fixed-nav.js')");
});

test('Admin recent operations refreshes in place after first load',async()=>{
  const source=await readFile(properPass,'utf8');
  expect(source).toContain('if(jobsCache)renderJobs(jobsCache)');
  expect(source).toContain('else if(!jobsInflight)host.innerHTML');
  expect(source).toContain('Date.now()-jobsFetchedAt<60000');
  expect(source).toContain('cx-admin-health-disclosure');
  expect(source).toContain("classList.add('cx-ui-metric')");
});

test('Admin proper-pass styling stays theme-token driven',async()=>{
  const source=await readFile(properPass,'utf8');
  expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(source).toContain('var(--color-bg-surface)');
  expect(source).toContain('var(--color-text-secondary)');
  expect(source).toContain('var(--color-success)');
  expect(source).toContain('var(--color-danger)');
});
