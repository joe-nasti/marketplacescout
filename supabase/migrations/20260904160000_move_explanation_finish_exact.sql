-- Tighten CK timeline context to the exact finish and expose conservative repricing-context reconstruction.

create or replace function public.ask_collectish_market_timeline_v3(
  p_product_id text,
  p_sku_id text,
  p_days integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j jsonb;
  s jsonb;
  merged jsonb;
  filtered jsonb;
  v_days integer := greatest(7,least(coalesce(p_days,120),365));
  v_printing text;
  v_finish text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  j := public.ask_collectish_market_timeline_v2(p_product_id,p_sku_id,v_days);
  if not coalesce((j->>'available')::boolean,false) then return j; end if;
  v_printing:=lower(coalesce(j->'card'->>'printing',''));
  v_finish:=case
    when v_printing like '%etched%' then 'etched'
    when v_printing like '%foil%' and v_printing not like '%non foil%' and v_printing not like '%nonfoil%' then 'foil'
    else 'nonfoil' end;
  s := public.ask_collectish_supply_events_v1(coalesce(j->'card'->>'sku_id',p_sku_id),v_days);
  merged := coalesce(j->'events','[]'::jsonb)||coalesce(s->'events','[]'::jsonb);
  select coalesce(jsonb_agg(e order by (e->>'event_at')::timestamptz,coalesce((e->>'significance')::numeric,0) desc),'[]'::jsonb)
    into filtered
  from jsonb_array_elements(merged) e
  where nullif(e->>'event_at','') is not null
    and (e->>'event_at')::timestamptz>=now()-make_interval(days=>v_days)
    and not (
      e->>'kind'='vendor_depth'
      and e->>'source'='cardkingdom'
      and nullif(lower(e->'data'->>'finish'),'') is not null
      and lower(e->'data'->>'finish')<>v_finish
    );
  return j||jsonb_build_object(
    'version','v3_universal_evidence_supply_finish_exact',
    'events',filtered,
    'event_count',jsonb_array_length(filtered),
    'coverage',coalesce(j->'coverage','{}'::jsonb)||jsonb_build_object('market_supply_history',coalesce((s->>'available')::boolean,false)),
    'supply_history',jsonb_build_object(
      'observation_points',coalesce((s->>'observation_points')::integer,0),
      'event_count',coalesce((s->>'event_count')::integer,0),
      'suppressed_direct_discontinuities',coalesce((s->>'suppressed_direct_discontinuities')::integer,0),
      'first_observed_at',s->>'first_observed_at',
      'last_observed_at',s->>'last_observed_at'
    ),
    'identity_scope',jsonb_build_object('sku_id',coalesce(j->'card'->>'sku_id',p_sku_id),'finish',v_finish,'ck_finish_filtered',true),
    'window_semantics','event_at_within_requested_horizon'
  );
end;
$$;
revoke all on function public.ask_collectish_market_timeline_v3(text,text,integer) from public,anon;
grant execute on function public.ask_collectish_market_timeline_v3(text,text,integer) to authenticated,service_role;

create or replace function public.ask_collectish_move_explanation_v1(
  p_product_id text,
  p_sku_id text,
  p_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_days integer:=greatest(7,least(coalesce(p_days,30),120));
  j jsonb;
  move jsonb;
  move_at timestamptz;
  before_events jsonb;
  around_events jsonb;
  after_events jsonb;
  before_sources integer:=0;
  around_sources integer:=0;
  before_count integer:=0;
  around_count integer:=0;
  after_count integer:=0;
  context_label text;
  summary text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  j:=public.ask_collectish_market_timeline_v3(p_product_id,p_sku_id,v_days);
  if not coalesce((j->>'available')::boolean,false) then return j||jsonb_build_object('move_explanation_available',false); end if;

  select e into move
  from jsonb_array_elements(coalesce(j->'events','[]'::jsonb)) e
  where e->>'kind'='price'
  order by (e->>'event_at')::timestamptz desc,coalesce((e->>'significance')::numeric,0) desc
  limit 1;

  if move is null then
    return jsonb_build_object(
      'available',false,'version','move_explanation_v1','reason','No material repricing event is stored in the requested window.',
      'days',v_days,'card',j->'card','coverage',j->'coverage','generated_at',now()
    );
  end if;
  move_at:=(move->>'event_at')::timestamptz;

  with ev as (
    select e,(e->>'event_at')::timestamptz at,
      case when e->>'source' in ('tcgplayer','tcgplayer_marketplace') then 'tcgplayer' else coalesce(e->>'source','unknown') end src
    from jsonb_array_elements(coalesce(j->'events','[]'::jsonb)) e
    where nullif(e->>'event_at','') is not null and e<>move
  ), b as (
    select * from ev where at>=move_at-interval '72 hours' and at<move_at-interval '6 hours'
      and e->>'kind' in ('supply','sales','signal','syp','vendor_depth','scout')
    order by at desc,coalesce((e->>'significance')::numeric,0) desc limit 12
  ), a as (
    select * from ev where at>=move_at-interval '6 hours' and at<=move_at+interval '6 hours'
      and e->>'kind' in ('supply','sales','signal','syp','vendor_depth','scout')
    order by abs(extract(epoch from(at-move_at))),coalesce((e->>'significance')::numeric,0) desc limit 12
  ), f as (
    select * from ev where at>move_at+interval '6 hours' and at<=move_at+interval '24 hours'
      and e->>'kind' in ('supply','sales','signal','syp','vendor_depth','scout','price')
    order by at,coalesce((e->>'significance')::numeric,0) desc limit 12
  )
  select
    coalesce((select jsonb_agg(e order by at desc) from b),'[]'::jsonb),
    coalesce((select jsonb_agg(e order by at) from a),'[]'::jsonb),
    coalesce((select jsonb_agg(e order by at) from f),'[]'::jsonb),
    (select count(*) from b),(select count(distinct src) from b),
    (select count(*) from a),(select count(distinct src) from a),
    (select count(*) from f)
  into before_events,around_events,after_events,before_count,before_sources,around_count,around_sources,after_count;

  context_label:=case
    when before_sources+around_sources>=3 and before_count+around_count>=4 then 'MULTI_SOURCE_CONTEXT'
    when before_sources+around_sources>=2 then 'CORROBORATED_CONTEXT'
    when before_count+around_count>=1 then 'SINGLE_SOURCE_CONTEXT'
    else 'NO_STORED_EXPLANATORY_CONTEXT' end;

  summary:=case context_label
    when 'MULTI_SOURCE_CONTEXT' then format('The repricing was preceded or accompanied by %s stored evidence events across multiple sources. This is strong contextual alignment, not proof of causation.',before_count+around_count)
    when 'CORROBORATED_CONTEXT' then format('The repricing had corroborating stored context from at least two source families (%s events). Causation remains unproven.',before_count+around_count)
    when 'SINGLE_SOURCE_CONTEXT' then 'One stored evidence lane aligned with the repricing. That is useful context but too weak to call a cause.'
    else 'Collectish has no stored supply, demand, signal, SYP, vendor-depth, or Scout event near enough to explain this repricing. Treat the move as unexplained from current evidence.' end;

  return jsonb_build_object(
    'available',true,'version','move_explanation_v1','days',v_days,'card',j->'card',
    'move',move,'move_at',move_at,
    'context_label',context_label,'causality','UNPROVEN','summary',summary,
    'evidence_before',before_events,'evidence_around',around_events,'followthrough_after',after_events,
    'counts',jsonb_build_object('before',before_count,'around',around_count,'after',after_count,'before_sources',before_sources,'around_sources',around_sources),
    'windows',jsonb_build_object('before_hours',72,'coincident_hours_each_side',6,'followthrough_hours_after',24),
    'coverage',j->'coverage',
    'method_note','Evidence timing is based on each source event_at. Before/around evidence is contextual; it is not automatically causal. Follow-through evidence occurs after the repricing and must never be used as a cause.',
    'generated_at',now()
  );
end;
$$;
revoke all on function public.ask_collectish_move_explanation_v1(text,text,integer) from public,anon;
grant execute on function public.ask_collectish_move_explanation_v1(text,text,integer) to authenticated,service_role;
