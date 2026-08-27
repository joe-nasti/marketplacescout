-- Structural realization-aware Scout scoring.
--
-- When TCG Direct is >= 1.75x TCG Market, the legacy structural score can be
-- inflated by set-rank velocity and the same unproven Direct premium that V5
-- already discounts at execution time. Keep a 20-point structural floor for
-- scarcity / non-execution thesis, but scale the remaining structural excess by
-- exact-SKU marketplace velocity. This prevents an unproven Direct gap from
-- manufacturing a B/C grade while preserving independent buylist backing.

create or replace function public.refresh_scout_v5_shadow_batch(
  p_after_key text default '',
  p_limit integer default 400
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
  last_key text;
  after_user uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  after_sku text := '';
begin
  if coalesce(p_after_key,'') <> '' then
    after_user := split_part(p_after_key,'|',1)::uuid;
    after_sku := substring(p_after_key from position('|' in p_after_key)+1);
  end if;

with s as (
  select *, (user_id::text||'|'||sku_id) as cursor_key
  from scout_opportunities_24h
  where (user_id,sku_id) > (after_user,after_sku)
  order by user_id,sku_id
  limit greatest(1,least(coalesce(p_limit,400),600))
), i as (
  select s.*,sk.uuid,
    coalesce(nullif(sk.finish,''),case when s.printing ilike '%etched%' then 'etched' when s.printing ilike '%foil%' then 'foil' else 'normal' end) finish
  from s left join mtgjson_tcgplayer_skus sk on sk.sku_id=s.sku_id
), x as (
  select i.*,vp.cardkingdom_retail ck_retail,vp.cardkingdom_buylist ck_buylist,
    vp.manapool_retail mp_retail,vp.cardmarket_retail mkm_retail,
    least(nullif(i.tcg_low,0),nullif(vp.cardkingdom_retail,0),nullif(vp.manapool_retail,0)) cheapest_buy,
    sh.raw_json sales_raw,
    coalesce(sp.is_currently_eligible,false) syp_current
  from i
  left join scout_vendor_price_current_cache vp on vp.mtgjson_uuid=i.uuid and vp.finish=i.finish
  left join lateral (
    select o.raw_json
    from marketplace_sku_sales_observations o
    where o.user_id=i.user_id and o.sku_id=i.sku_id
    order by o.captured_at desc
    limit 1
  ) sh on true
  left join syp_products sp on sp.user_id=i.user_id and sp.tcgplayer_id=i.sku_id
), a as (
  select x.*,
    case when cheapest_buy is null then null when nullif(tcg_low,0)=cheapest_buy then 'TCG Low' when nullif(ck_retail,0)=cheapest_buy then 'Card Kingdom' when nullif(mp_retail,0)=cheapest_buy then 'Mana Pool' else 'US source' end cheapest_source,
    least(70.0,opportunity_score*70.0/85.0) structural_raw,
    case
      when avg_daily_qty_sold>=1 then 1::numeric
      when avg_daily_qty_sold>=.5 then .8::numeric
      when avg_daily_qty_sold>=.1 then .4::numeric
      when avg_daily_qty_sold>0 then .25::numeric
      else .15::numeric
    end velocity_evidence_factor,
    case when cheapest_buy>0 and direct_low*.8>cheapest_buy then 10*sqrt(least(1.0,((direct_low*.8-cheapest_buy)/cheapest_buy)/.35)*least(1.0,(direct_low*.8-cheapest_buy)/3.0)) else 0 end direct_execution_raw,
    case when cheapest_buy>0 and ck_buylist>cheapest_buy then 10*sqrt(least(1.0,((ck_buylist-cheapest_buy)/cheapest_buy)/.25)*least(1.0,(ck_buylist-cheapest_buy)/2.0)) else 0 end buylist_backing_raw,
    case when sku_market_price>0 and ck_buylist>0 then least(5.0,(ck_buylist/sku_market_price)/.80*5.0) else 0 end liquidity_points,
    case when sku_market_price>0 then (case when ck_retail>0 then 2.5*greatest(0,1-least(1,abs(ck_retail-sku_market_price)/sku_market_price)) else 0 end)+(case when mp_retail>0 then 2.5*greatest(0,1-least(1,abs(mp_retail-sku_market_price)/sku_market_price)) else 0 end) else 0 end confirmation_points,
    coalesce(sku_market_price>0 and cheapest_buy>0 and cheapest_buy < sku_market_price*.20,false) source_verify,
    coalesce((select max(nullif((b->>'highSalePriceWithShipping')::numeric,0)) from jsonb_array_elements(coalesce(sales_raw->'buckets','[]'::jsonb)) b),0) historical_high_sale_ship
  from x
), q as (
  select a.*,
    case when source_verify and cheapest_source='TCG Low' then .25::numeric else 1::numeric end execution_confidence_factor,
    case
      when direct_low<=0 or sku_market_price<=0 or direct_low < sku_market_price*1.75 then structural_raw
      else least(structural_raw, 20::numeric + greatest(0::numeric, structural_raw-20::numeric)*velocity_evidence_factor*case when syp_current then .85::numeric else 1::numeric end)
    end structural_points,
    case
      when direct_low<=0 or sku_market_price<=0 or direct_low < sku_market_price*1.75 then 1::numeric
      else greatest(.15::numeric, least(case when historical_high_sale_ship>0 then least(1::numeric,historical_high_sale_ship/(direct_low*.75)) else .15::numeric end, velocity_evidence_factor) * case when syp_current then .65::numeric else 1::numeric end)
    end direct_realization_factor
  from a
), f as (
  select q.*,
    direct_execution_raw*execution_confidence_factor*direct_realization_factor direct_execution_points,
    buylist_backing_raw*execution_confidence_factor buylist_backing_points,
    greatest(0,least(100,round(structural_points+direct_execution_raw*execution_confidence_factor*direct_realization_factor+buylist_backing_raw*execution_confidence_factor+liquidity_points+confirmation_points)))::int v5_score,
    coalesce(ck_buylist>cheapest_buy and cheapest_buy>0,false) buylist_backed,
    case when ck_buylist>cheapest_buy and cheapest_buy>0 then ck_buylist-cheapest_buy end buylist_spread,
    case when ck_buylist>cheapest_buy and cheapest_buy>0 then (ck_buylist-cheapest_buy)/cheapest_buy*100 end buylist_roi_pct
  from q
), upserted as (
  insert into scout_v5_shadow as t
  select user_id,sku_id,product_id,product_name,set_name,set_code,collector_number,printing,uuid,now(),opportunity_score,v5_score,
    case when v5_score>=80 then 'A' when v5_score>=70 then 'B' when v5_score>=60 then 'C' when v5_score>=50 then 'D' else 'F' end,
    round(structural_points,2),round(direct_execution_points,2),round(buylist_backing_points,2),round(liquidity_points,2),round(confirmation_points,2),0::numeric,cheapest_buy,cheapest_source,
    case when direct_low>0 then round(direct_low*.8,2) end,case when direct_low*.8>cheapest_buy then round(direct_low*.8-cheapest_buy,2) end,
    ck_retail,ck_buylist,mp_retail,mkm_retail,buylist_backed,buylist_spread,buylist_roi_pct,source_verify,
    case when direct_low>=sku_market_price*1.75 and direct_realization_factor<.70 and syp_current then 'direct_gap_restock_risk' when direct_low>=sku_market_price*1.75 and direct_realization_factor<.70 then 'speculative_direct_gap' when uuid is null then 'identity_missing' when source_verify then 'verify_source' when buylist_backed then 'buylist_backed' when confirmation_points>=3.5 then 'market_confirmed' else 'market_mixed' end,
    jsonb_build_object('version','v5-shadow-5','model','velocity-adjusted-structure70+realization-adjusted-execution20+liquidity5+confirmation5','tcgMarketRole','index','tcgLowRole','retail acquisition','tcgDirectLowRole','direct benchmark / modeled exit','structuralRaw',round(structural_raw,2),'structural',round(structural_points,2),'velocityEvidenceFactor',round(velocity_evidence_factor,3),'directExecution',round(direct_execution_points,2),'directExecutionRaw',round(direct_execution_raw*execution_confidence_factor,2),'directRealizationFactor',round(direct_realization_factor,3),'historicalHighSaleWithShipping',historical_high_sale_ship,'exactSkuSalesPerDay',avg_daily_qty_sold,'directInventoryAvailable',direct_available,'sypCurrentlyEligible',syp_current,'buylistBacking',round(buylist_backing_points,2),'liquidity',round(liquidity_points,2),'confirmation',round(confirmation_points,2),'executionConfidenceFactor',execution_confidence_factor,'cheapestSource',cheapest_source,'cheapestBuy',cheapest_buy),execution_confidence_factor
  from f
  on conflict(user_id,sku_id) do update set product_id=excluded.product_id,product_name=excluded.product_name,set_name=excluded.set_name,set_code=excluded.set_code,collector_number=excluded.collector_number,printing=excluded.printing,mtgjson_uuid=excluded.mtgjson_uuid,computed_at=excluded.computed_at,v4_score=excluded.v4_score,v5_score=excluded.v5_score,v5_grade=excluded.v5_grade,structural_points=excluded.structural_points,direct_execution_points=excluded.direct_execution_points,buylist_backing_points=excluded.buylist_backing_points,liquidity_points=excluded.liquidity_points,confirmation_points=excluded.confirmation_points,outlier_penalty=excluded.outlier_penalty,cheapest_buy=excluded.cheapest_buy,cheapest_source=excluded.cheapest_source,direct_net_est=excluded.direct_net_est,direct_net_profit=excluded.direct_net_profit,ck_retail=excluded.ck_retail,ck_buylist=excluded.ck_buylist,manapool_retail=excluded.manapool_retail,cardmarket_retail=excluded.cardmarket_retail,buylist_backed=excluded.buylist_backed,buylist_spread=excluded.buylist_spread,buylist_roi_pct=excluded.buylist_roi_pct,source_verify=excluded.source_verify,confidence_label=excluded.confidence_label,score_components=excluded.score_components,execution_confidence_factor=excluded.execution_confidence_factor
  returning 1
)
select count(*),(select max(cursor_key) from f) into n,last_key from upserted;
return jsonb_build_object('count',coalesce(n,0),'last_key',coalesce(last_key,p_after_key));
end;
$function$;
