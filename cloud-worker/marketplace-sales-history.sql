-- Canonical TCGplayer sales-history subsystem shared by Scout, Signals, set scans, and future consumers.
-- Production migration: shared_marketplace_sales_history

create table if not exists public.marketplace_product_sales_cache (
  user_id uuid not null,
  product_id text not null,
  fetched_at timestamptz not null default now(),
  source text not null default 'tcgplayer_infinite_detailed_quarter',
  raw_result jsonb not null default '[]'::jsonb,
  sku_count integer not null default 0,
  primary key (user_id, product_id)
);
create index if not exists marketplace_product_sales_cache_fetched_idx
  on public.marketplace_product_sales_cache(user_id, fetched_at desc);
alter table public.marketplace_product_sales_cache enable row level security;
revoke all on public.marketplace_product_sales_cache from anon, authenticated;

create table if not exists public.marketplace_sku_sales_observations (
  user_id uuid not null,
  product_id text not null,
  sku_id text not null,
  captured_at timestamptz not null default now(),
  captured_hour timestamptz not null default date_trunc('hour', now()),
  condition text,
  language text,
  finish text,
  printing text,
  average_daily_quantity_sold numeric,
  average_daily_transaction_count numeric,
  quarter_quantity_sold numeric,
  quarter_transaction_count numeric,
  source text not null default 'tcgplayer_infinite_detailed_quarter',
  raw_json jsonb not null default '{}'::jsonb,
  primary key (user_id, product_id, sku_id, captured_hour)
);
create index if not exists marketplace_sku_sales_observations_sku_time_idx
  on public.marketplace_sku_sales_observations(user_id, sku_id, captured_at desc);
create index if not exists marketplace_sku_sales_observations_product_time_idx
  on public.marketplace_sku_sales_observations(user_id, product_id, captured_at desc);
alter table public.marketplace_sku_sales_observations enable row level security;

drop policy if exists "Users read own marketplace sales observations" on public.marketplace_sku_sales_observations;
create policy "Users read own marketplace sales observations"
  on public.marketplace_sku_sales_observations for select to authenticated
  using ((select auth.uid()) = user_id);
grant select on public.marketplace_sku_sales_observations to authenticated;
revoke insert, update, delete on public.marketplace_sku_sales_observations from authenticated;
revoke all on public.marketplace_sku_sales_observations from anon;

create or replace view public.marketplace_sales_watch_products
with (security_invoker=true) as
with recent_signal_cards as (
  select m.user_id,
         lower(coalesce(base.name,m.card_name)) as card_key,
         min(i.observed_at) as signal_first_at,
         max(i.observed_at) as signal_last_at,
         count(distinct i.intel_id)::integer as mention_count
  from public.market_intel_card_mentions m
  join public.market_intel_items i on i.intel_id=m.intel_id and i.user_id=m.user_id
  left join public.mtgjson_cards base on base.scryfall_id=m.scryfall_id
  where i.observed_at>=now()-interval '30 days'
  group by m.user_id,lower(coalesce(base.name,m.card_name))
), signal_products as (
  select s.user_id,p.product_id,max(c.name) as product_name,'signal'::text as reason,
         (110 + least(24,max(s.mention_count)*3)
          + case when max(s.signal_last_at)>=now()-interval '24 hours' then 24
                 when max(s.signal_last_at)>=now()-interval '72 hours' then 16
                 when max(s.signal_last_at)>=now()-interval '7 days' then 8 else 0 end)::numeric as priority_score,
         case when max(s.signal_last_at)>=now()-interval '72 hours' then 3
              when max(s.signal_last_at)>=now()-interval '14 days' then 6 else 12 end::integer as ttl_hours,
         min(s.signal_first_at) as signal_first_at,max(s.signal_last_at) as signal_last_at
  from recent_signal_cards s
  join public.mtgjson_cards c on lower(c.name)=s.card_key
  cross join lateral (values(c.tcgplayer_product_id),(c.tcgplayer_etched_product_id),(c.tcgplayer_alt_foil_product_id)) p(product_id)
  where p.product_id is not null
  group by s.user_id,p.product_id
), scout_products_raw as (
  select o.user_id,o.product_id,max(o.product_name) as product_name,
         max(o.base_score_latest)::integer as current_score,
         max(coalesce(o.structural_score_latest,o.base_score_latest)) as structural_score,
         max(o.sku_market_price) as market_price,max(o.direct_low) as direct_low,
         min(o.direct_available) as direct_available,
         max(coalesce(o.raw_demand_adjustment_latest,0)) as demand_adjustment,
         max(o.raw_demand_signal_latest) as demand_signal,
         max(coalesce(o.raw_demand_signal_score_latest,0)) as demand_signal_score
  from public.scout_opportunities_24h o
  where o.product_id is not null
  group by o.user_id,o.product_id
), scout_products as (
  select s.user_id,s.product_id,s.product_name,'scout'::text as reason,
         (greatest(s.current_score,s.structural_score)
          + case when s.market_price>=2 then 20 else 0 end
          + least(20,greatest(0,case when s.market_price>0 then ((s.direct_low-s.market_price)/s.market_price)*20 else 0 end))
          + case when s.direct_available<=5 then 12 when s.direct_available<=10 then 8 when s.direct_available<=20 then 3 else 0 end
          + greatest(0,s.demand_adjustment)*4
          + case when s.demand_signal_score>=70 or lower(coalesce(s.demand_signal,'')) like '%surg%' then 25 else 0 end)::numeric as priority_score,
         case when greatest(s.current_score,s.structural_score)>=75 or s.demand_adjustment>=5 or s.demand_signal_score>=70 then 6 else 24 end::integer as ttl_hours,
         null::timestamptz as signal_first_at,null::timestamptz as signal_last_at
  from scout_products_raw s
  where (s.market_price>=2 or s.demand_adjustment>=5 or s.demand_signal_score>=70 or lower(coalesce(s.demand_signal,'')) like '%surg%')
    and (greatest(s.current_score,s.structural_score)>=35 or s.demand_adjustment>0 or s.demand_signal_score>=60)
), combined as (
  select * from signal_products
  union all
  select * from scout_products
)
select user_id,product_id,max(product_name) as product_name,array_agg(distinct reason) as watch_reasons,
       max(priority_score) as priority_score,min(ttl_hours) as ttl_hours,
       min(signal_first_at) as signal_first_at,max(signal_last_at) as signal_last_at
from combined group by user_id,product_id;
revoke all on public.marketplace_sales_watch_products from anon;
grant select on public.marketplace_sales_watch_products to authenticated,service_role;

create or replace function public.get_marketplace_sales_collection_candidates(p_limit integer default 200)
returns table(user_id uuid,product_id text,product_name text,priority_score numeric,ttl_hours integer,watch_reasons text[],cached_at timestamptz,signal_first_at timestamptz,signal_last_at timestamptz)
language sql security definer set search_path=public as $function$
  select w.user_id,w.product_id,w.product_name,
         (w.priority_score + case when c.fetched_at is null then 30 else least(18,greatest(0,extract(epoch from (now()-c.fetched_at))/3600/2)) end)::numeric,
         w.ttl_hours,w.watch_reasons,c.fetched_at,w.signal_first_at,w.signal_last_at
  from public.marketplace_sales_watch_products w
  left join public.marketplace_product_sales_cache c on c.user_id=w.user_id and c.product_id=w.product_id
  where c.fetched_at is null or c.fetched_at < now()-make_interval(hours=>w.ttl_hours)
  order by 4 desc,coalesce(w.signal_last_at,'epoch'::timestamptz) desc,w.product_id
  limit greatest(1,least(coalesce(p_limit,200),1000));
$function$;
revoke all on function public.get_marketplace_sales_collection_candidates(integer) from public,anon,authenticated;
grant execute on function public.get_marketplace_sales_collection_candidates(integer) to service_role;

create or replace function public.apply_marketplace_sales_history(p_user_id uuid,p_product_id text,p_result jsonb,p_source text default 'shared_sales_worker')
returns integer language plpgsql security definer set search_path=public as $function$
declare n integer:=0; v_now timestamptz:=now(); v_hour timestamptz:=date_trunc('hour',now());
begin
  insert into public.marketplace_product_sales_cache(user_id,product_id,fetched_at,source,raw_result,sku_count)
  values(p_user_id,p_product_id,v_now,coalesce(nullif(p_source,''),'shared_sales_worker'),coalesce(p_result,'[]'::jsonb),jsonb_array_length(coalesce(p_result,'[]'::jsonb)))
  on conflict(user_id,product_id) do update set fetched_at=excluded.fetched_at,source=excluded.source,raw_result=excluded.raw_result,sku_count=excluded.sku_count;

  insert into public.scout_product_sales_cache(user_id,product_id,fetched_at,source,raw_result,sku_count)
  values(p_user_id,p_product_id,v_now,coalesce(nullif(p_source,''),'shared_sales_worker'),coalesce(p_result,'[]'::jsonb),jsonb_array_length(coalesce(p_result,'[]'::jsonb)))
  on conflict(user_id,product_id) do update set fetched_at=excluded.fetched_at,source=excluded.source,raw_result=excluded.raw_result,sku_count=excluded.sku_count;

  insert into public.marketplace_sku_sales_observations(user_id,product_id,sku_id,captured_at,captured_hour,condition,language,finish,printing,average_daily_quantity_sold,average_daily_transaction_count,quarter_quantity_sold,quarter_transaction_count,source,raw_json)
  select p_user_id,p_product_id,x.j->>'skuId',v_now,v_hour,s.condition,s.language,s.finish,s.printing,
         nullif(x.j->>'averageDailyQuantitySold','')::numeric,nullif(x.j->>'averageDailyTransactionCount','')::numeric,
         nullif(x.j->>'totalQuantitySold','')::numeric,nullif(x.j->>'totalTransactionCount','')::numeric,
         coalesce(nullif(p_source,''),'shared_sales_worker'),x.j
  from jsonb_array_elements(coalesce(p_result,'[]'::jsonb)) x(j)
  left join public.mtgjson_tcgplayer_skus s on s.sku_id=x.j->>'skuId'
  where nullif(x.j->>'skuId','') is not null
  on conflict(user_id,product_id,sku_id,captured_hour) do update set
    captured_at=excluded.captured_at,condition=excluded.condition,language=excluded.language,finish=excluded.finish,printing=excluded.printing,
    average_daily_quantity_sold=excluded.average_daily_quantity_sold,average_daily_transaction_count=excluded.average_daily_transaction_count,
    quarter_quantity_sold=excluded.quarter_quantity_sold,quarter_transaction_count=excluded.quarter_transaction_count,source=excluded.source,raw_json=excluded.raw_json;
  get diagnostics n=row_count;

  update public.marketplace_scan_rows r set avg_daily_qty_sold=coalesce((x.j->>'averageDailyQuantitySold')::numeric,0),
    raw_json=coalesce(r.raw_json,'{}'::jsonb)||jsonb_build_object('avgDailyQtySold',coalesce((x.j->>'averageDailyQuantitySold')::numeric,0),'avgDailyTransactions',coalesce((x.j->>'averageDailyTransactionCount')::numeric,0),'quarterQuantitySold',coalesce((x.j->>'totalQuantitySold')::numeric,0),'quarterTransactions',coalesce((x.j->>'totalTransactionCount')::numeric,0),'salesHistoryAvailable',true,'salesHistoryFetchedAt',v_now,'salesHistorySource',coalesce(nullif(p_source,''),'shared_sales_worker'))
  from jsonb_array_elements(coalesce(p_result,'[]'::jsonb)) x(j)
  join public.marketplace_scans s on s.user_id=p_user_id and s.captured_at>=now()-interval '48 hours'
  where r.user_id=p_user_id and r.scan_id=s.scan_id and r.product_id=p_product_id and r.sku_id=(x.j->>'skuId');
  return n;
end;$function$;
revoke all on function public.apply_marketplace_sales_history(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_marketplace_sales_history(uuid,text,jsonb,text) to service_role;

create or replace function public.apply_scout_sales_cache(p_user_id uuid,p_product_id text,p_result jsonb)
returns integer language sql security definer set search_path=public as $function$
  select public.apply_marketplace_sales_history(p_user_id,p_product_id,p_result,'scout_compat');
$function$;
revoke all on function public.apply_scout_sales_cache(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_scout_sales_cache(uuid,text,jsonb) to service_role;

create or replace view public.marketplace_signal_nm_sales_current with (security_invoker=true) as
with signal_cards as (
  select m.user_id,lower(coalesce(base.name,m.card_name)) as card_key,min(i.observed_at) as signal_first_at,max(i.observed_at) as signal_last_at
  from public.market_intel_card_mentions m
  join public.market_intel_items i on i.intel_id=m.intel_id and i.user_id=m.user_id
  left join public.mtgjson_cards base on base.scryfall_id=m.scryfall_id
  where i.observed_at>=now()-interval '30 days'
  group by m.user_id,lower(coalesce(base.name,m.card_name))
), nm_skus as (
  select distinct sc.user_id,sc.card_key,sc.signal_first_at,sc.signal_last_at,c.name as card_name,c.set_code,s.product_id,s.sku_id,s.finish,s.printing
  from signal_cards sc join public.mtgjson_cards c on lower(c.name)=sc.card_key
  join public.mtgjson_tcgplayer_skus s on s.uuid=c.uuid
  where upper(s.condition)='NEAR MINT' and upper(s.language)='ENGLISH'
), latest as (
  select distinct on (o.user_id,o.sku_id) o.user_id,o.sku_id,o.product_id,o.captured_at,o.average_daily_quantity_sold,o.average_daily_transaction_count,o.quarter_quantity_sold,o.quarter_transaction_count
  from public.marketplace_sku_sales_observations o order by o.user_id,o.sku_id,o.captured_at desc
)
select n.user_id,n.card_name,n.set_code,n.product_id,n.sku_id,n.finish,n.printing,n.signal_first_at,n.signal_last_at,
       l.captured_at as sales_fetched_at,l.average_daily_quantity_sold,l.average_daily_transaction_count,l.quarter_quantity_sold,l.quarter_transaction_count
from nm_skus n left join latest l on l.user_id=n.user_id and l.sku_id=n.sku_id;
grant select on public.marketplace_signal_nm_sales_current to authenticated,service_role;
revoke all on public.marketplace_signal_nm_sales_current from anon;
