import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');

test('Discord v30 is transport-only',()=>{
  const v30=read('cloud-worker/discord-ask-entry-v30.mjs');
  const config=JSON.parse(read('cloud-worker/wrangler.discord-ask.json'));
  expect(config.main).toBe('./discord-ask-entry-v30.mjs');
  expect(v30).toContain("./discord-ask-entry.mjs");
  expect(v30).not.toMatch(/moveAlias|cohortPhrase|price history|seller map|MTGStocks Interests/i);
});

test('stable Ask API owns deterministic routing and persistence',()=>{
  const api=read('supabase/functions/ask-collectish-api/index.ts');
  expect(api).toContain('ask-collectish-route-intents');
  expect(api).toContain('ask-collectish-identity-recovery');
  expect(api).toContain('ensureSession');
  expect(api).toContain('saveMessage');
  expect(api).toContain('collectish.ask.surface.v10');
});

test('shared router owns history and seller surfaces with finish-aware moves',()=>{
  const router=read('supabase/functions/ask-collectish-route-intents/index.ts');
  expect(router).toContain("type:'price_history'");
  expect(router).toContain("type:'seller_opportunity_map'");
  expect(router).toContain("route:'named_family_seller_map'");
  expect(router).toContain("route:'cohort_seller_map'");
  expect(router).toContain('moveForRow');
  expect(router).toContain('historyAlias');
});

test('named MTGStocks requests execute source lookup and refresh without clarification',()=>{
  const router=read('supabase/functions/ask-collectish-route-intents/index.ts');
  expect(router).toContain("route:'named_source_snapshot'");
  expect(router).toContain("type:'named_source_snapshot'");
  expect(router).toContain("refresh:'market-intel-mtgstocks-interests-sync'");
  expect(router).toContain('refresh_attempted:stale');
  expect(router).toContain('fallback_used:Boolean(refresh_error&&after.rows.length)');
  expect(router).toContain("scout_signal_required:false");
  expect(router).toContain("source_scope:'same_source_same_feature'");
  expect(router).toMatch(/routeSource\(q\).*priceHistoryIntent/s);
});

test('web Ask converges on the stable API and renders shared surfaces',()=>{
  const proxy=read('src/modules/ask/endpoint-proxy.js');
  const renderer=read('src/modules/ask/structured-surfaces.js');
  expect(proxy).toContain("/ask-collectish-api");
  expect(renderer).toContain("surface?.type==='seller_opportunity_map'");
  expect(renderer).toContain('surface.price_points');
});
