import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals exposes expanded curated MTG source taxonomy',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('src/modules/signals/source-collectors.js');
  for(const needle of ["name:'Draftsim'","name:'MTGDecks'","name:'Star City Games'","name:'Cardmarket Insight'","name:'CoolStuffInc Articles'","name:'Wizards DailyMTG'"])expect(src).toContain(needle);
  expect(src).toContain("profile:'independent_editorial'");
  expect(src).toContain("profile:'competitive_editorial'");
  expect(src).toContain("profile:'official_primary'");
  expect(src).toContain("discovery:'curated_page'");
  expect(src).toContain("market-intel-curated-content-sync");
});

test('curated collector is bounded and host allowlisted',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-curated-content-sync/index.ts');
  expect(src).toContain("'www.cardmarket.com'");
  expect(src).toContain("'www.coolstuffinc.com'");
  expect(src).toContain("'magic.wizards.com'");
  expect(src).toContain('FAILED_COOLDOWN_MS=6*60*60*1000');
  expect(src).toContain('Math.min(Number(b?.max_new)||2,4)');
  expect(src).toContain("profile==='official_primary'");
  expect(src).toContain("return'official_rules'");
});

test('analyzer repairs malformed JSON and understands source profiles',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const src=await read('supabase/functions/market-intel-analyze/index.ts');
  expect(src).toContain('parseModelJson');
  expect(src).toContain('parseAnalysis');
  expect(src).toContain('Repair the following malformed JSON');
  expect(src).toContain("profile==='official_primary'");
  expect(src).toContain("profile==='competitive_editorial'");
  expect(src).toContain("profile==='independent_editorial'");
});
