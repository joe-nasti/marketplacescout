import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals card tagger preserves confirmed MTG sources and subject-card precision',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-card-tag/index.ts');
  expect(src).toContain('const knownMagic=titleLooksMagic(title)');
  expect(src).toContain('sourceLooksMagic(url)');
  expect(src).toContain("p.includes('/magic-the-gathering/')");
  expect(src).toContain('This source is already CONFIRMED to be about Magic: The Gathering');
  expect(src).toContain('actual entries in a card list');
  expect(src).toContain('EXCLUDE incidental examples, comparison cards, generic staples');
  expect(src).toContain("method='article_model_retry'");
});

test('Signals explicit-list fallback preserves punctuation and narrowly corrects source typos',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-card-tag/index.ts');
  expect(src).toContain('function listCandidates');
  expect(src).toContain('async function explicitListCards');
  expect(src).toContain("'explicit_list_fallback'");
  expect(src).toContain("'model_error_explicit_list_fallback'");
  expect(src).toContain("method='signal_entity_fallback'");
  expect(src).toContain('r:await resolve(n)');
  expect(src).toContain("replace(/^[#•*");
  expect(src).toContain("line.split(/\\s*(?:\\+|;)\\s*/)");
  expect(src).not.toContain("(?:,|;|&|\\band\\b)");
});

test('Signals list normalization handles quantities aliases HTML smart quotes and explicit title limits',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-card-tag/index.ts');
  expect(src).toContain("replace(/^\\s*\\d+x\\s+/i,'')");
  expect(src).toContain("replace(/\\s+as\\s+");
  expect(src).toContain('full art');
  expect(src).toContain('double sided');
  expect(src).toContain('(?:ldquo|rdquo)');
  expect(src).toContain('(?:lsquo|rsquo)');
  expect(src).toContain('function titleListLimit');
  expect(src).toContain("const maxCards=method.includes('explicit_list_fallback')?(explicitLimit||40):25");
  expect(src).not.toContain('tricolor lands|command tower');
});

test('Signals retag replaces prior mention rows so stale false positives disappear',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-card-tag/index.ts');
  expect(src).toContain("market_intel_card_mentions?intel_id=in.(${ids.join(',')})");
  expect(src).toContain("{method:'DELETE'}");
  expect(src).toContain('resolution=merge-duplicates');
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
