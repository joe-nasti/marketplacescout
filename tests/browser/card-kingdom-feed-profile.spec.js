import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals offers Card Kingdom blog as retailer editorial source',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('src/modules/signals/source-collectors.js');
  expect(src).toContain("id:'cardkingdom'");
  expect(src).toContain("url:'https://blog.cardkingdom.com/feed/'");
  expect(src).toContain("profile:'retailer_editorial'");
});

test('feed sync carries retailer editorial source profile into analysis',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-feed-sync/index.ts');
  expect(src).toContain('source_profile');
  expect(src).toContain('retailer_editorial');
  expect(src).toContain('first_party_sales');
});

test('analyzer distinguishes retailer opinion from first-party sales disclosure',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-analyze/index.ts');
  expect(src).toContain('RETAILER EDITORIAL SOURCE');
  expect(src).toContain('FIRST-PARTY SALES DISCLOSURE');
  expect(src).toContain('commercial bias');
  expect(src).toContain('confidence <=0.65');
});
