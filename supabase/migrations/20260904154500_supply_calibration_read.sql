create or replace function public.ask_collectish_supply_calibration_v1(p_event_type text default null)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
with base as (
  select * from public.market_supply_event_outcomes
  where p_event_type is null or event_type=upper(p_event_type)
), stats as (
  select count(*)::int total_events,
    count(*) filter(where horizon_6h is not null)::int matured_6h,
    count(*) filter(where horizon_24h is not null)::int matured_24h,
    count(*) filter(where horizon_72h is not null)::int matured_72h,
    count(*) filter(where outcome_state like '%PERSISTED%')::int persisted,
    count(*) filter(where outcome_state like '%REVERTED%')::int reverted,
    count(*) filter(where outcome_state like 'FURTHER_COMPRESSED%')::int further_compressed,
    min(event_at) first_event_at,max(event_at) last_event_at
  from base
), by_type as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_type',event_type,'events',n,'matured_24h',m24,'matured_72h',m72,
    'persisted',persisted,'reverted',reverted,'further_compressed',further_compressed
  ) order by event_type),'[]'::jsonb) rows
  from (
    select event_type,count(*)::int n,
      count(*) filter(where horizon_24h is not null)::int m24,
      count(*) filter(where horizon_72h is not null)::int m72,
      count(*) filter(where outcome_state like '%PERSISTED%')::int persisted,
      count(*) filter(where outcome_state like '%REVERTED%')::int reverted,
      count(*) filter(where outcome_state like 'FURTHER_COMPRESSED%')::int further_compressed
    from base group by event_type
  ) q
), recent as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'sku_id',sku_id,'product_id',product_id,'event_at',event_at,'event_type',event_type,
    'significance',significance,'outcome_state',outcome_state,
    'baseline',baseline,'horizon_6h',horizon_6h,'horizon_24h',horizon_24h,'horizon_72h',horizon_72h
  ) order by event_at desc),'[]'::jsonb) rows
  from (select * from base order by event_at desc limit 20) q
)
select case when auth.uid() is null and coalesce(auth.role(),'')<>'service_role'
  then jsonb_build_object('available',false,'error','authentication required')
  else jsonb_build_object(
    'available',true,'version','supply_calibration_v1','event_type_filter',p_event_type,
    'total_events',(select total_events from stats),'matured_6h',(select matured_6h from stats),
    'matured_24h',(select matured_24h from stats),'matured_72h',(select matured_72h from stats),
    'first_event_at',(select first_event_at from stats),'last_event_at',(select last_event_at from stats),
    'readiness',case
      when (select matured_72h from stats)>=30 then 'CALIBRATED_INITIAL'
      when (select matured_24h from stats)>=20 then 'EARLY_SIGNAL'
      when (select total_events from stats)>=5 then 'ACCUMULATING'
      else 'INSUFFICIENT_SAMPLE' end,
    'minimums',jsonb_build_object('early_signal_matured_24h',20,'initial_calibration_matured_72h',30),
    'aggregate',jsonb_build_object('persisted',(select persisted from stats),'reverted',(select reverted from stats),'further_compressed',(select further_compressed from stats)),
    'by_event_type',(select rows from by_type),'recent_events',(select rows from recent),
    'interpretation',case
      when (select matured_72h from stats)>=30 then 'Enough 72-hour outcomes exist for an initial empirical persistence/restock calibration. Continue monitoring confidence by event type.'
      when (select matured_24h from stats)>=20 then 'Enough 24-hour outcomes exist for an early directional read, but 72-hour calibration is still immature.'
      else 'Outcome history is still too small for restock-rate or persistence claims. Treat event labels as deterministic observations only.' end,
    'generated_at',now()
  ) end;
$$;
revoke all on function public.ask_collectish_supply_calibration_v1(text) from public,anon;
grant execute on function public.ask_collectish_supply_calibration_v1(text) to authenticated,service_role;
