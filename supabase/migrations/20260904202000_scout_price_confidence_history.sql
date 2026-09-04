create table if not exists public.scout_price_confidence_history (
  id bigserial primary key,
  user_id uuid not null,
  sku_id text not null,
  product_id text,
  source_evaluation_id bigint references public.scout_evaluation_history(id) on delete set null,
  evaluated_at timestamptz not null,
  captured_at timestamptz not null default now(),
  capture_kind text not null default 'EVALUATION_CHANGE',
  model_version text not null default 'price_microstructure_v1',
  confidence_score integer not null,
  confidence_label text not null,
  microstructure text not null,
  components jsonb not null default '{}'::jsonb,
  price jsonb not null default '{}'::jsonb,
  depth jsonb not null default '{}'::jsonb,
  sales jsonb not null default '{}'::jsonb,
  stability jsonb not null default '{}'::jsonb,
  fragility_flags text[] not null default '{}'::text[],
  coverage jsonb not null default '{}'::jsonb,
  state_hash text not null,
  unique(source_evaluation_id)
);

create index if not exists scout_price_conf_history_user_sku_time_idx on public.scout_price_confidence_history(user_id,sku_id,evaluated_at desc);
create index if not exists scout_price_conf_history_micro_time_idx on public.scout_price_confidence_history(microstructure,evaluated_at desc);

alter table public.scout_price_confidence_history enable row level security;
revoke all on table public.scout_price_confidence_history from public,anon,authenticated;
grant select,insert on table public.scout_price_confidence_history to service_role;

create or replace function public.scout_price_confidence_from_eval_v1(p_eval_id bigint)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
with e as (
  select * from public.scout_evaluation_history where id=p_eval_id
), price_now as (
  select p.* from public.tcgplayer_official_sku_price_history p,e
  where p.sku_id=e.sku_id and p.observed_at<=e.evaluated_at
  order by p.observed_at desc limit 1
), supply as (
  select s.* from public.market_supply_snapshots s,e
  where s.source='tcgplayer_marketplace' and s.sku_id=e.sku_id and s.observed_at<=e.evaluated_at
  order by s.observed_at desc,s.snapshot_id desc limit 1
), price24 as (
  select count(*)::int observations,
    min(p.market_price) filter(where p.market_price>0) market_min,
    max(p.market_price) filter(where p.market_price>0) market_max
  from public.tcgplayer_official_sku_price_history p,e
  where p.sku_id=e.sku_id and p.observed_at between e.evaluated_at-interval '24 hours' and e.evaluated_at
), price7 as (
  select count(*)::int observations,
    min(p.market_price) filter(where p.market_price>0) market_min,
    max(p.market_price) filter(where p.market_price>0) market_max
  from public.tcgplayer_official_sku_price_history p,e
  where p.sku_id=e.sku_id and p.observed_at between e.evaluated_at-interval '7 days' and e.evaluated_at
), sales_cov as (
  select max(b.bucket_start_date) latest_bucket_date,max(b.observed_at) latest_bucket_observed_at
  from public.marketplace_sku_sales_buckets b,e
  where b.user_id=e.user_id and b.sku_id=e.sku_id and b.bucket_start_date<=e.evaluated_at::date and b.observed_at<=e.evaluated_at
), sales7 as (
  select coalesce(sum(b.quantity_sold),0)::numeric quantity_sold,coalesce(sum(b.transaction_count),0)::numeric transaction_count,
    min(b.low_sale_price_with_shipping) filter(where b.low_sale_price_with_shipping>0) low_sale,
    max(b.high_sale_price_with_shipping) filter(where b.high_sale_price_with_shipping>0) high_sale
  from public.marketplace_sku_sales_buckets b,e
  where b.user_id=e.user_id and b.sku_id=e.sku_id
    and b.bucket_start_date between e.evaluated_at::date-6 and e.evaluated_at::date
    and b.observed_at<=e.evaluated_at
), base as (
  select e.*,p.observed_at price_observed_at,p.market_price official_market,p.direct_low_price official_direct,p.low_price official_low,
    s.observed_at supply_observed_at,s.coverage_state supply_coverage,s.unit_count market_units,s.listing_count market_listings,s.seller_count market_sellers,
    s.direct_unit_count market_direct_units,s.direct_listing_count market_direct_listings,s.direct_seller_count market_direct_sellers,
    s.lowest_price_with_shipping market_landed_floor,
    p24.observations price_obs_24h,p24.market_min market_min_24h,p24.market_max market_max_24h,
    p7.observations price_obs_7d,p7.market_min market_min_7d,p7.market_max market_max_7d,
    sc.latest_bucket_date,sc.latest_bucket_observed_at,sa.quantity_sold sales_7d,sa.transaction_count transactions_7d,sa.low_sale low_sale_7d,sa.high_sale high_sale_7d
  from e left join price_now p on true left join supply s on true left join price24 p24 on true left join price7 p7 on true left join sales_cov sc on true left join sales7 sa on true
), metrics as (
  select b.*,
    extract(epoch from(evaluated_at-price_observed_at))/3600.0 price_age_hours,
    extract(epoch from(evaluated_at-supply_observed_at))/3600.0 supply_age_hours,
    (latest_bucket_date>=evaluated_at::date-6) fresh_sales_bucket,
    case when official_market>0 and market_landed_floor>0 then round(100*abs(market_landed_floor-official_market)/official_market,1) end floor_gap_pct,
    case when official_market>0 and official_direct>0 then round(100*abs(official_direct-official_market)/official_market,1) end direct_market_gap_pct,
    case when market_min_24h>0 then round(100*(market_max_24h-market_min_24h)/market_min_24h,1) end market_range_24h_pct,
    case when market_min_7d>0 then round(100*(market_max_7d-market_min_7d)/market_min_7d,1) end market_range_7d_pct,
    case when coalesce(avg_daily_qty_sold,0)>0 and market_units is not null then round(market_units/avg_daily_qty_sold,1) end estimated_days_of_supply
  from base b
), scored as (
  select m.*,
    (case when price_age_hours<=2 then 10 when price_age_hours<=12 then 7 when price_age_hours<=24 then 3 else 0 end
     +case when supply_coverage='COMPLETE' and supply_age_hours<=2 then 10 when supply_coverage='COMPLETE' and supply_age_hours<=12 then 7 when supply_coverage='COMPLETE' and supply_age_hours<=24 then 3 else 0 end)::int freshness_points,
    (case when floor_gap_pct is null then 0 when floor_gap_pct<=5 then 10 when floor_gap_pct<=10 then 8 when floor_gap_pct<=20 then 4 else 0 end
     +case when direct_market_gap_pct is null then 0 when direct_market_gap_pct<=5 then 10 when direct_market_gap_pct<=10 then 8 when direct_market_gap_pct<=20 then 4 else 0 end
     +case when official_low>0 and official_market>0 and 100*abs(official_low-official_market)/official_market<=15 then 5 else 0 end)::int agreement_points,
    (case when supply_coverage<>'COMPLETE' or market_units is null then 0 when market_units>=100 then 8 when market_units>=30 then 6 when market_units>=10 then 3 else 1 end
     +case when supply_coverage<>'COMPLETE' or market_sellers is null then 0 when market_sellers>=20 then 7 when market_sellers>=8 then 5 when market_sellers>=3 then 2 else 1 end
     +case when supply_coverage<>'COMPLETE' or market_listings is null then 0 when market_listings>=30 then 5 when market_listings>=10 then 3 when market_listings>=4 then 1 else 0 end
     +case when coalesce(direct_available,0)>=20 then 5 when coalesce(direct_available,0)>=5 then 3 when coalesce(direct_available,0)>0 then 1 else 0 end)::int depth_points,
    (case when coalesce(avg_daily_qty_sold,0)>=2 then 10 when coalesce(avg_daily_qty_sold,0)>=1 then 8 when coalesce(avg_daily_qty_sold,0)>=0.3 then 5 when coalesce(avg_daily_qty_sold,0)>0 then 2 else 0 end
     +case when fresh_sales_bucket and sales_7d>=20 then 7 when fresh_sales_bucket and sales_7d>=8 then 5 when fresh_sales_bucket and sales_7d>=3 then 3 when fresh_sales_bucket and sales_7d>0 then 1 else 0 end
     +case when fresh_sales_bucket and transactions_7d>=10 then 3 when fresh_sales_bucket and transactions_7d>=4 then 2 when fresh_sales_bucket and transactions_7d>0 then 1 else 0 end)::int sales_points,
    case when price_obs_24h>=6 and market_range_24h_pct<=10 then 10 when price_obs_24h>=4 and market_range_24h_pct<=20 then 7 when price_obs_24h>=2 and market_range_24h_pct<=40 then 3 else 0 end::int stability_points
  from metrics m
), final as (
  select s.*,least(100,freshness_points+agreement_points+depth_points+sales_points+stability_points)::int confidence_score from scored s
), flags as (
  select f.*,array_remove(array[
    case when supply_observed_at is null then 'MARKET_DEPTH_UNKNOWN' end,
    case when supply_observed_at is not null and supply_coverage<>'COMPLETE' then 'MARKET_DEPTH_PARTIAL' end,
    case when market_listings is not null and market_listings<=2 then 'VERY_FEW_MARKET_LISTINGS' end,
    case when market_units is not null and market_units<=5 then 'VERY_LOW_MARKET_UNITS' end,
    case when coalesce(direct_listings,0)<=2 then 'VERY_FEW_DIRECT_LISTINGS' end,
    case when floor_gap_pct>20 then 'MARKET_FLOOR_DISAGREEMENT' end,
    case when direct_market_gap_pct>20 then 'DIRECT_MARKET_DISAGREEMENT' end,
    case when market_range_24h_pct>30 then 'HIGH_24H_PRICE_RANGE' end,
    case when not coalesce(fresh_sales_bucket,false) then 'SALES_BUCKET_STALE_OR_MISSING' end,
    case when coalesce(fresh_sales_bucket,false) and sales_7d=0 and coalesce(avg_daily_qty_sold,0)<=0 then 'NO_RECENT_SALES_SUPPORT' end,
    case when price_age_hours>24 then 'STALE_OFFICIAL_PRICE' end,
    case when supply_age_hours>24 then 'STALE_MARKET_DEPTH' end
  ]::text[],null) fragility_flags from final f
)
select case when not exists(select 1 from e) then jsonb_build_object('available',false,'error','evaluation not found') else
  jsonb_build_object(
    'available',true,'user_id',(select user_id from flags),'sku_id',(select sku_id from flags),'product_id',(select product_id from flags),
    'evaluated_at',(select evaluated_at from flags),'source_evaluation_id',p_eval_id,
    'confidence_score',(select confidence_score from flags),
    'confidence_label',(select case when confidence_score>=75 then 'HIGH' when confidence_score>=50 then 'MEDIUM' else 'LOW' end from flags),
    'microstructure',(select case when confidence_score>=75 and cardinality(fragility_flags)=0 then 'ROBUST' when confidence_score>=50 then 'MIXED' else 'FRAGILE' end from flags),
    'components',(select jsonb_build_object('freshness',freshness_points,'agreement',agreement_points,'depth',depth_points,'sales_support',sales_points,'stability',stability_points,'max',100) from flags),
    'price',(select jsonb_build_object('market',official_market,'direct_low',official_direct,'tcg_low',official_low,'listing_floor_with_shipping',market_landed_floor,'floor_gap_pct',floor_gap_pct,'direct_market_gap_pct',direct_market_gap_pct,'observed_at',price_observed_at,'age_hours',round(price_age_hours::numeric,1)) from flags),
    'depth',(select jsonb_build_object('coverage_state',supply_coverage,'observed_at',supply_observed_at,'age_hours',round(supply_age_hours::numeric,1),'market_units',market_units,'market_listings',market_listings,'market_sellers',market_sellers,'direct_units',market_direct_units,'direct_listings',market_direct_listings,'direct_sellers',market_direct_sellers,'scout_direct_available',direct_available,'estimated_days_of_supply',estimated_days_of_supply) from flags),
    'sales',(select jsonb_build_object('avg_daily_qty_sold',avg_daily_qty_sold,'bucket_fresh',coalesce(fresh_sales_bucket,false),'latest_bucket_date',latest_bucket_date,'latest_bucket_observed_at',latest_bucket_observed_at,'copies_7d',case when fresh_sales_bucket then sales_7d end,'transactions_7d',case when fresh_sales_bucket then transactions_7d end,'low_sale_7d',case when fresh_sales_bucket then low_sale_7d end,'high_sale_7d',case when fresh_sales_bucket then high_sale_7d end) from flags),
    'stability',(select jsonb_build_object('observations_24h',price_obs_24h,'market_min_24h',market_min_24h,'market_max_24h',market_max_24h,'market_range_24h_pct',market_range_24h_pct,'observations_7d',price_obs_7d,'market_range_7d_pct',market_range_7d_pct) from flags),
    'fragility_flags',(select to_jsonb(fragility_flags) from flags),
    'coverage',(select jsonb_build_object('price_observed',price_observed_at is not null,'market_depth_observed',supply_observed_at is not null,'market_depth_complete',supply_coverage='COMPLETE','sales_bucket_fresh',coalesce(fresh_sales_bucket,false)) from flags)
  ) end;
$$;
revoke all on function public.scout_price_confidence_from_eval_v1(bigint) from public,anon,authenticated;
grant execute on function public.scout_price_confidence_from_eval_v1(bigint) to service_role;

create or replace function public.capture_scout_price_confidence_history_v1(p_eval_id bigint,p_capture_kind text default 'EVALUATION_CHANGE')
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare j jsonb; h text; prev_h text; new_id bigint;
begin
  j:=public.scout_price_confidence_from_eval_v1(p_eval_id);
  if not coalesce((j->>'available')::boolean,false) then return null; end if;
  h:=md5(concat_ws('|',j->>'microstructure',j->>'confidence_label',((coalesce((j->>'confidence_score')::int,0)/5)*5)::text,coalesce(j->'fragility_flags','[]'::jsonb)::text,coalesce(j->'coverage','{}'::jsonb)::text));
  select state_hash into prev_h from public.scout_price_confidence_history
   where user_id=(j->>'user_id')::uuid and sku_id=j->>'sku_id' order by evaluated_at desc,id desc limit 1;
  if prev_h=h and coalesce(p_capture_kind,'EVALUATION_CHANGE')='EVALUATION_CHANGE' then return null; end if;
  insert into public.scout_price_confidence_history(user_id,sku_id,product_id,source_evaluation_id,evaluated_at,capture_kind,confidence_score,confidence_label,microstructure,components,price,depth,sales,stability,fragility_flags,coverage,state_hash)
  values((j->>'user_id')::uuid,j->>'sku_id',j->>'product_id',p_eval_id,(j->>'evaluated_at')::timestamptz,coalesce(p_capture_kind,'EVALUATION_CHANGE'),(j->>'confidence_score')::int,j->>'confidence_label',j->>'microstructure',j->'components',j->'price',j->'depth',j->'sales',j->'stability',coalesce(array(select jsonb_array_elements_text(j->'fragility_flags')),'{}'::text[]),j->'coverage',h)
  on conflict(source_evaluation_id) do nothing returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.capture_scout_price_confidence_history_v1(bigint,text) from public,anon,authenticated;
grant execute on function public.capture_scout_price_confidence_history_v1(bigint,text) to service_role;

create or replace function public.capture_scout_price_confidence_history_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_actionable boolean;
  prev_actionable boolean := false;
  relevant boolean := false;
begin
  new_actionable := (coalesce(new.flag,'PASS')='HOT' or (new.promoted_grade in ('A','B') and coalesce(new.flag,'PASS')<>'PASS'));
  if not new_actionable then return new; end if;

  select (coalesce(h.flag,'PASS')='HOT' or (h.promoted_grade in ('A','B') and coalesce(h.flag,'PASS')<>'PASS'))
    into prev_actionable
  from public.scout_evaluation_history h
  where h.user_id=new.user_id and h.sku_id=new.sku_id and h.id<>new.id
    and (h.evaluated_at<new.evaluated_at or (h.evaluated_at=new.evaluated_at and h.id<new.id))
  order by h.evaluated_at desc,h.id desc limit 1;

  relevant := coalesce(new.change_reasons,'{}'::text[]) && array['confidence','direct_price','direct_supply','market_price','velocity','source_verification']::text[];

  if not coalesce(prev_actionable,false) or relevant then
    perform public.capture_scout_price_confidence_history_v1(new.id,case when not coalesce(prev_actionable,false) then 'EPISODE_START' else 'EVALUATION_CHANGE' end);
  end if;
  return new;
end;
$$;
revoke all on function public.capture_scout_price_confidence_history_trigger_v1() from public,anon,authenticated;
grant execute on function public.capture_scout_price_confidence_history_trigger_v1() to service_role;

drop trigger if exists scout_price_confidence_history_capture on public.scout_evaluation_history;
create trigger scout_price_confidence_history_capture after insert on public.scout_evaluation_history for each row execute function public.capture_scout_price_confidence_history_trigger_v1();
