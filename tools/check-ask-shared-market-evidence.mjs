import fs from 'node:fs';
const sql=fs.readFileSync('supabase/migrations/20260901144700_make_ask_market_research_shared_across_clients.sql','utf8');
const fallback=fs.readFileSync('supabase/migrations/20260902235900_broaden_ask_get_scout_card_shared_fallback.sql','utf8');
const supply=fs.readFileSync('supabase/migrations/20260903003500_separate_direct_from_global_supply.sql','utf8');
for(const token of [
  'ask_collectish_public_internal_sku_evidence_v1',
  'ask_card_price_history_v1',
  "'v4_shared_market'",
  "'v2_shared_official_history'",
  'stable security definer',
  'grant execute on function public.ask_collectish_market_investigation_v3(text,text) to authenticated,service_role',
  'grant execute on function public.ask_collectish_market_timeline_v1(text,text,integer) to authenticated,service_role',
]) if(!sql.toLowerCase().includes(token.toLowerCase())) throw new Error(`missing shared market contract token: ${token}`);
if(/marketplace_scan_rows[\s\S]{0,250}auth\.uid\(\)/i.test(sql)) throw new Error('shared market research reintroduced caller-owned scan gating');
if(/scout_opportunities_v5[\s\S]{0,250}auth\.uid\(\)/i.test(sql)) throw new Error('shared market research reintroduced caller-owned Scout gating');
for(const token of [
  'ask_collectish_get_scout_card',
  'ask_collectish_public_internal_sku_evidence_v1',
  "'scout_promoted', false",
  "'identity_source', 'shared_public_internal_sku_evidence'",
  "'scout_promoted', true",
  "'identity_source', 'scout_opportunities_v5'"
]) if(!fallback.toLowerCase().includes(token.toLowerCase())) throw new Error(`missing Ask shared-card fallback contract token: ${token}`);
if(!/if card is not null then[\s\S]*scout_promoted[\s\S]*true/i.test(fallback)) throw new Error('promoted Scout card must remain the preferred lookup path');
if(!/if shared is not null[\s\S]*shared_public_internal_sku_evidence/i.test(fallback)) throw new Error('non-promoted exact SKUs must fall back to shared market evidence');
for(const token of [
  'direct_supply_classification',
  'global_supply_classification',
  "'UNPROVEN'",
  "'DIRECT_ONLY'",
  'retailer_price_presence',
  'scout_vendor_price_current_cache',
  'do not infer market-wide thin supply'
]) if(!supply.toLowerCase().includes(token.toLowerCase())) throw new Error(`missing supply-scope contract token: ${token}`);
if(!/direct inventory\/listings measure tcgplayer direct tightness only/i.test(supply)) throw new Error('Direct supply must be explicitly scoped to TCGplayer Direct');
if(/global_supply_classification'\s*,\s*card->>'supply_type'/i.test(supply)) throw new Error('legacy Direct supply_type leaked into global supply classification');
console.log('Ask shared market evidence guard passed');
