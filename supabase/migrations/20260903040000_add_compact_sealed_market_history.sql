create table if not exists public.sealed_product_market_history (
  product_id bigint not null,
  observed_on date not null,
  sub_type_name text not null default 'Normal',
  market_price numeric,
  low_price numeric,
  direct_low_price numeric,
  source text not null,
  source_granularity text not null default 'daily',
  source_updated_at timestamptz,
  ingested_at timestamptz not null default now(),
  primary key (product_id, sub_type_name, observed_on)
);

alter table public.sealed_product_market_history enable row level security;

drop policy if exists sealed_product_market_history_read on public.sealed_product_market_history;
create policy sealed_product_market_history_read
on public.sealed_product_market_history for select
to authenticated
using (true);

grant select on public.sealed_product_market_history to authenticated;
grant select,insert,update on public.sealed_product_market_history to service_role;

create index if not exists sealed_product_market_history_observed_idx
  on public.sealed_product_market_history (observed_on desc, product_id);

create table if not exists public.sealed_tcgcsv_archive_imports (
  archive_date date primary key,
  status text not null check (status in ('running','complete','missing','failed')),
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  target_products integer not null default 0,
  imported_rows integer not null default 0,
  detail jsonb not null default '{}'::jsonb
);

alter table public.sealed_tcgcsv_archive_imports enable row level security;
grant select,insert,update on public.sealed_tcgcsv_archive_imports to service_role;

create or replace function public.project_current_collector_box_tcgcsv_history()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.sealed_product_market_history (
    product_id,observed_on,sub_type_name,market_price,low_price,direct_low_price,
    source,source_granularity,source_updated_at
  )
  select t.product_id,t.observed_on,t.sub_type_name,t.market_price,t.low_price,
    t.direct_low_price,'tcgcsv_current','daily',t.source_updated_at
  from public.tcgcsv_tcgplayer_prices t
  join public.mtgjson_sealed_products p
    on p.tcgplayer_product_id=t.product_id::text
  where p.category='booster_box' and p.subtype='collector'
    and p.name not ilike '%case%'
  on conflict (product_id,sub_type_name,observed_on) do update set
    market_price=excluded.market_price,
    low_price=excluded.low_price,
    direct_low_price=excluded.direct_low_price,
    source=excluded.source,
    source_granularity=excluded.source_granularity,
    source_updated_at=excluded.source_updated_at,
    ingested_at=now();

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.project_current_collector_box_tcgcsv_history() from public,anon,authenticated;
grant execute on function public.project_current_collector_box_tcgcsv_history() to service_role;

create or replace view public.sealed_product_lifecycle_current
with (security_invoker=true) as
with prices as (
  select p.uuid sealed_uuid,p.tcgplayer_product_id::bigint product_id,p.name,p.set_code,
    p.category,p.subtype,coalesce(p.release_date,sc.released_at) release_date,
    h.observed_on,h.market_price,h.low_price,h.direct_low_price
  from public.mtgjson_sealed_products p
  left join public.magic_set_catalog sc on upper(sc.code)=upper(p.set_code)
  join public.sealed_product_market_history h
    on h.product_id=case when p.tcgplayer_product_id~'^[0-9]+$' then p.tcgplayer_product_id::bigint end
    and h.sub_type_name='Normal'
  where p.category='booster_box' and p.subtype='collector'
    and p.tcgplayer_product_id~'^[0-9]+$' and h.market_price>0
), rollup as (
  select p.sealed_uuid,p.product_id,p.name,p.set_code,p.category,p.subtype,p.release_date,
    min(p.observed_on) history_start,max(p.observed_on) history_end,count(*) observation_count,
    (array_agg(p.market_price order by p.observed_on))[1] market_history_start,
    (array_agg(p.market_price order by p.observed_on desc))[1] market_current,
    (array_agg(p.low_price order by p.observed_on desc) filter(where p.low_price>0))[1] low_current,
    (array_agg(p.direct_low_price order by p.observed_on desc) filter(where p.direct_low_price>0))[1] direct_low_current,
    (array_agg(p.market_price order by p.observed_on)
      filter(where p.observed_on>=current_date-30))[1] market_30d_start,
    (array_agg(p.market_price order by p.observed_on)
      filter(where p.observed_on>=current_date-90))[1] market_90d_start,
    (array_agg(p.market_price order by p.observed_on)
      filter(where p.observed_on>=current_date-365))[1] market_365d_start,
    min(p.market_price) market_history_low,max(p.market_price) market_history_high
  from prices p
  group by p.sealed_uuid,p.product_id,p.name,p.set_code,p.category,p.subtype,p.release_date
)
select r.*,(history_end-history_start+1) history_days,
  greatest(0,current_date-release_date) product_age_days,
  round(100*(market_current/nullif(market_30d_start,0)-1),2) change_30d_pct,
  round(100*(market_current/nullif(market_90d_start,0)-1),2) change_90d_pct,
  round(100*(market_current/nullif(market_365d_start,0)-1),2) change_365d_pct,
  round(100*(market_current/nullif(market_history_low,0)-1),2) above_history_low_pct,
  round(100*(market_history_high/nullif(market_current,0)-1),2) below_history_high_pct
from rollup r;

grant select on public.sealed_product_lifecycle_current to authenticated,service_role;

drop view if exists public.sealed_product_trajectory_analogs_current;
create or replace view public.sealed_product_trajectory_analogs_current
with (security_invoker=true) as
with users as (
  select distinct user_id from public.sealed_set_profiles where enabled
), sales as (
  select b.user_id,b.product_id,
    sum(coalesce(b.quantity_sold,0)) filter(where b.bucket_start_date>=current_date-30) units_30d,
    sum(coalesce(b.quantity_sold,0)) filter(where b.bucket_start_date>=current_date-90) units_90d
  from public.marketplace_sku_sales_buckets b
  group by b.user_id,b.product_id
), pairs as (
  select u.user_id,t.sealed_uuid target_sealed_uuid,a.sealed_uuid analog_sealed_uuid,
    a.release_date analog_release_date,a.product_age_days analog_age_days,
    a.market_current analog_market_price,a.change_30d_pct analog_change_30d_pct,
    a.change_90d_pct analog_change_90d_pct,a.change_365d_pct analog_change_365d_pct,
    round(coalesce(sa.units_30d,0)/30.0,3) analog_units_per_day_30d,
    a.history_days analog_history_days,a.observation_count analog_observations,
    round(greatest(0,100
      -coalesce(abs(t.change_30d_pct-a.change_30d_pct),35)*.55
      -coalesce(abs(t.change_90d_pct-a.change_90d_pct),45)*.30
      -coalesce(abs(t.change_365d_pct-a.change_365d_pct),70)*.10
      -abs(ln(greatest(t.market_current,1)/greatest(a.market_current,1)))*8
      -abs(ln((greatest(coalesce(st.units_30d,0)/30.0,0)+.05)/
              (greatest(coalesce(sa.units_30d,0)/30.0,0)+.05)))*7
    ),1) similarity_score
  from users u
  join public.sealed_product_lifecycle_current t on true
  join public.sealed_product_lifecycle_current a
    on a.sealed_uuid<>t.sealed_uuid and a.category=t.category and a.subtype=t.subtype
    and a.release_date<=t.release_date-180
  left join sales st on st.user_id=u.user_id and st.product_id=t.product_id::text
  left join sales sa on sa.user_id=u.user_id and sa.product_id=a.product_id::text
  where t.observation_count>=4 and a.observation_count>=4
), ranked as (
  select p.*,row_number() over(partition by user_id,target_sealed_uuid
    order by similarity_score desc,analog_history_days desc) analog_rank
  from pairs p
)
select r.*,p.name analog_product_name,p.set_code analog_set_code,
  case when r.analog_history_days>=365 and r.analog_observations>=40 then 'HIGH'
       when r.analog_history_days>=180 and r.analog_observations>=20 then 'MEDIUM'
       else 'LOW' end analog_confidence,
  'Shape match uses TCGCSV 30/90/365-day market-price momentum, price scale, and recent TCGplayer items sold. It is descriptive, not a forecast.'::text analog_caveat
from ranked r
join public.mtgjson_sealed_products p on p.uuid=r.analog_sealed_uuid
where r.analog_rank<=3;

grant select on public.sealed_product_trajectory_analogs_current to authenticated,service_role;

select public.project_current_collector_box_tcgcsv_history();
