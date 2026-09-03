import fs from 'node:fs';
const migration=fs.readFileSync('supabase/migrations/20260903010000_market_wide_supply_depth.sql','utf8');
const sync=fs.readFileSync('supabase/functions/market-supply-sync/index.ts','utf8');
const identity=fs.readFileSync('supabase/functions/ask-collectish-identity-recovery/index.ts','utf8');
for(const token of ['market_supply_snapshots','ask_collectish_market_supply_v1','direct_unit_count','non_direct_unit_count','seller_count','global_supply_classification','EXACT_SKU_ALL_TCGPLAYER','Retailer price presence'])if(!migration.includes(token))throw new Error(`missing market-supply contract token: ${token}`);
for(const token of ['mp-search-api.tcgplayer.com','productConditionId','directListing','sellerKey','quantity','channelExclusion','tcgplayer_site_listings_search','PARTIAL_PAGE_CAP'])if(!sync.includes(token))throw new Error(`missing exact TCG listing collector token: ${token}`);
if(!/exact\(listings|const exact=listings\.filter/.test(sync))throw new Error('TCG marketplace supply must filter listings to the exact SKU');
if(!/nonDirect=exact\.filter/.test(sync))throw new Error('non-Direct marketplace supply is not separated from Direct');
if(!/syncSupply/.test(identity)||!/market-supply-sync/.test(identity))throw new Error('named supply questions do not refresh market-wide supply');
if(/term\.language\s*=/.test(sync))throw new Error('market supply must filter language by exact SKU, not display-label facet');
for(const token of ["'Origin':'https://www.tcgplayer.com'","'Referer':'https://www.tcgplayer.com/'",'Mozilla/5.0']){
  if(!sync.includes(token))throw new Error(`missing TCGplayer site request header: ${token}`);
}
if(!/supply\|inventory\|liquidity/.test(identity))throw new Error('supply refresh is not scoped to supply-like questions');
if(/global_supply_classification','Thin \/ fragmented Direct/i.test(migration))throw new Error('Direct classification leaked into global supply classification');
console.log('Ask market-wide supply guard passed');
