import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals offers TCGplayer Seller Blog as first-party marketplace source',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('src/modules/signals/source-collectors.js');
  expect(src).toContain("id:'tcgplayer-seller'");
  expect(src).toContain("url:'https://seller.tcgplayer.com/blog/rss.xml'");
  expect(src).toContain("profile:'marketplace_editorial'");
});

test('feed failures cool down instead of blocking later sources',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-feed-sync/index.ts');
  expect(src).toContain('FAILED_COOLDOWN_MS');
  expect(src).toContain('failedRecently(row)');
  expect(src).toContain('skipped_failed');
  expect(src).not.toContain("more=!!data?.more_pending&&Number(data?.failed||0)===0");
});

test('TCGplayer marketplace reports are classified as first-party evidence',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const sync=await read('supabase/functions/market-intel-feed-sync/index.ts');
  const analyze=await read('supabase/functions/market-intel-analyze/index.ts');
  expect(sync).toContain('first_party_market_sales');
  expect(sync).toContain('first_party_market_price');
  expect(sync).toContain('marketplace_operations');
  expect(analyze).toContain('FIRST-PARTY MARKETPLACE SALES DATA');
  expect(analyze).toContain('FIRST-PARTY MARKETPLACE PRICE DATA');
  expect(analyze).toContain('0.95');
});
