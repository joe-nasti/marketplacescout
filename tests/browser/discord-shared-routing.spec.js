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

test('shared router owns broad market radar without hijacking named sources',()=>{
  const router=read('supabase/functions/ask-collectish-route-intents/index.ts');
  expect(router).toContain("route:'market_radar'");
  expect(router).toContain("type:'market_radar'");
  expect(router).toContain('ask_delvin_market_radar_v1');
  expect(router).toContain('if(namedSource(q))return false');
  expect(router).toMatch(/routeSource\(q\).*routeMarketRadar\(q\).*priceHistoryIntent/s);
});

test('shared router answers sealed Direct crack rankings without clarification',()=>{
  const router=read('supabase/functions/ask-collectish-route-intents/index.ts');
  const presenter=read('supabase/functions/ask-collectish-delvin-present/index.ts');
  const renderer=read('src/modules/ask/structured-surfaces.js');
  expect(router).toContain("route:'sealed_direct_crack_ranking'");
  expect(router).toContain("type:'sealed_crack_ranking'");
  expect(router).toContain('sealedDirectCrackIntent');
  expect(router).toMatch(/routeSealedDirect\(t,q\).*routeSource\(q\)/s);
  expect(router).toMatch(/routeSealedDirect[\s\S]*serviceRpc\('ask_delvin_sealed_direct_crack_v1'/);
  const migration=read('supabase/migrations/20260903195627_add_delvin_sealed_direct_ranking_rpc.sql');
  expect(migration).toContain('security invoker');
  expect(migration).toContain('revoke all on function public.ask_delvin_sealed_direct_crack_v1');
  expect(migration).toContain('grant execute on function public.ask_delvin_sealed_direct_crack_v1(integer) to service_role');
  expect(router).toContain("r.practical_action==='BUY & CRACK'");
  expect(router).toContain('Direct EV-only rows are theoretical outlet value');
  expect(router).toContain('latest observed TCG Low + shipping');
  expect(presenter).toContain('sealedCrackPresentation');
  expect(presenter).toMatch(/ask-collectish-route-intents[\s\S]*ask-collectish-delvin-route/);
  expect(presenter).toContain("heading:'BUY & CRACK'");
  expect(presenter).toContain("label:'Practical ROI'");
  expect(presenter).toContain("label:'Pass hidden'");
  expect(read('cloud-worker/discord-shared-delvin-route.mjs')).toMatch(/isQueuedSharedQuestion[\s\S]*sealed[\s\S]*crack[\s\S]*direct/);
  expect(read('cloud-worker/discord-shared-delvin-route.mjs')).toContain("u.searchParams.set('sealedView','opportunities')");
  expect(renderer).toContain("surface?.type==='sealed_crack_ranking'");
});

test('sealed inventory-fit questions use deferred Discord delivery',()=>{
  const worker=read('cloud-worker/discord-shared-delvin-route.mjs');
  expect(worker).toMatch(/isQueuedSharedQuestion[\s\S]*inventory\\s\+fit/);
  expect(worker).toContain("ask-collectish-delvin-present-v2");
});

test('named MTGStocks requests execute source lookup and refresh without clarification',()=>{
  const router=read('supabase/functions/ask-collectish-route-intents/index.ts');
  expect(router).toContain("route:'named_source_snapshot'");
  expect(router).toContain("type:'named_source_snapshot'");
  expect(router).toContain("refresh:'market-intel-mtgstocks-interests-sync'");
  expect(router).toContain('refresh_attempted=false');
  expect(router).toContain('if(stale&&src.refresh){refresh_attempted=true');
  expect(router).toContain('fallback_used:Boolean((refresh_error||stale)&&after?.raw?.length)');
  expect(router).toContain("scout_signal_required:false");
  expect(router).toContain("source_scope:'canonical_mtgstocks_plus_collectish_vetting'");
  expect(router).toMatch(/routeSource\(q\).*priceHistoryIntent/s);
});

test('canonical MTGStocks collector keeps complete per-window data and edge path does not silently use Telegram',()=>{
  const collector=read('cloud-worker/mtgstocks-interests.mjs');
  const edge=read('supabase/functions/market-intel-mtgstocks-interests-sync/index.ts');
  const workflow=read('.github/workflows/mtgstocks-interests.yml');
  expect(collector).toContain('MAX_PER_WINDOW');
  expect(collector).toContain('const counts=new Map()');
  expect(collector).toContain("used>=MAX_PER_WINDOW");
  expect(edge).toContain('canonical Interests are collected by the GitHub Chrome collector');
  expect(edge).not.toContain('telegram_announcement');
  expect(workflow).toContain('cron: "17 * * * *"');
});

test('web Ask converges on the stable API and renders shared surfaces',()=>{
  const proxy=read('src/modules/ask/endpoint-proxy.js');
  const renderer=read('src/modules/ask/structured-surfaces.js');
  expect(proxy).toContain("/ask-collectish-api");
  expect(renderer).toContain("surface?.type==='seller_opportunity_map'");
  expect(renderer).toContain("surface?.type==='market_radar'");
  expect(renderer).toContain("surface?.type==='delvin_query'&&surface?.query_key==='market_radar'");
  expect(renderer).toContain('surface.price_points');
});
