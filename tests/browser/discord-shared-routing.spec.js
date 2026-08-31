import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('Discord v30 is transport-only and delegates Ask behavior to the stable API',()=>{
  const v30=read('cloud-worker/discord-ask-entry-v30.mjs');
  const config=JSON.parse(read('cloud-worker/wrangler.discord-ask.json'));
  expect(config.main).toBe('./discord-ask-entry-v30.mjs');
  expect(v30).toContain("./discord-ask-entry.mjs");
  expect(v30).not.toMatch(/price history|seller map|cohortPhrase|moveAlias|MTGStocks Interests/i);
});

test('stable Ask API owns deterministic route dispatch and persistence',()=>{
  const api=read('supabase/functions/ask-collectish-api/index.ts');
  expect(api).toContain("ask-collectish-route-intents");
  expect(api).toContain("ask-collectish-identity-recovery");
  expect(api).toContain("ensureSession");
  expect(api).toContain("saveMessage");
  expect(api).toContain("collectish.ask.surface.v10");
});

test('shared router owns price history and seller opportunity surfaces',()=>{
  const router=read('supabase/functions/ask-collectish-route-intents/index.ts');
  expect(router).toContain("type:'price_history'");
  expect(router).toContain("type:'seller_opportunity_map'");
  expect(router).toContain("route:'named_family_seller_map'");
  expect(router).toContain("route:'cohort_seller_map'");
  expect(router).toContain('moveForRow');
});
