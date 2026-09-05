create or replace function public.ask_collectish_scout_outcome_ledger_v1(p_sku_id text default null,p_days integer default 365,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
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
 count(*) filter(where outcome_24h->>'positive_direct_net_spread_survives' is not null) spread_evaluable_24h,
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
 'spread_evaluable_24h',a.spread_evaluable_24h,'spread_survives_24h',a.spread_survives_24h,'spread_survival_rate_24h_pct',case when a.spread_evaluable_24h>0 then round(a.spread_survives_24h*100.0/a.spread_evaluable_24h,1) end,
 'market_up_5pct_24h',a.market_up_5pct_24h,'market_up_5pct_rate_24h_pct',case when a.observed_24h>0 then round(a.market_up_5pct_24h*100.0/a.observed_24h,1) end,
 'supply_expanded_24h',a.supply_expanded_24h,'supply_compressed_24h',a.supply_compressed_24h,'matured_72h',a.matured_72h,'matured_7d',a.matured_7d),
 'readiness',case when a.matured_7d>=30 then 'INITIAL_7D_CALIBRATION' when a.matured_72h>=30 then 'INITIAL_72H_CALIBRATION' when a.observed_24h>=30 then 'EARLY_24H_DIRECTIONAL' else 'INSUFFICIENT_SAMPLE' end,
 'interpretation','Stable episode identity is the original actionable transition evaluation ID. First-seen actionable baselines are excluded. Spread survival is evaluated only when both the entry economics and later Direct observation exist; unknown spread cases are excluded from its denominator. It is not a realized trade, fee recalculation, or guarantee. Missing future observations are unknown, never zero.',
 'episodes',p.episodes,'generated_at',now()) from agg a cross join packed p;
$$;
revoke all on function public.ask_collectish_scout_outcome_ledger_v1(text,integer,integer) from public,anon;
grant execute on function public.ask_collectish_scout_outcome_ledger_v1(text,integer,integer) to authenticated,service_role;