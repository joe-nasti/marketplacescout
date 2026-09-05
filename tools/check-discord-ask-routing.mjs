import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const config=JSON.parse(read('cloud-worker/wrangler.discord-ask.json'));
const v30=read('cloud-worker/discord-ask-entry-v30.mjs');
const worker=read('cloud-worker/discord-ask-worker.mjs');
const shared=read('cloud-worker/discord-shared-delvin-route.mjs');
const supply=read('supabase/functions/ask-collectish-delvin-supply-present/index.ts');

if(config.main!=='./discord-ask-entry-v30.mjs')throw new Error(`Discord Ask main must be v30, got ${config.main}`);
if(!v30.includes("./discord-ask-entry.mjs"))throw new Error('v30 must delegate to the established Discord transport layer');
for(const pattern of[
  /moveAlias/,
  /cohortPhrase/,
  /price history/i,
  /seller map/i,
  /seller board/i,
  /opportunity map/i,
  /MTGStocks Interests/i,
  /ask_card_price_history_v1/,
  /ask_collectish_public_internal_sku_evidence_v1/,
]){
  if(pattern.test(v30))throw new Error(`Discord v30 contains forbidden market-routing logic: ${pattern}`);
}
if(!worker.includes('ask-collectish-api'))throw new Error('Discord worker must call the stable ask-collectish-api facade');
if(!/return queuedSupplyLike\([A-Za-z_$][\w$]*\)\|\|/.test(shared))throw new Error('Market-depth questions must be owned by the queued shared route');
if(!shared.includes('^how\\s+deep\\b'))throw new Error('Discord shared route must recognize "how deep" market questions');
if(!shared.includes('market\\s+depth'))throw new Error('Discord shared route must recognize market-depth phrasing');
if(!supply.includes('ask_collectish_supply_family_skus_v1'))throw new Error('Supply presenter must resolve card families deterministically from the canonical family-SKU RPC');
if(supply.includes('ask-collectish-identity-recovery'))throw new Error('Supply presenter must not depend on identity recovery for unscoped card-family depth');
console.log('Discord Ask routing ownership check passed');
