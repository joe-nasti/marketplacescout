-- Forward-test ledger for vetted exact-SKU supply events. Outcomes are populated only when future COMPLETE snapshots exist.

create table if not exists public.market_supply_event_outcomes (
  event_key text primary key,
  sku_id text not null,
  product_id text,
  event_at timestamptz not null,
  event_type text not null,
  significance numeric,
  baseline jsonb not null default '{}'::jsonb,
  horizon_6h jsonb,
  horizon_24h jsonb,
  horizon_72h jsonb,
  outcome_state text not null default 'PENDING',
  model_version text not null default 'supply_outcome_v1',
  detected_at timestamptz not null default now(),
  evaluated_at timestamptz not null default now()
);
create index if not exists market_supply_event_outcomes_sku_time_idx on public.market_supply_event_outcomes(sku_id,event_at desc);
create index if not exists market_supply_event_outcomes_state_time_idx on public.market_supply_event_outcomes(outcome_state,event_at desc);
alter table public.market_supply_event_outcomes enable row level security;
revoke all on public.market_supply_event_outcomes from public,anon,authenticated;
grant select,insert,update on public.market_supply_event_outcomes to service_role;

create or replace function public.refresh_market_supply_event_outcomes_v1(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_days integer:=greatest(2,least(coalesce(p_days,30),90));
  v_sku text;
  v_payload jsonb;
  v_event jsonb;
  v_event_at timestamptz;
  v_type text;
  v_key text;
  v_product text;
  v_h6 jsonb;
  v_h24 jsonb;
  v_h72 jsonb;
  v_state text;
  v_updated integer:=0;
  v_events integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required'; end if;

  for v_sku in
    select distinct s.sku_id
    from public.market_supply_snapshots s
    where s.source='tcgplayer_marketplace'
      and s.coverage_state='COMPLETE'
      and s.observed_at>=now()-make_interval(days=>v_days)
      and (s.metadata->>'family_scope'='SCOUT_SUPPLY_MONITOR' or exists(
        select 1 from public.scout_opportunities_v5_cache c where c.sku_id=s.sku_id and coalesce(c.promoted_score,c.opportunity_score,0)>=70
      ))
  loop
    v_payload:=public.ask_collectish_supply_events_v1(v_sku,v_days);
    for v_event in select value from jsonb_array_elements(coalesce(v_payload->'events','[]'::jsonb))
    loop
      v_events:=v_events+1;
      v_event_at:=(v_event->>'event_at')::timestamptz;
      v_type:=v_event->'data'->>'event_type';
      v_key:=md5(v_sku||'|'||v_event_at::text||'|'||coalesce(v_type,''));
      select product_id into v_product from public.market_supply_snapshots
       where sku_id=v_sku and source='tcgplayer_marketplace' and observed_at=v_event_at
       order by snapshot_id desc limit 1;

      select to_jsonb(x) into v_h6 from (
        select observed_at,unit_count,listing_count,seller_count,direct_unit_count,direct_listing_count,direct_seller_count,
          unit_count-(v_event->'data'->>'units_to')::int unit_delta_from_event,
          direct_unit_count-(v_event->'data'->>'direct_units_to')::int direct_unit_delta_from_event
        from public.market_supply_snapshots
        where sku_id=v_sku and source='tcgplayer_marketplace' and coverage_state='COMPLETE'
          and observed_at>=v_event_at+interval '6 hours' and observed_at<=v_event_at+interval '14 hours'
        order by observed_at limit 1
      ) x;
      select to_jsonb(x) into v_h24 from (
        select observed_at,unit_count,listing_count,seller_count,direct_unit_count,direct_listing_count,direct_seller_count,
          unit_count-(v_event->'data'->>'units_to')::int unit_delta_from_event,
          direct_unit_count-(v_event->'data'->>'direct_units_to')::int direct_unit_delta_from_event
        from public.market_supply_snapshots
        where sku_id=v_sku and source='tcgplayer_marketplace' and coverage_state='COMPLETE'
          and observed_at>=v_event_at+interval '24 hours' and observed_at<=v_event_at+interval '32 hours'
        order by observed_at limit 1
      ) x;
      select to_jsonb(x) into v_h72 from (
        select observed_at,unit_count,listing_count,seller_count,direct_unit_count,direct_listing_count,direct_seller_count,
          unit_count-(v_event->'data'->>'units_to')::int unit_delta_from_event,
          direct_unit_count-(v_event->'data'->>'direct_units_to')::int direct_unit_delta_from_event
        from public.market_supply_snapshots
        where sku_id=v_sku and source='tcgplayer_marketplace' and coverage_state='COMPLETE'
          and observed_at>=v_event_at+interval '72 hours' and observed_at<=v_event_at+interval '80 hours'
        order by observed_at limit 1
      ) x;

      v_state:='PENDING';
      if v_h72 is not null then
        if v_type in ('MARKET_COMPRESSION','DIRECT_DRAIN') then
          if (v_h72->>'unit_count')::int >= (v_event->'data'->>'units_from')::int*0.90 then v_state:='REVERTED_72H';
          elsif (v_h72->>'unit_count')::int <= (v_event->'data'->>'units_to')::int*0.90 then v_state:='FURTHER_COMPRESSED_72H';
          else v_state:='PERSISTED_72H'; end if;
        else
          if (v_h72->>'unit_count')::int <= (v_event->'data'->>'units_from')::int*1.10 then v_state:='RESTOCK_REVERTED_72H';
          else v_state:='RESTOCK_PERSISTED_72H'; end if;
        end if;
      elsif v_h24 is not null then
        if v_type in ('MARKET_COMPRESSION','DIRECT_DRAIN') then
          if (v_h24->>'unit_count')::int >= (v_event->'data'->>'units_from')::int*0.90 then v_state:='REVERTED_24H';
          elsif (v_h24->>'unit_count')::int <= (v_event->'data'->>'units_to')::int*0.90 then v_state:='FURTHER_COMPRESSED_24H';
          else v_state:='PERSISTED_24H'; end if;
        else
          if (v_h24->>'unit_count')::int <= (v_event->'data'->>'units_from')::int*1.10 then v_state:='RESTOCK_REVERTED_24H';
          else v_state:='RESTOCK_PERSISTED_24H'; end if;
        end if;
      elsif v_h6 is not null then v_state:='OBSERVED_6H'; end if;

      insert into public.market_supply_event_outcomes(event_key,sku_id,product_id,event_at,event_type,significance,baseline,horizon_6h,horizon_24h,horizon_72h,outcome_state,evaluated_at)
      values(v_key,v_sku,v_product,v_event_at,v_type,(v_event->>'significance')::numeric,coalesce(v_event->'data','{}'::jsonb),v_h6,v_h24,v_h72,v_state,now())
      on conflict(event_key) do update set
        significance=excluded.significance,baseline=excluded.baseline,horizon_6h=coalesce(excluded.horizon_6h,market_supply_event_outcomes.horizon_6h),
        horizon_24h=coalesce(excluded.horizon_24h,market_supply_event_outcomes.horizon_24h),horizon_72h=coalesce(excluded.horizon_72h,market_supply_event_outcomes.horizon_72h),
        outcome_state=case when excluded.outcome_state<>'PENDING' then excluded.outcome_state else market_supply_event_outcomes.outcome_state end,evaluated_at=now();
      if found then v_updated:=v_updated+1; end if;
    end loop;
  end loop;

  return jsonb_build_object('version','supply_outcome_v1','days',v_days,'events_seen',v_events,'rows_touched',v_updated,
    'outcomes',(select jsonb_object_agg(outcome_state,n) from (select outcome_state,count(*) n from public.market_supply_event_outcomes group by outcome_state) q),
    'generated_at',now());
end;
$$;
revoke all on function public.refresh_market_supply_event_outcomes_v1(integer) from public,anon,authenticated;
grant execute on function public.refresh_market_supply_event_outcomes_v1(integer) to service_role;

insert into public.data_preservation_registry(table_name,data_class,preservation_tier,minimum_granularity,future_features,authoritative_source,can_rebuild,destructive_change_blocked,notes,reviewed_at)
values('market_supply_event_outcomes','derived_history','PRESERVE_DERIVED','One vetted exact-SKU supply event with forward outcome horizons',array['Historical Direct restock behavior','Supply shock calibration','Opportunity outcome attribution']::text[],false,true,true,'Derived forward-test ledger from protected market_supply_snapshots; records only observed future horizons, never inferred future states.',now())
on conflict(table_name) do update set preservation_tier='PRESERVE_DERIVED',destructive_change_blocked=true,reviewed_at=now();

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='market-supply-outcomes-6h' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
end$$;
select cron.schedule(
  'market-supply-outcomes-6h',
  '35 */6 * * *',
  $cron$
    select set_config('request.jwt.claim.role','service_role',true);
    select public.refresh_market_supply_event_outcomes_v1(30);
  $cron$
);
