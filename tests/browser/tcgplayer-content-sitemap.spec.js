import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals offers TCGplayer consumer content via sitemap discovery',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('src/modules/signals/source-collectors.js');
  expect(src).toContain("id:'tcgplayer-content'");
  expect(src).toContain("url:'https://www.tcgplayer.com/sitemap/index.xml'");
  expect(src).toContain("discovery:'tcgplayer_content_sitemap'");
  expect(src).toContain("profile:'marketplace_editorial'");
});

test('TCGplayer content collector discovers article URLs from sitemap XML',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-tcgplayer-content-sync/index.ts');
  expect(src).toContain('discoverTcgplayerContent');
  expect(src).toContain('/content/article/');
  expect(src).toContain('sitemap/index.xml');
  expect(src).toContain('first_party_market_sales');
  expect(src).toContain('first_party_market_price');
});

test('Signals sync invokes sitemap collector separately from RSS feed sync',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('src/modules/signals/source-collectors.js');
  expect(src).toContain("callFunction('market-intel-tcgplayer-content-sync'");
  expect(src).toContain("capture_type=in.(feed_subscription,content_subscription)");
});
