-- MarketplaceScout post-redesign performance pass, 2026-08-23.
-- Applied to production Supabase before this file was committed.
-- Preserves existing scoring/eligibility semantics.

-- SYP: support latest Marketplace context lookup by user + SKU instead of skip-scanning
-- the historical (user_id, scan_id, sku_id) index.
create index if not exists marketplace_scan_rows_user_sku_scan_idx
  on public.marketplace_scan_rows (user_id, sku_id, scan_id, id desc);

-- SYP: collapse repeated products/events scans into one aggregate per table and use
-- init-plan auth evaluation.
create or replace function public.syp_dashboard_stats()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with me as (
    select (select auth.uid()) as uid
  ), p as (
    select
      count(*)::bigint as products,
      count(*) filter (where is_currently_eligible)::bigint as eligible,
      max(collected_at) as refreshed_at
    from public.syp_products, me
    where user_id = me.uid
  ), e as (
    select
      count(*)::bigint as events,
      count(*) filter (where event_type='ADDED')::bigint as added,
      count(*) filter (where event_type='REMOVED')::bigint as removed
    from public.syp_events, me
    where user_id = me.uid
  )
  select jsonb_build_object(
    'products',p.products,
    'eligible',p.eligible,
    'events',e.events,
    'added',e.added,
    'removed',e.removed,
    'refreshed_at',p.refreshed_at
  )
  from p cross join e;
$function$;

create or replace function public.syp_filter_options_rpc()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with me as (
    select (select auth.uid()) as uid
  ), p as (
    select
      coalesce(jsonb_agg(distinct set_name order by set_name)
        filter (where is_currently_eligible and set_name is not null),'[]'::jsonb) as sets,
      coalesce(jsonb_agg(distinct condition order by condition)
        filter (where condition is not null),'[]'::jsonb) as conditions
    from public.syp_products, me
    where user_id = me.uid
  ), e as (
    select coalesce(jsonb_agg(distinct event_type order by event_type)
      filter (where event_type is not null),'[]'::jsonb) as event_types
    from public.syp_events, me
    where user_id = me.uid
  )
  select jsonb_build_object('sets',p.sets,'conditions',p.conditions,'event_types',e.event_types)
  from p cross join e;
$function$;

-- Sealed: extend the current vendor-day cache with TCGplayer retail so Sealed EV can
-- reuse the same current-price materialization instead of repeatedly reading multi-million-row
-- MTGJSON history.
alter table public.scout_vendor_price_current_cache
  add column if not exists tcgplayer_retail numeric;

create or replace function public.refresh_scout_vendor_price_current_cache()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '180s'
as $function$
declare n integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role' then
    raise exception 'service_role required';
  end if;
  truncate table public.scout_vendor_price_current_cache;
  with latest_provider as materialized (
    select uuid,provider,price_type,finish,price,observed_on
    from public.mtgjson_latest_vendor_prices
  ), latest_day as (
    select uuid,finish,max(observed_on) observed_on
    from latest_provider
    group by uuid,finish
  )
  insert into public.scout_vendor_price_current_cache (
    mtgjson_uuid,finish,observed_on,tcgplayer_retail,cardkingdom_retail,
    cardkingdom_buylist,manapool_retail,cardmarket_retail,refreshed_at
  )
  select p.uuid,p.finish,d.observed_on,
    max(p.price) filter(where p.provider='tcgplayer' and p.price_type='retail'),
    max(p.price) filter(where p.provider='cardkingdom' and p.price_type='retail'),
    max(p.price) filter(where p.provider='cardkingdom' and p.price_type='buylist'),
    max(p.price) filter(where p.provider='manapool' and p.price_type='retail'),
    max(p.price) filter(where p.provider='cardmarket' and p.price_type='retail'),
    now()
  from latest_provider p
  join latest_day d
    on d.uuid=p.uuid and d.finish=p.finish and d.observed_on=p.observed_on
  where p.provider in ('tcgplayer','cardkingdom','manapool','cardmarket')
  group by p.uuid,p.finish,d.observed_on;
  get diagnostics n=row_count;
  analyze public.scout_vendor_price_current_cache;
  return n;
end;
$function$;

-- Production refresh_enabled_sealed_ev() was updated in-place so its `priced` CTE now
-- reads these exact aliases from scout_vendor_price_current_cache instead of the old
-- lateral mtgjson_vendor_prices history aggregate:
--   tcgplayer_retail       -> tcg_market
--   cardkingdom_retail     -> ck_retail
--   cardkingdom_buylist    -> ck_buylist
--   manapool_retail        -> manapool_retail
--   cardmarket_retail      -> cardmarket_retail
--   observed_on            -> observed_on
-- Join key: mtgjson_uuid = card_uuid and finish = lower(component finish).
--
-- Validation before the switch: 500 sealed component/finish samples, 0 price mismatches.
-- Measured refresh_enabled_sealed_ev(): historical pg_stat_statements mean ~12.43 s;
-- post-cache production EXPLAIN ANALYZE ~4.89 s.
--
-- SYP validation:
-- - exact 500-row marketplace enrichment workload: ~1.42 s -> ~18 ms after index.
-- - syp_dashboard_stats() current-user result matched the original raw-count contract.
-- - syp_filter_options_rpc() current-user result matched the original distinct-option contract.
-- - measured optimized dashboard ~57 ms; filter options ~110 ms in production test context.
