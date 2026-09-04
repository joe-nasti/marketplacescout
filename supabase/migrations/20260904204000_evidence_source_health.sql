create or replace function public.ask_collectish_evidence_source_health_v1(p_sku_id text default null)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
with nowv as (select now() ts),
price as (
  select max(observed_at) latest_global,
         max(observed_at) filter(where p_sku_id is not null and sku_id=p_sku_id) latest_exact
  from public.tcgplayer_official_sku_price_history
), supply as (
  select max(observed_at) latest_global,
         max(observed_at) filter(where p_sku_id is not null and sku_id=p_sku_id) latest_exact
  from public.market_supply_snapshots where source='tcgplayer_marketplace'
), sales as (
  select max(observed_at) latest_global,
         max(observed_at) filter(where p_sku_id is not null and sku_id=p_sku_id) latest_exact,
         max(bucket_start_date) latest_business_date,
         max(bucket_start_date) filter(where p_sku_id is not null and sku_id=p_sku_id) latest_exact_business_date
  from public.marketplace_sku_sales_buckets
  where auth.uid() is not null and user_id=auth.uid()
), vendor as (
  select max(observed_at) latest_global from public.vendor_depth_events
), syp_probe as (
  select max(completed_at) filter(where status='completed') latest_completed,
         max(created_at) filter(where status='queued') latest_queued,
         count(*) filter(where status='queued') queued_count
  from public.collector_jobs
  where auth.uid() is not null and user_id=auth.uid() and payload_json->>'sypKind'='last_updated'
), syp_snapshot as (
  select max(captured_at) latest_snapshot,max(collected_at) latest_collected,max(row_count) filter(where captured_at=(select max(s2.captured_at) from public.syp_snapshots s2 where s2.user_id=auth.uid())) latest_row_count
  from public.syp_snapshots where auth.uid() is not null and user_id=auth.uid()
), android as (
  select max(last_seen_at) latest_heartbeat
  from public.collectors
  where capabilities_json->>'seller_portal_readonly_probe'='true'
    and capabilities_json->>'tcgplayer_authenticated_session'='true'
), ages as (
  select n.ts,
    extract(epoch from(n.ts-p.latest_global))/3600.0 price_age,
    extract(epoch from(n.ts-p.latest_exact))/3600.0 price_exact_age,
    extract(epoch from(n.ts-su.latest_global))/3600.0 supply_age,
    extract(epoch from(n.ts-su.latest_exact))/3600.0 supply_exact_age,
    extract(epoch from(n.ts-sa.latest_global))/3600.0 sales_age,
    extract(epoch from(n.ts-sa.latest_exact))/3600.0 sales_exact_age,
    extract(epoch from(n.ts-v.latest_global))/3600.0 vendor_age,
    extract(epoch from(n.ts-sp.latest_completed))/3600.0 syp_probe_age,
    extract(epoch from(n.ts-ss.latest_snapshot))/3600.0 syp_snapshot_age,
    extract(epoch from(n.ts-a.latest_heartbeat))/3600.0 android_age,
    p.latest_global price_latest,p.latest_exact price_exact_latest,
    su.latest_global supply_latest,su.latest_exact supply_exact_latest,
    sa.latest_global sales_latest,sa.latest_exact sales_exact_latest,sa.latest_business_date,sa.latest_exact_business_date,
    v.latest_global vendor_latest,
    sp.latest_completed syp_probe_latest,sp.latest_queued syp_queued_latest,sp.queued_count,
    ss.latest_snapshot syp_snapshot_latest,ss.latest_collected syp_collected_latest,ss.latest_row_count,
    a.latest_heartbeat android_latest
  from nowv n cross join price p cross join supply su cross join sales sa cross join vendor v cross join syp_probe sp cross join syp_snapshot ss cross join android a
), states as (
  select *,
    case when price_latest is null then 'UNAVAILABLE' when price_age<=3 then 'FRESH' when price_age<=8 then 'AGING' else 'STALE' end price_state,
    case when supply_latest is null then 'UNAVAILABLE' when supply_age<=7 then 'FRESH' when supply_age<=14 then 'AGING' else 'STALE' end supply_state,
    case when sales_latest is null then 'UNAVAILABLE' when sales_age<=24 and latest_business_date>=current_date-1 then 'FRESH' when sales_age<=48 and latest_business_date>=current_date-2 then 'AGING' else 'STALE' end sales_state,
    case when vendor_latest is null then 'UNAVAILABLE' when vendor_age<=30 then 'FRESH' when vendor_age<=48 then 'AGING' else 'STALE' end vendor_state,
    case when syp_probe_latest is null then 'UNAVAILABLE' when syp_probe_age<=2 then 'FRESH' when syp_probe_age<=6 then 'AGING' else 'STALE' end syp_probe_state,
    case when syp_snapshot_latest is null then 'UNAVAILABLE' when syp_snapshot_age<=30 then 'FRESH' when syp_snapshot_age<=48 then 'AGING' else 'STALE' end syp_snapshot_state,
    case when android_latest is null then 'UNAVAILABLE' when android_age<=1 then 'FRESH' when android_age<=6 then 'AGING' else 'STALE' end android_state
  from ages
)
select jsonb_build_object(
  'available',auth.uid() is not null,
  'version','evidence_source_health_v1',
  'sku_id',p_sku_id,
  'sources',jsonb_build_array(
    jsonb_build_object('source','tcgplayer_official_price','state',price_state,'latest_observed_at',price_latest,'age_hours',round(price_age::numeric,1),'expected_cadence','continuous/batched; healthy within 3h','exact_sku',case when p_sku_id is null then null else jsonb_build_object('latest_observed_at',price_exact_latest,'age_hours',round(price_exact_age::numeric,1),'available',price_exact_latest is not null) end),
    jsonb_build_object('source','tcgplayer_market_supply','state',supply_state,'latest_observed_at',supply_latest,'age_hours',round(supply_age::numeric,1),'expected_cadence','bounded rotating 6h + hourly episode queue','exact_sku',case when p_sku_id is null then null else jsonb_build_object('latest_observed_at',supply_exact_latest,'age_hours',round(supply_exact_age::numeric,1),'available',supply_exact_latest is not null,'note','Exact-SKU absence means unobserved, never zero supply.') end),
    jsonb_build_object('source','marketplace_sales_buckets','state',sales_state,'latest_observed_at',sales_latest,'age_hours',round(sales_age::numeric,1),'latest_business_date',latest_business_date,'expected_cadence','daily/intraday user-scoped buckets','exact_sku',case when p_sku_id is null then null else jsonb_build_object('latest_observed_at',sales_exact_latest,'age_hours',round(sales_exact_age::numeric,1),'latest_business_date',latest_exact_business_date,'available',sales_exact_latest is not null) end),
    jsonb_build_object('source','vendor_depth','state',vendor_state,'latest_observed_at',vendor_latest,'age_hours',round(vendor_age::numeric,1),'expected_cadence','daily-ish catalog observations','note','Current implementation principally reflects Card Kingdom depth.'),
    jsonb_build_object('source','syp','state',case when android_state in ('STALE','UNAVAILABLE') or syp_probe_state in ('STALE','UNAVAILABLE') then 'STALE' when syp_snapshot_state='STALE' then 'AGING' when android_state='AGING' or syp_probe_state='AGING' or syp_snapshot_state='AGING' then 'AGING' else 'FRESH' end,
      'probe_state',syp_probe_state,'latest_probe_completed_at',syp_probe_latest,'probe_age_hours',round(syp_probe_age::numeric,1),'queued_probe_count',queued_count,'oldest_or_latest_queued_at',syp_queued_latest,
      'snapshot_state',syp_snapshot_state,'latest_snapshot_at',syp_snapshot_latest,'snapshot_age_hours',round(syp_snapshot_age::numeric,1),'latest_snapshot_rows',latest_row_count,
      'collector_state',android_state,'collector_last_seen_at',android_latest,'collector_age_hours',round(android_age::numeric,1),
      'expected_cadence','30m last-updated checks; forced full snapshot at least daily','note','SYP requires an authenticated seller-session collector. A stale collector means missing SYP evidence is unknown, not no SYP pressure.'),
  ),
  'overall_state',case
    when price_state='STALE' or sales_state='STALE' then 'DEGRADED'
    when price_state='AGING' or sales_state='AGING' or supply_state='STALE' or vendor_state='STALE' then 'PARTIAL'
    when (case when android_state in ('STALE','UNAVAILABLE') or syp_probe_state in ('STALE','UNAVAILABLE') then 'STALE' when syp_snapshot_state='STALE' then 'AGING' when android_state='AGING' or syp_probe_state='AGING' or syp_snapshot_state='AGING' then 'AGING' else 'FRESH' end)='STALE' then 'PARTIAL'
    else 'HEALTHY' end,
  'interpretation','Source health describes Collectish evidence freshness/coverage, not market conditions. STALE or UNAVAILABLE evidence must never be interpreted as zero supply, zero demand, or absence from a market program.',
  'generated_at',ts
) from states;
$$;
revoke all on function public.ask_collectish_evidence_source_health_v1(text) from public,anon;
grant execute on function public.ask_collectish_evidence_source_health_v1(text) to authenticated,service_role;
