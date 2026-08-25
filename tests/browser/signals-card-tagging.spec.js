import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals card tagger preserves confirmed MTG sources and subject-card precision',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-card-tag/index.ts');
  expect(src).toContain('const knownMagic=titleLooksMagic(title)');
  expect(src).toContain('This source is already CONFIRMED to be about Magic: The Gathering');
  expect(src).toContain('actual entries in a card list');
  expect(src).toContain('EXCLUDE incidental examples, comparison cards, generic staples');
  expect(src).toContain("method='article_model_retry'");
});

test('Signals card tagger has deterministic exact-name fallbacks for confirmed MTG lists',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-card-tag/index.ts');
  expect(src).toContain('function listCandidates');
  expect(src).toContain('async function exactListCards');
  expect(src).toContain("'exact_list_fallback'");
  expect(src).toContain("'model_error_exact_list_fallback'");
  expect(src).toContain("method='signal_entity_fallback'");
  expect(src).toContain("await named(n,'exact')");
  expect(src).toContain("replace(/^[#•*");
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
