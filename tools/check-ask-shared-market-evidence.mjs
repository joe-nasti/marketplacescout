import fs from 'node:fs';
const sql=fs.readFileSync('supabase/migrations/20260901144700_make_ask_market_research_shared_across_clients.sql','utf8');
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
console.log('Ask shared market evidence guard passed');
