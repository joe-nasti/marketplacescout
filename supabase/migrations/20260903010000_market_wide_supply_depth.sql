-- Market-wide supply is a separate evidence contract from TCGplayer Direct supply.
-- Only sources with actual listing/unit counts may populate market_supply_snapshots.

create table if not exists public.market_supply_snapshots (
  snapshot_id bigint generated always as identity primary key,
  source text not null,
  product_id text not null,
  sku_id text not null,
  observed_at timestamptz not null default now(),
  coverage_state text not null default 'COMPLETE',
  listing_count integer,
  seller_count integer,
  unit_count integer,
  direct_listing_count integer,
  direct_seller_count integer,
  direct_unit_count integer,
  non_direct_listing_count integer,
  non_direct_seller_count integer,
  non_direct_unit_count integer,
  custom_listing_count integer,
  lowest_price numeric,
  lowest_price_with_shipping numeric,
  source_query_total_results integer,
  pages_fetched integer,
  source_method text not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint market_supply_snapshots_nonnegative check (
    coalesce(listing_count,0)>=0 and coalesce(seller_count,0)>=0 and coalesce(unit_count,0)>=0 and
    coalesce(direct_listing_count,0)>=0 and coalesce(direct_seller_count,0)>=0 and coalesce(direct_unit_count,0)>=0 and
    coalesce(non_direct_listing_count,0)>=0 and coalesce(non_direct_seller_count,0)>=0 and coalesce(non_direct_unit_count,0)>=0
  )
);

create index if not exists market_supply_snapshots_sku_source_observed_idx
  on public.market_supply_snapshots(sku_id,source,observed_at desc);

alter table public.market_supply_snapshots enable row level security;
revoke all on table public.market_supply_snapshots from public,anon,authenticated;
grant select,insert,update,delete on table public.market_supply_snapshots to service_role;

create or replace view public.market_supply_current
with (security_invoker=true) as
select distinct on (source,sku_id) *
from public.market_supply_snapshots
order by source,sku_id,observed_at desc,snapshot_id desc;
revoke all on public.market_supply_current from public,anon,authenticated;
grant select on public.market_supply_current to service_role;

create or replace function public.ask_collectish_market_supply_v1(
  p_product_id text default null,
  p_sku_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  r public.market_supply_snapshots%rowtype;
  age_hours numeric;
  depth_label text;
  days_cover numeric;
  velocity numeric;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if coalesce(p_sku_id,'')='' and coalesce(p_product_id,'')='' then raise exception 'product_id or sku_id required'; end if;

  select s.* into r
  from public.market_supply_snapshots s
  where s.source='tcgplayer_marketplace'
    and (p_sku_id is null or s.sku_id=p_sku_id)
    and (p_product_id is null or s.product_id=p_product_id)
  order by s.observed_at desc,s.snapshot_id desc
  limit 1;

  if r.snapshot_id is null then
    return jsonb_build_object(
      'available',false,
      'global_supply_classification','UNPROVEN',
      'coverage_state','MISSING',
      'note','No exact-SKU all-market listing snapshot is available. Direct inventory alone cannot establish market-wide thin supply.'
    );
  end if;

  age_hours := extract(epoch from (now()-r.observed_at))/3600.0;
  select nullif(x.avg_daily_qty_sold,0) into velocity
  from public.ask_collectish_public_internal_sku_evidence_v1(array[r.sku_id]::text[]) x
  where x.sku_id=r.sku_id limit 1;
  if velocity is not null and r.unit_count is not null then days_cover:=r.unit_count/velocity; end if;

  depth_label := case
    when r.coverage_state<>'COMPLETE' or age_hours>24 then 'UNPROVEN'
    when days_cover is not null and days_cover<7 then 'VERY_THIN'
    when days_cover is not null and days_cover<21 then 'THIN'
    when coalesce(r.unit_count,0)<=8 or coalesce(r.seller_count,0)<=3 then 'VERY_THIN'
    when coalesce(r.unit_count,0)<=25 and coalesce(r.seller_count,0)<=10 then 'THIN'
    when coalesce(r.unit_count,0)>=100 and coalesce(r.seller_count,0)>=20 then 'DEEP'
    else 'MODERATE'
  end;

  return jsonb_build_object(
    'available',true,
    'source',r.source,
    'source_method',r.source_method,
    'observed_at',r.observed_at,
    'age_hours',round(age_hours,2),
    'coverage_state',r.coverage_state,
    'global_supply_classification',depth_label,
    'listing_count',r.listing_count,
    'seller_count',r.seller_count,
    'unit_count',r.unit_count,
    'direct_listing_count',r.direct_listing_count,
    'direct_seller_count',r.direct_seller_count,
    'direct_unit_count',r.direct_unit_count,
    'non_direct_listing_count',r.non_direct_listing_count,
    'non_direct_seller_count',r.non_direct_seller_count,
    'non_direct_unit_count',r.non_direct_unit_count,
    'direct_share_of_units',case when coalesce(r.unit_count,0)>0 then round(100.0*r.direct_unit_count/r.unit_count,1) end,
    'custom_listing_count',r.custom_listing_count,
    'lowest_price',r.lowest_price,
    'lowest_price_with_shipping',r.lowest_price_with_shipping,
    'avg_daily_qty_sold',velocity,
    'estimated_days_of_market_cover',case when days_cover is not null then round(days_cover,1) end,
    'note','Global supply classification uses exact-SKU all-market listing depth. Retailer price presence is corroborating availability only unless a source supplies actual stock quantity.'
  );
end
$$;

revoke all on function public.ask_collectish_market_supply_v1(text,text) from public,anon;
grant execute on function public.ask_collectish_market_supply_v1(text,text) to authenticated,service_role;

-- Preserve the existing Scout/shared lookup and augment it with exact-SKU market-wide supply.
do $$ begin
  if to_regprocedure('public.ask_collectish_get_scout_card_base_v1(text,text)') is null then
    alter function public.ask_collectish_get_scout_card(text,text) rename to ask_collectish_get_scout_card_base_v1;
  end if;
end $$;

create or replace function public.ask_collectish_get_scout_card(p_product_id text default null,p_sku_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  b jsonb;
  c jsonb;
  s jsonb;
  pid text;
  sid text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  b:=public.ask_collectish_get_scout_card_base_v1(p_product_id,p_sku_id);
  if not coalesce((b->>'found')::boolean,false) then return b; end if;
  c:=coalesce(b->'card','{}'::jsonb);
  pid:=coalesce(nullif(c->>'product_id',''),p_product_id);
  sid:=coalesce(nullif(c->>'sku_id',''),p_sku_id);
  s:=public.ask_collectish_market_supply_v1(pid,sid);
  c:=c || jsonb_build_object(
    'market_supply',s,
    'global_supply_classification',coalesce(s->>'global_supply_classification','UNPROVEN'),
    'supply_scope',case when coalesce((s->>'available')::boolean,false) then 'EXACT_SKU_ALL_TCGPLAYER' else coalesce(c->>'supply_scope','DIRECT_ONLY') end,
    'supply_scope_note',case when coalesce((s->>'available')::boolean,false)
      then 'Market-wide supply uses exact-SKU TCGplayer marketplace listing depth; Direct remains a subset. External retailer prices indicate availability only unless stock counts are collected.'
      else coalesce(c->>'supply_scope_note','Direct inventory alone cannot prove market-wide supply.') end
  );
  return jsonb_set(b,'{card}',c,true);
end
$$;

revoke all on function public.ask_collectish_get_scout_card(text,text) from public,anon;
grant execute on function public.ask_collectish_get_scout_card(text,text) to authenticated,service_role;

notify pgrst,'reload schema';
