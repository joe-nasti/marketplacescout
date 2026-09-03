create or replace function public.ask_delvin_market_changes_v1(p_limit integer default 15)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_latest date;
  v_prev date;
  v_rows jsonb;
  v_limit integer:=greatest(1,least(coalesce(p_limit,15),40));
begin
  select max(observed_date) into v_latest from public.delvin_signal_observations where query_key='market_radar';
  if v_latest is null then return jsonb_build_object('ok',true,'baseline_ready',false,'message','No Delvin radar observations have been captured yet.','rows','[]'::jsonb); end if;
  select max(observed_date) into v_prev from public.delvin_signal_observations where query_key='market_radar' and observed_date<v_latest;
  if v_prev is null then
    return jsonb_build_object('ok',true,'baseline_ready',false,'latest_date',v_latest,'previous_date',null,'message','The first Delvin radar baseline has been captured. A day-over-day change report becomes available after the next observation date.','latest_count',(select count(*) from public.delvin_signal_observations where query_key='market_radar' and observed_date=v_latest),'rows','[]'::jsonb);
  end if;

  with l as (
    select * from public.delvin_signal_observations where query_key='market_radar' and observed_date=v_latest
  ), p as (
    select * from public.delvin_signal_observations where query_key='market_radar' and observed_date=v_prev
  ), paired as (
    select
      coalesce(l.entity_key,p.entity_key) entity_key,
      coalesce(l.sku_id,p.sku_id) sku_id,coalesce(l.product_id,p.product_id) product_id,
      coalesce(l.card_name,p.card_name) card_name,coalesce(l.set_code,p.set_code) set_code,coalesce(l.printing,p.printing) printing,
      l.evidence_tier latest_tier,p.evidence_tier previous_tier,l.source_count latest_sources,p.source_count previous_sources,
      l.signal_score latest_score,p.signal_score previous_score,l.sources latest_source_names,p.sources previous_source_names,
      l.baseline_market latest_market,p.baseline_market previous_market,l.baseline_direct_low latest_direct_low,p.baseline_direct_low previous_direct_low,
      l.baseline_direct_available latest_direct_available,p.baseline_direct_available previous_direct_available,
      l.baseline_sales_day latest_sales_day,p.baseline_sales_day previous_sales_day,
      case when p.entity_key is null then 'new'
           when l.entity_key is null then 'disappeared'
           when (case l.evidence_tier when 'Confirmed' then 4 when 'Converging' then 3 when 'Watch' then 2 else 1 end) > (case p.evidence_tier when 'Confirmed' then 4 when 'Converging' then 3 when 'Watch' then 2 else 1 end)
             or coalesce(l.source_count,0)>coalesce(p.source_count,0)
             or coalesce(l.signal_score,0)>=coalesce(p.signal_score,0)+10 then 'strengthened'
           when (case l.evidence_tier when 'Confirmed' then 4 when 'Converging' then 3 when 'Watch' then 2 else 1 end) < (case p.evidence_tier when 'Confirmed' then 4 when 'Converging' then 3 when 'Watch' then 2 else 1 end)
             or coalesce(l.source_count,0)<coalesce(p.source_count,0)
             or coalesce(l.signal_score,0)<=coalesce(p.signal_score,0)-10 then 'weakened'
           else 'stable' end change_type
    from l full join p using(entity_key)
  ), ranked as (
    select *,case change_type when 'new' then 5 when 'strengthened' then 4 when 'weakened' then 3 when 'disappeared' then 2 else 1 end change_rank
    from paired
    where change_type<>'stable'
    order by change_rank desc,abs(coalesce(latest_score,previous_score,0)-coalesce(previous_score,latest_score,0)) desc,coalesce(latest_score,previous_score) desc nulls last
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'change_type',change_type,'entity_key',entity_key,'sku_id',sku_id,'product_id',product_id,'card_name',card_name,'set_code',set_code,'printing',printing,
    'latest_tier',latest_tier,'previous_tier',previous_tier,'latest_sources',latest_sources,'previous_sources',previous_sources,
    'latest_source_names',latest_source_names,'previous_source_names',previous_source_names,'latest_score',latest_score,'previous_score',previous_score,
    'latest_market',latest_market,'previous_market',previous_market,'latest_direct_low',latest_direct_low,'previous_direct_low',previous_direct_low,
    'latest_direct_available',latest_direct_available,'previous_direct_available',previous_direct_available,'latest_sales_day',latest_sales_day,'previous_sales_day',previous_sales_day
  ) order by change_rank desc,coalesce(latest_score,previous_score) desc nulls last),'[]'::jsonb) into v_rows from ranked;

  return jsonb_build_object('ok',true,'baseline_ready',true,'latest_date',v_latest,'previous_date',v_prev,
    'latest_count',(select count(*) from public.delvin_signal_observations where query_key='market_radar' and observed_date=v_latest),
    'previous_count',(select count(*) from public.delvin_signal_observations where query_key='market_radar' and observed_date=v_prev),
    'rows',v_rows,'generated_at',now());
end;
$$;

create or replace function public.ask_delvin_signal_followthrough_v1(p_limit integer default 15)
returns jsonb
language sql
stable security definer
set search_path=public
as $$
with evaluated as (
  select o.observation_id,o.horizon_days,o.evaluated_at,o.market_change_pct,o.direct_change_pct,o.direct_available_change,o.sales_day_change_pct,o.outcome_label,
         s.observed_date,s.sku_id,s.product_id,s.card_name,s.set_code,s.printing,s.evidence_tier,s.source_count,s.sources,s.signal_score
  from public.delvin_signal_outcomes o join public.delvin_signal_observations s using(observation_id)
  where o.evaluated_at is not null
), recent as (
  select * from evaluated order by evaluated_at desc,signal_score desc nulls last limit greatest(1,least(coalesce(p_limit,15),40))
), stats as (
  select coalesce(jsonb_agg(jsonb_build_object('horizon_days',horizon_days,'outcome_label',outcome_label,'count',n) order by horizon_days,outcome_label),'[]'::jsonb) j
  from (select horizon_days,outcome_label,count(*) n from evaluated group by horizon_days,outcome_label) x
), next_due as (
  select min(due_at) d from public.delvin_signal_outcomes where evaluated_at is null
)
select jsonb_build_object(
  'ok',true,'evaluated_count',(select count(*) from evaluated),'ready',exists(select 1 from evaluated),
  'message',case when exists(select 1 from evaluated) then null else 'No Delvin signal outcome horizon has matured yet. Follow-through begins after the first 1-day evaluations are due.' end,
  'next_due_at',(select d from next_due),'stats',(select j from stats),
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'observation_id',observation_id,'observed_date',observed_date,'horizon_days',horizon_days,'evaluated_at',evaluated_at,'outcome_label',outcome_label,
    'sku_id',sku_id,'product_id',product_id,'card_name',card_name,'set_code',set_code,'printing',printing,'evidence_tier',evidence_tier,'source_count',source_count,'sources',sources,'signal_score',signal_score,
    'market_change_pct',market_change_pct,'direct_change_pct',direct_change_pct,'direct_available_change',direct_available_change,'sales_day_change_pct',sales_day_change_pct
  ) order by evaluated_at desc,signal_score desc nulls last) from recent),'[]'::jsonb),
  'generated_at',now()
);
$$;

revoke all on function public.ask_delvin_market_changes_v1(integer) from public,anon,authenticated;
grant execute on function public.ask_delvin_market_changes_v1(integer) to service_role;
revoke all on function public.ask_delvin_signal_followthrough_v1(integer) from public,anon,authenticated;
grant execute on function public.ask_delvin_signal_followthrough_v1(integer) to service_role;

insert into public.delvin_query_registry(query_key,prompt,category,aliases,ttl_seconds,sort_order,enabled,followups,updated_at)
values
('market_changes','What changed in Delvin since yesterday?','market',array['what changed','changed since yesterday','new since yesterday','delvin changes','what changed today'],300,12,true,'["What should I look at right now?","Which Delvin signals followed through?"]'::jsonb,now()),
('signal_followthrough','Which Delvin signals followed through?','market',array['follow through','followed through','signal outcomes','what worked','delvin outcomes'],900,13,true,'["What changed in Delvin since yesterday?","What should I look at right now?"]'::jsonb,now())
on conflict(query_key) do update set prompt=excluded.prompt,category=excluded.category,aliases=excluded.aliases,ttl_seconds=excluded.ttl_seconds,sort_order=excluded.sort_order,enabled=excluded.enabled,followups=excluded.followups,updated_at=now();
