import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Scout saved views do not include a redundant Filters trigger',async()=>{
  const source=await read('src/modules/scout/ia-v2.js');
  const chrome=source.match(/ia\.innerHTML=`([\s\S]*?)`;/)?.[1]||'';
  expect(chrome).toContain('Top');
  expect(chrome).toContain('Quick turns');
  expect(chrome).toContain('Buylist backed');
  expect(chrome).toContain('High velocity');
  expect(chrome).not.toContain('data-scout-filters');
  expect(source).toContain("b.dataset.scoutFilters='1'");
});

test('mobile build badge and theme toggle scroll with the document',async()=>{
  const source=await read('src/styles/mobile-quality.css');
  expect(source).toContain('.cx-top-version{position:absolute');
  expect(source).toContain('.cx-theme-toggle{position:absolute');
  expect(source).not.toMatch(/\.cx-top-version\{position:fixed/);
});
