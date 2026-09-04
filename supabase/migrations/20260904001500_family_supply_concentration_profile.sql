-- Printing/finish-level supply concentration across an explicitly resolved NM/LP family.
-- TCGplayer product IDs can share foil/nonfoil SKUs, so product + finish is the
-- printing-depth grouping key; conditions are combined within that finish.
create or replace function public.ask_collectish_family_supply_concentration_v1(p_sku_ids text[])
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with requested as (
  select distinct x as sku_id from unnest(coalesce(p_sku_ids,array[]::text[])) x where coalesce(x,'')<>''
), latest as (
  select distinct on (s.sku_id) s.*
  from public.market_supply_snapshots s join requested r on r.sku_id=s.sku_id
  where s.source='tcgplayer_marketplace'
  order by s.sku_id,s.observed_at desc,s.snapshot_id desc
), normalized as (
  select l.*,
    case when upper(coalesce(l.metadata->>'printing','')) like '%FOIL%'
               and upper(coalesce(l.metadata->>'printing','')) not like '%NON FOIL%'
      then 'FOIL' else 'NON FOIL' end as finish_scope
  from latest l
), seller_keys as (
  select l.sku_id,l.product_id,l.finish_scope,k.value as seller_key
  from normalized l
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(l.metadata->'seller_keys')='array' then l.metadata->'seller_keys' else '[]'::jsonb end
  ) k(value)
), grouped as (
  select l.product_id,l.finish_scope,
    min(coalesce(l.metadata->>'card_name','')) as card_name,
    min(coalesce(l.metadata->>'set_code','')) as set_code,
    min(coalesce(l.metadata->>'collector_number','')) as collector_number,
    count(*)::int as sku_count,
    count(*) filter(where upper(coalesce(l.metadata->>'condition','')) in ('NEAR MINT','NM'))::int as nm_sku_count,
    count(*) filter(where upper(coalesce(l.metadata->>'condition','')) in ('LIGHTLY PLAYED','LP'))::int as lp_sku_count,
    sum(coalesce(l.unit_count,0))::int as unit_count,
    sum(coalesce(l.listing_count,0))::int as listing_count,
    sum(coalesce(l.direct_unit_count,0))::int as direct_unit_count,
    sum(coalesce(l.non_direct_unit_count,0))::int as non_direct_unit_count,
    max(coalesce(l.seller_count,0))::int as seller_lower_bound,
    bool_and(jsonb_typeof(l.metadata->'seller_keys')='array') as seller_keys_complete,
    min(l.observed_at) as oldest_observed_at,max(l.observed_at) as newest_observed_at
  from normalized l group by l.product_id,l.finish_scope
), seller_counts as (
  select product_id,finish_scope,count(distinct seller_key)::int as unique_seller_count
  from seller_keys group by product_id,finish_scope
), printing_rows as (
  select g.*,
    case when g.seller_keys_complete then coalesce(sc.unique_seller_count,0) end as unique_seller_count,
    case when g.seller_keys_complete then coalesce(sc.unique_seller_count,0) else g.seller_lower_bound end as classification_sellers,
    case when g.seller_keys_complete then 'deduplicated_exact' else 'conservative_lower_bound' end as seller_count_quality
  from grouped g left join seller_counts sc using(product_id,finish_scope)
), totals as (
  select count(*)::int printing_count,sum(unit_count)::int total_units,sum(listing_count)::int total_listings,
    sum(direct_unit_count)::int total_direct_units,sum(non_direct_unit_count)::int total_non_direct_units,
    min(oldest_observed_at) oldest_observed_at,max(newest_observed_at) newest_observed_at
  from printing_rows
), scored as (
  select p.*,
    case when coalesce(t.total_units,0)>0 then round(100.0*p.unit_count/t.total_units,1) else 0 end supply_share_pct,
    case when p.unit_count<=8 or p.classification_sellers<=3 then 'VERY_THIN'
      when p.unit_count<=25 and p.classification_sellers<=10 then 'THIN'
      when p.unit_count>=100 and p.classification_sellers>=20 then 'DEEP' else 'MODERATE' end supply_classification
  from printing_rows p cross join totals t
), ranked as (
  select s.*,row_number() over(order by unit_count desc,listing_count desc,product_id,finish_scope) depth_rank,
    row_number() over(order by unit_count asc,classification_sellers asc,product_id,finish_scope) scarcity_rank
  from scored s
), concentration as (
  select coalesce(max(supply_share_pct) filter(where depth_rank=1),0) top1_share_pct,
    coalesce(sum(supply_share_pct) filter(where depth_rank<=3),0) top3_share_pct,
    case when coalesce((select total_units from totals),0)>0
      then round(sum(power(unit_count::numeric/(select total_units from totals),2))*10000,0) else 0 end hhi
  from ranked
), rows_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',product_id,'finish',finish_scope,'card_name',nullif(card_name,''),'set_code',nullif(set_code,''),'collector_number',nullif(collector_number,''),
    'sku_count',sku_count,'nm_sku_count',nm_sku_count,'lp_sku_count',lp_sku_count,'unit_count',unit_count,'listing_count',listing_count,
    'direct_unit_count',direct_unit_count,'non_direct_unit_count',non_direct_unit_count,'unique_seller_count',unique_seller_count,
    'seller_lower_bound',seller_lower_bound,'seller_count_quality',seller_count_quality,'supply_share_pct',supply_share_pct,
    'supply_classification',supply_classification,'oldest_observed_at',oldest_observed_at,'newest_observed_at',newest_observed_at
  ) order by unit_count desc,product_id,finish_scope),'[]'::jsonb) rows from ranked
), tight as (
  select jsonb_build_object('product_id',product_id,'finish',finish_scope,'card_name',nullif(card_name,''),'set_code',nullif(set_code,''),'collector_number',nullif(collector_number,''),'unit_count',unit_count,'listing_count',listing_count,'seller_count',coalesce(unique_seller_count,seller_lower_bound),'seller_count_quality',seller_count_quality,'supply_share_pct',supply_share_pct,'supply_classification',supply_classification) row
  from ranked where scarcity_rank=1
), deep as (
  select jsonb_build_object('product_id',product_id,'finish',finish_scope,'card_name',nullif(card_name,''),'set_code',nullif(set_code,''),'collector_number',nullif(collector_number,''),'unit_count',unit_count,'listing_count',listing_count,'seller_count',coalesce(unique_seller_count,seller_lower_bound),'seller_count_quality',seller_count_quality,'supply_share_pct',supply_share_pct,'supply_classification',supply_classification) row
  from ranked where depth_rank=1
)
select case
 when auth.uid() is null then jsonb_build_object('available',false,'error','authentication required')
 when coalesce(array_length(p_sku_ids,1),0)=0 then jsonb_build_object('available',false,'error','sku ids required')
 else jsonb_build_object(
  'available',(select printing_count>0 from totals),'scope','CARD_FAMILY_NM_LP_PRODUCT_FINISH_CONCENTRATION',
  'printing_count',(select printing_count from totals),'total_units',coalesce((select total_units from totals),0),
  'total_listings',coalesce((select total_listings from totals),0),'direct_units',coalesce((select total_direct_units from totals),0),
  'non_direct_units',coalesce((select total_non_direct_units from totals),0),'top1_supply_share_pct',(select top1_share_pct from concentration),
  'top3_supply_share_pct',(select top3_share_pct from concentration),'hhi',(select hhi from concentration),
  'concentration_classification',case
    when (select top1_share_pct from concentration)>=70 or (select hhi from concentration)>=5000 then 'HIGHLY_CONCENTRATED'
    when (select top1_share_pct from concentration)>=50 or (select hhi from concentration)>=3000 then 'CONCENTRATED'
    else 'DIVERSIFIED' end,
  'tightest_printing',(select row from tight),'deepest_printing',(select row from deep),
  'oldest_observed_at',(select oldest_observed_at from totals),'newest_observed_at',(select newest_observed_at from totals),
  'printing_rows',(select rows from rows_json),
  'note','Printing shares group exact TCGplayer product + finish and combine requested NM/LP conditions. A scarce premium printing does not make the whole card family thin. Seller counts are deduplicated when snapshot seller keys are available; otherwise a conservative lower bound is used.'
 ) end
$$;
revoke all on function public.ask_collectish_family_supply_concentration_v1(text[]) from public,anon;
grant execute on function public.ask_collectish_family_supply_concentration_v1(text[]) to authenticated,service_role;
notify pgrst,'reload schema';
