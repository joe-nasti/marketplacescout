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
  const fallback=read('supabase/functions/ask-collectish-delvin-route/index.ts');
  const registry=read('supabase/functions/ask-collectish-delvin-route-v2/index.ts');
  const presenter=read('supabase/functions/ask-collectish-delvin-present/index.ts');
  expect(router).toContain("route:'named_source_snapshot'");
  expect(router).toMatch(/routeSource\(q\).*priceHistoryIntent/s);
  expect(fallback).toContain("'market_radar'");
  expect(fallback).toContain("retired_to:'ask-collectish-delvin-route-v2'");
  expect(registry).toContain("'market_radar'");
  expect(registry).toContain("if(i.capability_kind==='cached')return cache(route)");
  expect(presenter).toContain("type:'market_radar'");
  expect(presenter).toContain('radarPresentation');
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
  expect(read('cloud-worker/discord-shared-delvin-route.mjs')).toContain("a.sealed_view||'opportunities'");
  expect(renderer).toContain("surface?.type==='sealed_crack_ranking'");
});

test('sealed inventory-fit questions use deferred Discord delivery',()=>{
  const worker=read('cloud-worker/discord-shared-delvin-route.mjs');
  const router=read('supabase/functions/ask-collectish-route-intents/index.ts');
  const presenter=read('supabase/functions/ask-collectish-delvin-present/index.ts');
  expect(worker).toMatch(/isQueuedSharedQuestion[\s\S]*inventory\\s\+fit/);
  expect(worker).toContain("ask-collectish-delvin-present-v3");
  expect(read('cloud-worker/discord-card-investigator.mjs')).toMatch(/inventory\\s\+fit[\s\S]*return null/);
  expect(router).toContain("ask_delvin_sealed_direct_crack_v1");
  expect(router).toContain('max_buy_15_pct');
  expect(router).toContain('optimized_live_out_ev');
  expect(presenter).toContain("label:'Buy landed'");
  expect(presenter).toContain("label:'Practical net EV'");
  expect(presenter).toContain("label:'Max buy @ 15%'");
  expect(router).toContain("sealed_uuid:product.uuid");
  expect(worker).toMatch(/searchParams\.set\(["']sealed["'],String\([^)]*\.sealed_uuid\)\)/);
  expect(router).toContain('buy=Number(decision.acquisition_price)');
  expect(presenter).toContain('acquisition_observation_status');
  const acquisition=read('supabase/migrations/20260904030000_label_sealed_acquisition_freshness.sql');
  expect(acquisition).toContain('p.low_with_shipping::numeric acquisition_price');
  expect(acquisition).not.toMatch(/coalesce\s*\(\s*p\.low_with_shipping\s*,\s*p\.low_price/i);
  expect(acquisition).toContain("else 'STALE'");
});

test('sealed component EV resolves packs before generic card matching',()=>{
  const worker=read('cloud-worker/discord-shared-delvin-route.mjs');
  const router=read('supabase/functions/ask-collectish-route-intents/index.ts');
  const presenter=read('supabase/functions/ask-collectish-delvin-present/index.ts');
  expect(router).toContain('sealedEvIntent');
  expect(router).toContain('sealedEvClause');
  expect(router).toMatch(/should\|can\|would[\s\S]*crack\|open/);
  expect(router).toMatch(/suffix=s\.match[\s\S]*ev\|expected\\s\+value/);
  expect(router).toContain('resolveSealedEvProduct');
  expect(router).toContain("route:'sealed_product_ev'");
  expect(router).toMatch(/routeSealedTrajectory\(q\)[\s\S]*routeSealedEv\(q\)[\s\S]*routeSealedFit\(q\)/);
  expect(router).toContain("category==='booster_pack'");
  expect(router).toContain("category.includes('case')");
  expect(router).toContain('that resale price is not contents EV');
  expect(router).toContain('Recommendation: ${text(ev.practical_action)}');
  expect(presenter).toContain('sealedEvPresentation');
  expect(presenter).toContain("type:'sealed_product_ev'");
  expect(worker).toMatch(/expected\\s\+value[\s\S]*booster\|pack\|bundle/);
});

test('sealed inventory-fit queue delivery renders decision economics and exact-product link',async()=>{
  const {maybeHandleCardInvestigator}=await import('../../cloud-worker/discord-card-investigator.mjs');
  const {isQueuedSharedQuestion,deliverQueuedSharedQuestion}=await import('../../cloud-worker/discord-shared-delvin-route.mjs');
  const question='Analyze inventory fit for Secret Lair 20 Ways to Win';
  expect(isQueuedSharedQuestion(question)).toBe(true);
  const declined=await maybeHandleCardInvestigator(new Request('https://worker/discord/interactions',{method:'POST',body:JSON.stringify({type:2,data:{name:'ask',options:[{name:'question',value:question}]}})}),{},{});
  expect(declined).toBeNull();

  const uuid='11111111-2222-3333-4444-555555555555',requests=[];
  const presentation={
    type:'sealed_inventory_fit',title:'Secret Lair 20 Ways to Win · inventory fit',summary:'BUY & CRACK at $285.95 landed.',
    metrics:[
      {label:'Buy landed',display:'$285.95'},{label:'Practical net EV',display:'$343.62'},
      {label:'Practical ROI',display:'+20.2%'},{label:'Direct-first net',display:'$376.79'},
      {label:'Max buy @ 15%',display:'$298.80'}
    ],actions:[{type:'navigate',label:'Open exact product',screen:'sealed',sealed_view:'opportunities',sealed_uuid:uuid}]
  };
  const fitSurface={type:'sealed_inventory_fit',title:presentation.title,profile:{summary:{resolved_skus:100,content_lines:101,direct_observed:100,direct_in_stock:28,direct_depth_10:26,direct_depth_25:19,growth_history_cards:44,cards_2_plus:45,unresolved_skus:1},top_value_cards:[{name:'Sol Ring',practical_value:18.07,share_pct:5.3,direct_available:62}],top_growth_cards:[{name:'Sol Ring',growth_pct:18.1,growth_dollars:3.51}]},economics:{verdict:'BUY & CRACK',acquisition_price:285.95,practical_net_ev:343.62,practical_roi_pct:20.2,direct_first_net_ev:376.79,direct_roi_pct:31.8,max_buy_15_pct:298.80,margin_dollars:57.67,optimized_live_out_ev:394.60,tcg_market_gross_ev:458.86,cash_floor_ev:238.27,acquisition_age_hours:18},actions:presentation.actions};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    requests.push({url:String(url),init});
    if(String(url).includes('/functions/v1/ask-collectish-delvin-present-v3'))return new Response(JSON.stringify({handled:true,route:'sealed_inventory_fit',response:presentation.summary,presentation,surfaces:[fitSurface]}),{status:200,headers:{'Content-Type':'application/json'}});
    return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});
  };
  let acked=false;
  try{
    const handled=await deliverQueuedSharedQuestion({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',DISCORD_APPLICATION_ID:'app',COLLECTISH_WEB_URL:'https://collectish.example/open.html'},{interaction_id:'interaction',interaction_token:'token',application_id:'app',question},{ack(){acked=true}});
    expect(handled).toBe(true);expect(acked).toBe(true);
    const discord=requests.find(x=>x.url.includes('/webhooks/app/token/messages/@original'));
    expect(discord).toBeTruthy();
    const payload=JSON.parse(discord.init.body);
    expect(payload.embeds).toHaveLength(2);
    const rendered=JSON.stringify(payload.embeds);
    for(const expected of ['$285.95','$343.62','+20.2%','$376.79','$298.80'])expect(rendered).toContain(expected);
    for(const expected of ['100/101','28','26','19','44/45','Value composition and momentum'])expect(rendered).toContain(expected);
    const link=new URL(payload.components[0].components[0].url);
    expect(link.searchParams.get('tab')).toBe('sealed');
    expect(link.searchParams.get('sealedView')).toBe('opportunities');
    expect(link.searchParams.get('sealed')).toBe(uuid);
  }finally{globalThis.fetch=originalFetch}
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

test('Discord sealed inventory fit uses a mobile-first decision and detail split',()=>{
  const worker=read('cloud-worker/discord-shared-delvin-route.mjs');
  expect(worker).toContain('function sealedFitEmbeds');
  expect(worker).toContain('Value composition and momentum');
  expect(worker).toContain("name:'Coverage'");
  expect(worker).toContain('History **');
  expect(worker).toContain('top_value_cards.slice(0,5)');
  expect(worker).toContain('top_growth_cards.slice(0,5)');
  expect(worker).toContain('Missing observations are unknown, not zero.');
  expect(worker).toContain('fit?sealedFitEmbeds(fit):presentationEmbeds');
});
