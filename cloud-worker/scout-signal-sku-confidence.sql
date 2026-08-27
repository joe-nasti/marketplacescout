-- Exact-SKU Signal confidence overlay. Broad article/creator signals still apply
-- across the Oracle family, while MTGStocks Interests receives full weight only
-- on the matching product + finish when that identity is known.

create or replace view public.market_intel_scout_confidence_sku
with (security_invoker=true)
as
with recent as (
  select distinct
    l.user_id,c.sku_id,c.product_id,l.oracle_id,l.canonical_name,l.intel_id,l.family_match,
    i.source_url,i.source_name,i.source_subtype,i.signal_stage,i.direction,
    coalesce(i.confidence,0.5)::numeric confidence,
    coalesce(i.published_at,i.observed_at,i.created_at) signal_at,
    case i.signal_stage when 'leading' then 1.00 when 'confirming' then 0.70 when 'lagging' then 0.25 else 0.10 end::numeric stage_weight,
    case when coalesce(i.published_at,i.observed_at,i.created_at)>=now()-interval '3 days' then 1.00
         when coalesce(i.published_at,i.observed_at,i.created_at)>=now()-interval '7 days' then 0.85
         when coalesce(i.published_at,i.observed_at,i.created_at)>=now()-interval '14 days' then 0.65 else 0.40 end::numeric recency_weight,
    case i.direction when 'bullish' then 1 when 'bearish' then -1 else 0 end::numeric direction_weight,
    coalesce(nullif(i.source_url,''),nullif(i.source_name,''),i.intel_id::text) source_key,
    case
      when i.source_name='MTGStocks' and i.source_subtype='interests'
        and ipc.source_product_id=c.product_id
        and (
          (lower(coalesce(ipc.finish,'regular'))='regular' and upper(coalesce(c.printing,''))='NON FOIL')
          or (lower(coalesce(ipc.finish,''))='foil' and coalesce(lower(i.metadata_json->>'original_card_name'),'') like '%etched%' and upper(coalesce(c.finish,''))='ETCHED')
          or (lower(coalesce(ipc.finish,''))='foil' and coalesce(lower(i.metadata_json->>'original_card_name'),'') not like '%etched%' and upper(coalesce(c.printing,''))='FOIL' and upper(coalesce(c.finish,''))<>'ETCHED')
        ) then 1.00
      when i.source_name='MTGStocks' and i.source_subtype='interests' then coalesce(ipc.family_context_weight,0.35)
      else 1.00
    end::numeric specificity_weight,
    case when i.source_name='MTGStocks' and i.source_subtype='interests' then coalesce(ipc.corroborating_exact_printings,0) else 0 end corroborating_exact_printings
  from public.market_intel_scout_signal_links l
  join public.market_intel_items i on i.intel_id=l.intel_id and i.user_id=l.user_id
  join public.scout_card_catalog c on c.product_id=l.product_id and upper(c.condition)='NEAR MINT' and upper(c.language)='ENGLISH'
  left join public.market_intel_interest_printing_context ipc on ipc.intel_id=i.intel_id and ipc.user_id=i.user_id
  where coalesce(i.published_at,i.observed_at,i.created_at)>=now()-interval '30 days'
    and coalesce(i.signal_stage,'noise')<>'noise'
), agg as (
  select user_id,sku_id,product_id,
    (array_agg(oracle_id) filter(where oracle_id is not null))[1] oracle_id,
    max(canonical_name) canonical_name,
    count(distinct intel_id)::int signal_count,count(distinct source_key)::int independent_sources,
    count(distinct source_key) filter(where signal_stage='leading')::int leading_sources,
    count(distinct source_key) filter(where signal_stage='confirming')::int confirming_sources,
    count(*) filter(where direction='bullish')::int bullish_signals,count(*) filter(where direction='bearish')::int bearish_signals,
    count(*) filter(where family_match or specificity_weight<1)::int inherited_signal_count,
    count(*) filter(where not family_match and specificity_weight=1)::int exact_signal_count,
    count(*) filter(where source_name='MTGStocks' and source_subtype='interests' and specificity_weight=1)::int interest_exact_signal_count,
    count(*) filter(where source_name='MTGStocks' and source_subtype='interests' and specificity_weight<1)::int interest_inherited_signal_count,
    max(corroborating_exact_printings)::int interest_corroborating_printings,
    max(signal_at) latest_signal_at,
    round(sum(direction_weight*confidence*stage_weight*recency_weight*specificity_weight),3) weighted_net,
    greatest(0.35,max(specificity_weight))::numeric specificity_factor
  from recent group by user_id,sku_id,product_id
), scored as (
  select *,greatest(0,least(8,
    (case when independent_sources>=3 then 5 when independent_sources=2 then 3 when independent_sources=1 then 1 else 0 end)
    +(case when leading_sources>=1 then 1 else 0 end)
    +(case when latest_signal_at>=now()-interval '3 days' then 1 else 0 end)))::int raw_priority_boost
  from agg
)
select user_id,sku_id,product_id,oracle_id,canonical_name,signal_count,independent_sources,leading_sources,confirming_sources,
  bullish_signals,bearish_signals,inherited_signal_count,exact_signal_count,latest_signal_at,weighted_net,
  case when weighted_net>0 then floor(raw_priority_boost*specificity_factor)::int else 0 end::int priority_boost,
  case when weighted_net<=0 then 'mixed_or_bearish'
       when floor(raw_priority_boost*specificity_factor)>=6 and independent_sources>=3 then 'strong_corroboration'
       when floor(raw_priority_boost*specificity_factor)>=4 and independent_sources>=2 then 'corroborated'
       when floor(raw_priority_boost*specificity_factor)>=2 then 'emerging' else 'context' end::text confidence_label,
  case when weighted_net<=0 then 'Recent Signals are mixed or bearish; no Scout priority boost.'
       when interest_inherited_signal_count>0 and interest_exact_signal_count=0 and interest_corroborating_printings<2 then 'MTGStocks Interests movement is isolated to another printing or finish; it is weak Oracle-family context and does not change the Scout grade.'
       when interest_corroborating_printings>=2 then 'MTGStocks Interests movement is corroborated across multiple exact printings of the underlying card.'
       when interest_exact_signal_count>0 then 'MTGStocks Interests movement matches this exact product and finish; it is execution context, while Scout grade remains based on exact-SKU economics.'
       when floor(raw_priority_boost*specificity_factor)>=6 and independent_sources>=3 then 'Multiple recent independent Signals strongly corroborate the underlying card thesis.'
       when floor(raw_priority_boost*specificity_factor)>=4 and independent_sources>=2 then 'Recent independent Signals corroborate the underlying card thesis.'
       when floor(raw_priority_boost*specificity_factor)>=2 then 'Recent Signals provide emerging support for the underlying card thesis.'
       else 'A recent Signal provides context, but not enough independent corroboration to materially raise priority.' end::text confidence_reason,
  interest_exact_signal_count,interest_inherited_signal_count,interest_corroborating_printings,specificity_factor
from scored;

revoke all on public.market_intel_scout_confidence_sku from public,anon;
grant select on public.market_intel_scout_confidence_sku to authenticated;
