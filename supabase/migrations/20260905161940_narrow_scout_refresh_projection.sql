-- Narrow Scout refresh workset maintained from the wide marketplace scan row table.
-- Production migration: narrow_scout_refresh_projection

create table if not exists public.marketplace_scan_rows_scout_projection (
  id bigint primary key,
  user_id uuid not null,
  scan_id uuid not null,
  sku_id text,
  product_id text,
  product_name text,
  collector_number text,
  set_name text,
  set_code text,
  rarity text,
  printing text,
  condition text,
  language text,
  direct_low numeric,
  sku_market_price numeric,
  tcg_low numeric,
  low_with_shipping numeric,
  direct_listings integer,
  direct_available integer,
  avg_daily_qty_sold numeric,
  sales_rank integer,
  supply_type text,
  scryfall_id uuid,
  edhrec_rank integer,
  raw_demand_adjustment numeric,
  raw_demand_signal text,
  raw_demand_signal_score numeric,
  base_score numeric,
  structural_score numeric,
  total_marketplace_listings numeric
);

create index if not exists marketplace_scan_rows_scout_projection_scan_idx
  on public.marketplace_scan_rows_scout_projection(user_id,scan_id,sku_id,id desc)
  where sku_id is not null;

alter table public.marketplace_scan_rows_scout_projection enable row level security;
revoke all on public.marketplace_scan_rows_scout_projection from public,anon,authenticated;
grant select,insert,update,delete on public.marketplace_scan_rows_scout_projection to service_role;

create or replace function public.sync_marketplace_scan_row_scout_projection()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    delete from public.marketplace_scan_rows_scout_projection where id=old.id;
    return old;
  end if;
  insert into public.marketplace_scan_rows_scout_projection(
    id,user_id,scan_id,sku_id,product_id,product_name,collector_number,set_name,set_code,rarity,printing,condition,language,
    direct_low,sku_market_price,tcg_low,low_with_shipping,direct_listings,direct_available,avg_daily_qty_sold,sales_rank,supply_type,
    scryfall_id,edhrec_rank,raw_demand_adjustment,raw_demand_signal,raw_demand_signal_score,base_score,structural_score,total_marketplace_listings)
  values(
    new.id,new.user_id,new.scan_id,new.sku_id,new.product_id,new.product_name,new.collector_number,new.set_name,new.set_code,new.rarity,new.printing,new.condition,new.language,
    new.direct_low,new.sku_market_price,new.tcg_low,new.low_with_shipping,new.direct_listings,new.direct_available,new.avg_daily_qty_sold,new.sales_rank,new.supply_type,
    new.scryfall_id,new.edhrec_rank,new.demand_adjustment,new.demand_signal,new.demand_signal_score,
    coalesce(new.base_opportunity_score,new.opportunity_score,0)::numeric,
    coalesce(nullif(new.raw_json->>'opportunityScore','')::numeric,coalesce(new.base_opportunity_score,new.opportunity_score,0)::numeric),
    nullif(new.raw_json->>'totalMarketplaceListings','')::numeric)
  on conflict(id) do update set
    user_id=excluded.user_id,scan_id=excluded.scan_id,sku_id=excluded.sku_id,product_id=excluded.product_id,product_name=excluded.product_name,
    collector_number=excluded.collector_number,set_name=excluded.set_name,set_code=excluded.set_code,rarity=excluded.rarity,printing=excluded.printing,
    condition=excluded.condition,language=excluded.language,direct_low=excluded.direct_low,sku_market_price=excluded.sku_market_price,tcg_low=excluded.tcg_low,
    low_with_shipping=excluded.low_with_shipping,direct_listings=excluded.direct_listings,direct_available=excluded.direct_available,
    avg_daily_qty_sold=excluded.avg_daily_qty_sold,sales_rank=excluded.sales_rank,supply_type=excluded.supply_type,scryfall_id=excluded.scryfall_id,
    edhrec_rank=excluded.edhrec_rank,raw_demand_adjustment=excluded.raw_demand_adjustment,raw_demand_signal=excluded.raw_demand_signal,
    raw_demand_signal_score=excluded.raw_demand_signal_score,base_score=excluded.base_score,structural_score=excluded.structural_score,
    total_marketplace_listings=excluded.total_marketplace_listings;
  return new;
end;$$;

revoke all on function public.sync_marketplace_scan_row_scout_projection() from public,anon,authenticated;
grant execute on function public.sync_marketplace_scan_row_scout_projection() to service_role;

drop trigger if exists marketplace_scan_rows_scout_projection_sync on public.marketplace_scan_rows;
create trigger marketplace_scan_rows_scout_projection_sync
after insert or update or delete on public.marketplace_scan_rows
for each row execute function public.sync_marketplace_scan_row_scout_projection();

insert into public.marketplace_scan_rows_scout_projection(
  id,user_id,scan_id,sku_id,product_id,product_name,collector_number,set_name,set_code,rarity,printing,condition,language,
  direct_low,sku_market_price,tcg_low,low_with_shipping,direct_listings,direct_available,avg_daily_qty_sold,sales_rank,supply_type,
  scryfall_id,edhrec_rank,raw_demand_adjustment,raw_demand_signal,raw_demand_signal_score,base_score,structural_score,total_marketplace_listings)
select id,user_id,scan_id,sku_id,product_id,product_name,collector_number,set_name,set_code,rarity,printing,condition,language,
  direct_low,sku_market_price,tcg_low,low_with_shipping,direct_listings,direct_available,avg_daily_qty_sold,sales_rank,supply_type,
  scryfall_id,edhrec_rank,demand_adjustment,demand_signal,demand_signal_score,
  coalesce(base_opportunity_score,opportunity_score,0)::numeric,
  coalesce(nullif(raw_json->>'opportunityScore','')::numeric,coalesce(base_opportunity_score,opportunity_score,0)::numeric),
  nullif(raw_json->>'totalMarketplaceListings','')::numeric
from public.marketplace_scan_rows
on conflict(id) do nothing;

analyze public.marketplace_scan_rows_scout_projection;

-- The refresh body is refined by the immediately following migrations; this migration
-- intentionally establishes the maintained projection first.