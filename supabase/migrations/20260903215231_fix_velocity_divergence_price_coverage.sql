create or replace function public.ask_delvin_velocity_price_supply_divergence_v1(p_limit integer default 25)
returns jsonb
language sql
stable
security definer
set search_path='public'
as $function$
with velocity_raw as (
  select 'persistent'::text velocity_mode, x.*
  from jsonb_to_recordset(public.ask_delvin_tcgplayer_velocity_persistent_cache_v1()->'rows') as x(
    card_name text,set_name text,current_rank integer,previous_rank integer,rank_improvement integer,
    persistence_score numeric,acceleration_score numeric,average_sale_price numeric,price_bucket text,
    sales_month date,is_new_entry boolean,breakout boolean
  )
  union all
  select 'breakout'::text velocity_mode, x.*
  from jsonb_to_recordset(public.ask_delvin_tcgplayer_velocity_breakouts_cache_v1()->'rows') as x(
    card_name text,set_name text,current_rank integer,previous_rank integer,rank_improvement integer,
    persistence_score numeric,acceleration_score numeric,average_sale_price numeric,price_bucket text,
    sales_month date,is_new_entry boolean,breakout boolean
  )
), velocity as (
  select distinct on (lower(card_name),lower(set_name),price_bucket)
    *,greatest(coalesce(persistence_score,0),coalesce(acceleration_score,0)) demand_score
  from velocity_raw
  order by lower(card_name),lower(set_name),price_bucket,
    greatest(coalesce(persistence_score,0),coalesce(acceleration_score,0)) desc,
    case velocity_mode when 'breakout' then 0 else 1 end
), mapped as (
  select v.*,s.code set_code,public.delvin_base_card_name_v1(v.card_name) base_card_name
  from velocity v
  left join public.magic_set_catalog s
    on lower(coalesce(s.tcgplayer_name,s.name))=lower(v.set_name)
), catalog as (
  select m.*,c.sku_id,c.product_id
  from mapped m
  left join public.scout_card_catalog c
    on c.set_code=m.set_code
   and lower(c.card_name)=lower(m.base_card_name)
   and upper(coalesce(c.language,''))='ENGLISH'
   and upper(coalesce(c.condition,'')) in ('NEAR MINT','LIGHTLY PLAYED')
), identity_stats as (
  select lower(card_name) card_key,lower(set_name) set_key,price_bucket,
    count(distinct product_id) filter(where product_id is not null) product_count,
    count(distinct sku_id) filter(where sku_id is not null) sku_count
  from catalog group by 1,2,3
), eval_rows as (
  select m.card_name,m.set_name,m.price_bucket,e.sku_id,e.product_id,e.evaluated_at,
    e.low_with_shipping,e.sku_market_price,e.direct_available,e.direct_listings
  from mapped m
  join public.scout_evaluation_history e
    on e.set_code=m.set_code
   and lower(public.delvin_base_card_name_v1(e.product_name))=lower(m.base_card_name)
   and upper(coalesce(e.language,''))='ENGLISH'
   and upper(coalesce(e.condition,'')) in ('NEAR MINT','LIGHTLY PLAYED')
), eval_first as (
  select distinct on (lower(card_name),lower(set_name),price_bucket,sku_id)
    card_name,set_name,price_bucket,sku_id,product_id,evaluated_at,low_with_shipping,sku_market_price,direct_available,direct_listings
  from eval_rows
  order by lower(card_name),lower(set_name),price_bucket,sku_id,evaluated_at asc
), eval_latest as (
  select distinct on (lower(card_name),lower(set_name),price_bucket,sku_id)
    card_name,set_name,price_bucket,sku_id,product_id,evaluated_at,low_with_shipping,sku_market_price,direct_available,direct_listings
  from eval_rows
  order by lower(card_name),lower(set_name),price_bucket,sku_id,evaluated_at desc
), sku_moves as (
  select l.card_name,l.set_name,l.price_bucket,l.sku_id,l.product_id,
    f.evaluated_at first_at,l.evaluated_at latest_at,
    f.low_with_shipping first_low_with_shipping,l.low_with_shipping current_low_with_shipping,
    f.direct_available first_direct_available,l.direct_available current_direct_available,
    f.direct_listings first_direct_listings,l.direct_listings current_direct_listings,
    case when f.low_with_shipping>0 and l.low_with_shipping is not null then (l.low_with_shipping/f.low_with_shipping-1)*100 end sku_price_change_pct
  from eval_latest l join eval_first f using(card_name,set_name,price_bucket,sku_id)
), family_eval as (
  select lower(card_name) card_key,lower(set_name) set_key,price_bucket,
    min(current_low_with_shipping) current_low_with_shipping,
    min(first_low_with_shipping) first_low_with_shipping,
    percentile_cont(0.5) within group(order by sku_price_change_pct) filter(where sku_price_change_pct is not null) median_price_change_pct,
    sum(coalesce(current_direct_available,0)) current_direct_available,
    sum(coalesce(first_direct_available,0)) first_direct_available,
    sum(coalesce(current_direct_listings,0)) current_direct_listings,
    sum(coalesce(first_direct_listings,0)) first_direct_listings,
    min(first_at) price_history_start,max(latest_at) price_history_end,
    count(*) filter(where current_low_with_shipping is not null) priced_skus,
    count(distinct product_id) eval_product_count
  from sku_moves group by 1,2,3
), supply_rows as (
  select m.card_name,m.set_name,m.price_bucket,ms.sku_id,ms.observed_at,ms.unit_count,ms.listing_count,ms.coverage_state
  from mapped m join public.market_supply_snapshots ms
    on upper(coalesce(ms.metadata->>'set_code',''))=upper(coalesce(m.set_code,''))
   and lower(public.delvin_base_card_name_v1(coalesce(ms.metadata->>'card_name','')))=lower(m.base_card_name)
  where upper(coalesce(ms.metadata->>'language','ENGLISH'))='ENGLISH'
    and upper(coalesce(ms.metadata->>'condition','')) in ('NEAR MINT','LIGHTLY PLAYED')
    and ms.coverage_state='COMPLETE'
), supply_first as (
  select distinct on (lower(card_name),lower(set_name),price_bucket,sku_id)
    card_name,set_name,price_bucket,sku_id,observed_at,unit_count,listing_count
  from supply_rows order by lower(card_name),lower(set_name),price_bucket,sku_id,observed_at asc
), supply_latest as (
  select distinct on (lower(card_name),lower(set_name),price_bucket,sku_id)
    card_name,set_name,price_bucket,sku_id,observed_at,unit_count,listing_count
  from supply_rows order by lower(card_name),lower(set_name),price_bucket,sku_id,observed_at desc
), family_supply as (
  select lower(l.card_name) card_key,lower(l.set_name) set_key,l.price_bucket,
    sum(coalesce(l.unit_count,0)) current_market_units,sum(coalesce(f.unit_count,0)) first_market_units,
    sum(coalesce(l.listing_count,0)) current_market_listings,sum(coalesce(f.listing_count,0)) first_market_listings,
    min(f.observed_at) supply_history_start,max(l.observed_at) supply_history_end,
    count(*) supply_skus
  from supply_latest l join supply_first f using(card_name,set_name,price_bucket,sku_id)
  group by 1,2,3
), scored as (
  select m.card_name,m.base_card_name,m.set_name,m.set_code,m.price_bucket,m.sales_month,m.current_rank,m.previous_rank,m.rank_improvement,
    m.persistence_score,m.acceleration_score,m.demand_score,m.average_sale_price,m.is_new_entry,m.breakout,m.velocity_mode,
    coalesce(i.product_count,0) product_count,coalesce(i.sku_count,0) sku_count,
    case when coalesce(i.product_count,0)=1 and coalesce(fe.eval_product_count,0)<=1 then 'EXACT_PRODUCT' else 'SET_CARD_FAMILY' end identity_scope,
    fe.current_low_with_shipping,fe.first_low_with_shipping,round(fe.median_price_change_pct::numeric,2) recent_price_change_pct,
    fe.current_direct_available,fe.first_direct_available,fe.current_direct_listings,fe.first_direct_listings,
    fe.price_history_start,fe.price_history_end,fe.priced_skus,
    round((extract(epoch from(fe.price_history_end-fe.price_history_start))/3600.0)::numeric,2) price_history_hours,
    case when m.average_sale_price>0 and fe.current_low_with_shipping is not null then round(((fe.current_low_with_shipping/m.average_sale_price)-1)*100,2) end current_low_vs_report_avg_pct,
    fs.current_market_units,fs.first_market_units,fs.current_market_listings,fs.first_market_listings,fs.supply_history_start,fs.supply_history_end,fs.supply_skus,
    case
      when fs.supply_skus is null or fs.supply_skus=0 or fs.supply_history_end<=fs.supply_history_start then 'UNPROVEN'
      when fs.first_market_units>0 and fs.current_market_units <= fs.first_market_units*0.85 then 'CONTRACTING'
      when fs.first_market_units>0 and fs.current_market_units >= fs.first_market_units*1.15 then 'EXPANDING'
      else 'STABLE'
    end global_supply_state,
    case
      when fe.price_history_end is null or fe.price_history_start is null or fe.price_history_end<=fe.price_history_start then 'UNPROVEN'
      when fe.first_direct_available>0 and fe.current_direct_available <= fe.first_direct_available*0.85 then 'CONTRACTING'
      when fe.first_direct_available>0 and fe.current_direct_available >= fe.first_direct_available*1.15 then 'EXPANDING'
      else 'STABLE'
    end direct_supply_state
  from mapped m
  left join identity_stats i on i.card_key=lower(m.card_name) and i.set_key=lower(m.set_name) and i.price_bucket=m.price_bucket
  left join family_eval fe on fe.card_key=lower(m.card_name) and fe.set_key=lower(m.set_name) and fe.price_bucket=m.price_bucket
  left join family_supply fs on fs.card_key=lower(m.card_name) and fs.set_key=lower(m.set_name) and fs.price_bucket=m.price_bucket
), final as (
  select s.*,
    case
      when current_low_with_shipping is null then 'NO_PRICE_COVERAGE'
      when identity_scope='EXACT_PRODUCT' and current_low_vs_report_avg_pct<=5 then 'EXACT_PRICE_LAG'
      when identity_scope='SET_CARD_FAMILY' and current_low_vs_report_avg_pct<=-10 then 'FAMILY_FLOOR_LAG'
      when current_low_vs_report_avg_pct>=10 then 'PRICE_REACTED'
      else 'NEUTRAL'
    end price_signal,
    round((
      least(40,greatest(0,coalesce(demand_score,0))*0.40)
      + case
          when current_low_with_shipping is null then 0
          when identity_scope='EXACT_PRODUCT' and current_low_vs_report_avg_pct<=-5 then 25
          when identity_scope='EXACT_PRODUCT' and current_low_vs_report_avg_pct<=5 then 18
          when identity_scope='SET_CARD_FAMILY' and current_low_vs_report_avg_pct<=-15 then 12
          when identity_scope='SET_CARD_FAMILY' and current_low_vs_report_avg_pct<=-10 then 8
          else 0 end
      + case when direct_supply_state='CONTRACTING' then 12 when coalesce(current_direct_available,999999)<=20 then 5 else 0 end
      + case when global_supply_state='CONTRACTING' then 18 else 0 end
      + case when coalesce(price_history_hours,0)>=1 then 5 else 0 end
    )::numeric,1) divergence_score
  from scored s
), classified as (
  select f.*,
    case
      when divergence_score>=72 and price_signal='EXACT_PRICE_LAG' and global_supply_state='CONTRACTING' then 'MISPRICED_DEMAND_CONFIRMED'
      when divergence_score>=60 and price_signal='EXACT_PRICE_LAG' and direct_supply_state='CONTRACTING' then 'PRICE_LAG_DIRECT_TIGHTENING'
      when divergence_score>=55 and price_signal in ('EXACT_PRICE_LAG','FAMILY_FLOOR_LAG') and global_supply_state='UNPROVEN' then 'PRICE_LAG_SUPPLY_UNPROVEN'
      when demand_score>=80 and price_signal='PRICE_REACTED' then 'DEMAND_CONFIRMED_PRICE_REACTED'
      else 'WATCH'
    end signal_class
  from final f
), coverage as (
  select count(*) high_demand_rows,
    count(*) filter(where current_low_with_shipping is not null) rows_with_price_evidence,
    count(*) filter(where current_low_with_shipping is null) uncovered_high_demand_rows,
    count(*) filter(where global_supply_state<>'UNPROVEN') rows_with_market_supply_history
  from classified where demand_score>=70
), ranked as (
  select * from classified
  where demand_score>=70 and current_low_with_shipping is not null
  order by divergence_score desc,demand_score desc,current_rank asc
  limit greatest(1,least(coalesce(p_limit,25),50))
)
select jsonb_build_object(
  'as_of',now(),
  'model','velocity_price_supply_divergence_v1',
  'scope','TCGplayer Top Selling demand joined to Collectish NM/LP price and supply evidence',
  'supply_note','Direct and market-wide supply are scored separately. Market-wide contraction remains UNPROVEN without repeated COMPLETE marketplace snapshots.',
  'identity_note','Top Selling CSVs do not include TCGplayer product IDs. EXACT_PRODUCT is used only when both catalog and observed history resolve to one product; otherwise price evidence is explicitly set/card-family level.',
  'coverage',to_jsonb(coverage),
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.divergence_score desc,r.demand_score desc,r.current_rank asc) from ranked r),'[]'::jsonb)
) from coverage
$function$;

revoke all on function public.ask_delvin_velocity_price_supply_divergence_v1(integer) from public,anon,authenticated;
grant execute on function public.ask_delvin_velocity_price_supply_divergence_v1(integer) to service_role;

select public.refresh_delvin_query_cache_v1('velocity_price_supply_divergence',true);