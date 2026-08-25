import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals card tagger preserves confirmed MTG sources and subject-card precision',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-card-tag/index.ts');
  expect(src).toContain('const knownMagic=titleLooksMagic(title)');
  expect(src).toContain('This source is already CONFIRMED to be about Magic: The Gathering');
  expect(src).toContain('For a list article, capture the actual list entries');
  expect(src).toContain('EXCLUDE incidental examples, comparison cards, generic staples');
  expect(src).toContain("method='article_model_retry'");
});

test('Signals card tagger prefers MTGStocks card taxonomy and validates names through Scryfall',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-card-tag/index.ts');
  expect(src).toContain("taxonomy\\/card");
  expect(src).toContain("method='mtgstocks_taxonomy'");
  expect(src).toContain('https://api.scryfall.com/cards/named?');
  expect(src).toContain("resolution:'exact'");
  expect(src).toContain("resolution:'fuzzy'");
});

test('Signals service-role backfill stays server-only and resolves one owning user',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-card-tag/index.ts');
  expect(src).toContain("jwtRole(t)==='service_role'");
  expect(src).toContain('Backfill requires intel_ids from exactly one user');
  expect(src).toContain('service_backfill:!!principal.service');
});
