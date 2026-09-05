create table if not exists public.scout_opportunity_outcomes (
  entry_evaluation_id bigint primary key references public.scout_evaluation_history(id) on delete restrict,
  user_id uuid not null,
  sku_id text not null,
  product_id text,
  product_name text,
  opened_at timestamptz not null,
  status text not null default 'OPEN',
  closed_at timestamptz,
  close_evaluation_id bigint references public.scout_evaluation_history(id) on delete set null,
  close_reason text,
  close_reasons text[] not null default '{}'::text[],
  model_version text,
  entry_grade text,
  entry_score integer,
  entry_flag text,
  entry_confidence text,
  entry_market numeric,
  entry_direct_low numeric,
  entry_landed_low numeric,
  entry_buy numeric,
  entry_buy_source text,
  entry_direct_net numeric,
  entry_direct_profit numeric,
  entry_velocity numeric,
  entry_direct_available integer,
  entry_price_confidence jsonb not null default '{}'::jsonb,
  entry_supply jsonb not null default '{}'::jsonb,
  outcome_24h jsonb not null default '{}'::jsonb,
  outcome_72h jsonb not null default '{}'::jsonb,
  outcome_7d jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now()
);

create index if not exists scout_opportunity_outcomes_user_open_idx on public.scout_opportunity_outcomes(user_id,opened_at desc);
create index if not exists scout_opportunity_outcomes_sku_open_idx on public.scout_opportunity_outcomes(sku_id,opened_at desc);
alter table public.scout_opportunity_outcomes enable row level security;
revoke all on table public.scout_opportunity_outcomes from public,anon,authenticated;
grant select,insert,update on table public.scout_opportunity_outcomes to service_role;

create or replace function public.refresh_scout_opportunity_outcomes_v1(p_days integer default 365)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer:=0;
begin
with params as (
  select greatest(7,least(coalesce(p_days,365),3650))::int d
), hist as (
  select h.*,
    (coalesce(h.flag,'PASS')='HOT' or (h.promoted_grade in ('A','B') and coalesce(h.flag,'PASS')<>'PASS')) actionable,
    lag(coalesce(h.flag,'PASS')='HOT' or (h.promoted_grade in ('A','B') and coalesce(h.flag,'PASS')<>'PASS')) over(partition by h.user_id,h.sku_id order by h.evaluated_at,h.id) prev_actionable
  from public.scout_evaluation_history h,params p
  where h.evaluated_at>=now()-make_interval(days=>p.d)
), starts as (
  select * from hist where actionable and prev_actionable=false
), ep as (
  select s.*,c.id close_id,c.evaluated_at closed_at,c.promoted_grade close_grade,c.flag close_flag,c.change_reasons close_reasons
  from starts s
  left join lateral (
    select h.* from hist h where h.user_id=s.user_id and h.sku_id=s.sku_id and h.evaluated_at>s.evaluated_at and not h.actionable order by h.evaluated_at,h.id limit 1
  ) c on true
), enriched as (
  select e.*,
    pc.confidence_score pc_score,pc.confidence_label pc_label,pc.microstructure pc_microstructure,pc.fragility_flags pc_flags,pc.coverage pc_coverage,
    sb.observed_at supply_at,sb.unit_count supply_units,sb.listing_count supply_listings,sb.seller_count supply_sellers,sb.direct_unit_count supply_direct_units,sb.direct_listing_count supply_direct_listings,
    p24.observed_at p24_at,p24.market_price p24_market,p24.direct_low_price p24_direct,p24.lowest_listing_price p24_landed,
    p72.observed_at p72_at,p72.market_price p72_market,p72.direct_low_price p72_direct,p72.lowest_listing_price p72_landed,
    p168.observed_at p168_at,p168.market_price p168_market,p168.direct_low_price p168_direct,p168.lowest_listing_price p168_landed,
    s24.observed_at s24_at,s24.unit_count s24_units,s24.direct_unit_count s24_direct_units,
    s72.observed_at s72_at,s72.unit_count s72_units,s72.direct_unit_count s72_direct_units,
    s168.observed_at s168_at,s168.unit_count s168_units,s168.direct_unit_count s168_direct_units
  from ep e
  left join public.scout_price_confidence_history pc on pc.source_evaluation_id=e.id
  left join lateral (
    select s.* from public.market_supply_snapshots s where s.source='tcgplayer_marketplace' and s.coverage_state='COMPLETE' and s.sku_id=e.sku_id and s.observed_at between e.evaluated_at-interval '2 hours' and e.evaluated_at+interval '2 hours' order by abs(extract(epoch from(s.observed_at-e.evaluated_at))),s.observed_at desc limit 1
  ) sb on true
  left join lateral (select p.* from public.tcgplayer_official_sku_price_history p where p.sku_id=e.sku_id and p.observed_at>=e.evaluated_at+interval '24 hours' and p.observed_at<e.evaluated_at+interval '28 hours' order by p.observed_at limit 1) p24 on true
  left join lateral (select p.* from public.tcgplayer_official_sku_price_history p where p.sku_id=e.sku_id and p.observed_at>=e.evaluated_at+interval '72 hours' and p.observed_at<e.evaluated_at+interval '76 hours' order by p.observed_at limit 1) p72 on true
  left join lateral (select p.* from public.tcgplayer_official_sku_price_history p where p.sku_id=e.sku_id and p.observed_at>=e.evaluated_at+interval '168 hours' and p.observed_at<e.evaluated_at+interval '172 hours' order by p.observed_at limit 1) p168 on true
  left join lateral (select s.* from public.market_supply_snapshots s where s.source='tcgplayer_marketplace' and s.coverage_state='COMPLETE' and s.sku_id=e.sku_id and s.observed_at>=e.evaluated_at+interval '24 hours' and s.observed_at<e.evaluated_at+interval '32 hours' order by s.observed_at limit 1) s24 on true
  left join lateral (select s.* from public.market_supply_snapshots s where s.source='tcgplayer_marketplace' and s.coverage_state='COMPLETE' and s.sku_id=e.sku_id and s.observed_at>=e.evaluated_at+interval '72 hours' and s.observed_at<e.evaluated_at+interval '80 hours' order by s.observed_at limit 1) s72 on true
  left join lateral (select s.* from public.market_supply_snapshots s where s.source='tcgplayer_marketplace' and s.coverage_state='COMPLETE' and s.sku_id=e.sku_id and s.observed_at>=e.evaluated_at+interval '168 hours' and s.observed_at<e.evaluated_at+interval '180 hours' order by s.observed_at limit 1) s168 on true
), shaped as (
  select e.*,
    case when closed_at is null then 'OPEN' else 'CLOSED' end status,
    case when closed_at is null then null when close_flag='PASS' then 'FLAG_PASS' when coalesce(close_grade,'') not in ('A','B') then 'GRADE_LOST' else 'ACTIONABILITY_LOST' end close_reason,
    case when supply_at is null then '{}'::jsonb else jsonb_build_object('observed_at',supply_at,'offset_hours',round((extract(epoch from(supply_at-evaluated_at))/3600.0)::numeric,2),'known_at_entry',supply_at<=evaluated_at,'units',supply_units,'listings',supply_listings,'sellers',supply_sellers,'direct_units',supply_direct_units,'direct_listings',supply_direct_listings) end entry_supply,
    case when pc_score is null then '{}'::jsonb else jsonb_build_object('score',pc_score,'label',pc_label,'microstructure',pc_microstructure,'fragility_flags',pc_flags,'coverage',pc_coverage) end entry_pc,
    case when direct_low>0 and direct_net_est>0 then direct_net_est/direct_low end net_ratio
  from enriched e
), payload as (
  select s.*,
    jsonb_build_object('matured',now()>=evaluated_at+interval '24 hours','observed',p24_at is not null,'target_at',evaluated_at+interval '24 hours','observed_at',p24_at,'market_price',p24_market,'direct_low',p24_direct,'landed_low',p24_landed,
      'market_change_pct',case when sku_market_price>0 and p24_market>0 then round((p24_market/sku_market_price-1)*100,1) end,
      'direct_change_pct',case when direct_low>0 and p24_direct>0 then round((p24_direct/direct_low-1)*100,1) end,
      'estimated_direct_net',case when net_ratio>0 and p24_direct>0 then round((p24_direct*net_ratio)::numeric,2) end,
      'spread_profit_vs_entry_buy',case when net_ratio>0 and p24_direct>0 and cheapest_buy>0 then round((p24_direct*net_ratio-cheapest_buy)::numeric,2) end,
      'spread_roi_pct',case when net_ratio>0 and p24_direct>0 and cheapest_buy>0 then round(((p24_direct*net_ratio-cheapest_buy)/cheapest_buy*100)::numeric,1) end,
      'positive_direct_net_spread_survives',case when net_ratio>0 and p24_direct>0 and cheapest_buy>0 then p24_direct*net_ratio>cheapest_buy end,
      'supply_observed_at',s24_at,'supply_units',s24_units,'direct_units',s24_direct_units,
      'supply_change_pct',case when supply_units>0 and s24_units is not null then round((s24_units::numeric/supply_units-1)*100,1) end,
      'supply_state',case when supply_units>0 and s24_units is not null and s24_units::numeric/supply_units-1>=.20 then 'EXPANDED' when supply_units>0 and s24_units is not null and s24_units::numeric/supply_units-1<=-.20 then 'COMPRESSED' when s24_units is not null then 'STABLE' end) o24,
    jsonb_build_object('matured',now()>=evaluated_at+interval '72 hours','observed',p72_at is not null,'target_at',evaluated_at+interval '72 hours','observed_at',p72_at,'market_price',p72_market,'direct_low',p72_direct,'landed_low',p72_landed,
      'market_change_pct',case when sku_market_price>0 and p72_market>0 then round((p72_market/sku_market_price-1)*100,1) end,
      'estimated_direct_net',case when net_ratio>0 and p72_direct>0 then round((p72_direct*net_ratio)::numeric,2) end,
      'spread_profit_vs_entry_buy',case when net_ratio>0 and p72_direct>0 and cheapest_buy>0 then round((p72_direct*net_ratio-cheapest_buy)::numeric,2) end,
      'spread_roi_pct',case when net_ratio>0 and p72_direct>0 and cheapest_buy>0 then round(((p72_direct*net_ratio-cheapest_buy)/cheapest_buy*100)::numeric,1) end,
      'positive_direct_net_spread_survives',case when net_ratio>0 and p72_direct>0 and cheapest_buy>0 then p72_direct*net_ratio>cheapest_buy end,
      'supply_observed_at',s72_at,'supply_units',s72_units,'direct_units',s72_direct_units,'supply_change_pct',case when supply_units>0 and s72_units is not null then round((s72_units::numeric/supply_units-1)*100,1) end) o72,
    jsonb_build_object('matured',now()>=evaluated_at+interval '168 hours','observed',p168_at is not null,'target_at',evaluated_at+interval '168 hours','observed_at',p168_at,'market_price',p168_market,'direct_low',p168_direct,'landed_low',p168_landed,
      'market_change_pct',case when sku_market_price>0 and p168_market>0 then round((p168_market/sku_market_price-1)*100,1) end,
      'estimated_direct_net',case when net_ratio>0 and p168_direct>0 then round((p168_direct*net_ratio)::numeric,2) end,
      'spread_profit_vs_entry_buy',case when net_ratio>0 and p168_direct>0 and cheapest_buy>0 then round((p168_direct*net_ratio-cheapest_buy)::numeric,2) end,
      'spread_roi_pct',case when net_ratio>0 and p168_direct>0 and cheapest_buy>0 then round(((p168_direct*net_ratio-cheapest_buy)/cheapest_buy*100)::numeric,1) end,
      'positive_direct_net_spread_survives',case when net_ratio>0 and p168_direct>0 and cheapest_buy>0 then p168_direct*net_ratio>cheapest_buy end,
      'supply_observed_at',s168_at,'supply_units',s168_units,'direct_units',s168_direct_units,'supply_change_pct',case when supply_units>0 and s168_units is not null then round((s168_units::numeric/supply_units-1)*100,1) end) o7d
  from shaped s
)
insert into public.scout_opportunity_outcomes(entry_evaluation_id,user_id,sku_id,product_id,product_name,opened_at,status,closed_at,close_evaluation_id,close_reason,close_reasons,model_version,entry_grade,entry_score,entry_flag,entry_confidence,entry_market,entry_direct_low,entry_landed_low,entry_buy,entry_buy_source,entry_direct_net,entry_direct_profit,entry_velocity,entry_direct_available,entry_price_confidence,entry_supply,outcome_24h,outcome_72h,outcome_7d,refreshed_at)
select id,user_id,sku_id,product_id,product_name,evaluated_at,status,closed_at,close_id,close_reason,coalesce(close_reasons,'{}'::text[]),model_version,promoted_grade,promoted_score,flag,confidence_label,sku_market_price,direct_low,low_with_shipping,cheapest_buy,cheapest_source,direct_net_est,direct_net_profit,avg_daily_qty_sold,direct_available,entry_pc,entry_supply,o24,o72,o7d,now()
from payload
on conflict(entry_evaluation_id) do update set status=excluded.status,closed_at=excluded.closed_at,close_evaluation_id=excluded.close_evaluation_id,close_reason=excluded.close_reason,close_reasons=excluded.close_reasons,entry_price_confidence=excluded.entry_price_confidence,entry_supply=excluded.entry_supply,outcome_24h=excluded.outcome_24h,outcome_72h=excluded.outcome_72h,outcome_7d=excluded.outcome_7d,refreshed_at=excluded.refreshed_at;
get diagnostics v_count=row_count;
return v_count;
end;
$$;
revoke all on function public.refresh_scout_opportunity_outcomes_v1(integer) from public,anon,authenticated;
grant execute on function public.refresh_scout_opportunity_outcomes_v1(integer) to service_role;

create or replace function public.ask_collectish_scout_outcome_ledger_v1(p_sku_id text default null,p_days integer default 365,p_limit integer default 100)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
with params as (select greatest(7,least(coalesce(p_days,365),3650))::int d,greatest(1,least(coalesce(p_limit,100),250))::int lim),
filtered as (
 select o.* from public.scout_opportunity_outcomes o,params p
 where auth.uid() is not null and o.user_id=auth.uid() and o.opened_at>=now()-make_interval(days=>p.d) and (p_sku_id is null or o.sku_id=p_sku_id)
), rows as (
 select * from filtered order by opened_at desc limit (select lim from params)
), agg as (
 select count(*) episodes,count(*) filter(where status='OPEN') open_episodes,count(*) filter(where status='CLOSED') closed_episodes,
 count(*) filter(where (outcome_24h->>'matured')::boolean) matured_24h,
 count(*) filter(where (outcome_24h->>'observed')::boolean) observed_24h,
 count(*) filter(where (outcome_24h->>'positive_direct_net_spread_survives')::boolean) spread_survives_24h,
 count(*) filter(where nullif(outcome_24h->>'market_change_pct','')::numeric>=5) market_up_5pct_24h,
 count(*) filter(where outcome_24h->>'supply_state'='EXPANDED') supply_expanded_24h,
 count(*) filter(where outcome_24h->>'supply_state'='COMPRESSED') supply_compressed_24h,
 count(*) filter(where (outcome_72h->>'matured')::boolean) matured_72h,
 count(*) filter(where (outcome_7d->>'matured')::boolean) matured_7d
 from filtered
), packed as (
 select coalesce(jsonb_agg(jsonb_build_object(
  'entry_evaluation_id',entry_evaluation_id,'sku_id',sku_id,'product_id',product_id,'product_name',product_name,'opened_at',opened_at,'status',status,'closed_at',closed_at,'close_reason',close_reason,'close_reasons',close_reasons,
  'entry',jsonb_build_object('grade',entry_grade,'score',entry_score,'flag',entry_flag,'confidence',entry_confidence,'market_price',entry_market,'direct_low',entry_direct_low,'landed_low',entry_landed_low,'buy_price',entry_buy,'buy_source',entry_buy_source,'direct_net',entry_direct_net,'direct_profit',entry_direct_profit,'velocity',entry_velocity,'direct_available',entry_direct_available,'price_confidence',entry_price_confidence,'supply',entry_supply,'model_version',model_version),
  'outcomes',jsonb_build_object('24h',outcome_24h,'72h',outcome_72h,'7d',outcome_7d)
 ) order by opened_at desc),'[]'::jsonb) episodes from rows
)
select jsonb_build_object('available',true,'version','scout_outcome_ledger_v1','days',(select d from params),'summary',jsonb_build_object(
 'episodes',a.episodes,'open',a.open_episodes,'closed',a.closed_episodes,'matured_24h',a.matured_24h,'observed_24h',a.observed_24h,
 'spread_survives_24h',a.spread_survives_24h,'spread_survival_rate_24h_pct',case when a.observed_24h>0 then round(a.spread_survives_24h*100.0/a.observed_24h,1) end,
 'market_up_5pct_24h',a.market_up_5pct_24h,'market_up_5pct_rate_24h_pct',case when a.observed_24h>0 then round(a.market_up_5pct_24h*100.0/a.observed_24h,1) end,
 'supply_expanded_24h',a.supply_expanded_24h,'supply_compressed_24h',a.supply_compressed_24h,'matured_72h',a.matured_72h,'matured_7d',a.matured_7d),
 'readiness',case when a.matured_7d>=30 then 'INITIAL_7D_CALIBRATION' when a.matured_72h>=30 then 'INITIAL_72H_CALIBRATION' when a.observed_24h>=30 then 'EARLY_24H_DIRECTIONAL' else 'INSUFFICIENT_SAMPLE' end,
 'interpretation','Stable episode identity is the original actionable transition evaluation ID. First-seen actionable baselines are excluded. Spread survival means the entry-time Direct net/Direct price ratio applied to the later Direct observation still exceeds the entry buy price; it is not a realized trade, fee recalculation, or guarantee. Missing future observations are unknown, never zero.',
 'episodes',p.episodes,'generated_at',now()) from agg a cross join packed p;
$$;
revoke all on function public.ask_collectish_scout_outcome_ledger_v1(text,integer,integer) from public,anon;
grant execute on function public.ask_collectish_scout_outcome_ledger_v1(text,integer,integer) to authenticated,service_role;

insert into public.data_preservation_registry(table_name,data_class,preservation_tier,minimum_granularity,future_features,authoritative_source,can_rebuild,destructive_change_blocked,notes,reviewed_at)
values('scout_opportunity_outcomes','derived_history','PRESERVE_DERIVED','one row per true observed actionable episode; horizons updated as observations mature',array['Scout outcome calibration','opportunity replay','spread survival analysis','restock and supply outcome analysis','model calibration'],false,true,true,'Stable episode outcome ledger keyed by original Scout entry evaluation ID. Rebuildable from protected evaluation/price/supply histories but preserve until replay/calibration validation is complete.',now())
on conflict(table_name) do update set data_class=excluded.data_class,preservation_tier=excluded.preservation_tier,minimum_granularity=excluded.minimum_granularity,future_features=excluded.future_features,authoritative_source=excluded.authoritative_source,can_rebuild=excluded.can_rebuild,destructive_change_blocked=true,notes=excluded.notes,reviewed_at=now();

do $$ begin
  if not exists(select 1 from cron.job where jobname='scout-opportunity-outcomes-hourly') then
    perform cron.schedule('scout-opportunity-outcomes-hourly','47 * * * *',$cron$select public.refresh_scout_opportunity_outcomes_v1(365);$cron$);
  end if;
end $$;
