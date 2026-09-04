-- Point-in-time Scout replay and corroborated exact-SKU marketplace supply change events.

create or replace function public.ask_collectish_supply_events_v1(
  p_sku_id text,
  p_days integer default 90
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with params as (
  select greatest(1,least(coalesce(p_days,90),365))::int days
), points as (
  select s.*,
    lag(s.observed_at) over(order by s.observed_at,s.snapshot_id) prev_observed_at,
    lag(s.unit_count) over(order by s.observed_at,s.snapshot_id) prev_units,
    lag(s.listing_count) over(order by s.observed_at,s.snapshot_id) prev_listings,
    lag(s.seller_count) over(order by s.observed_at,s.snapshot_id) prev_sellers,
    lag(s.direct_unit_count) over(order by s.observed_at,s.snapshot_id) prev_direct_units,
    lag(s.direct_listing_count) over(order by s.observed_at,s.snapshot_id) prev_direct_listings,
    lag(s.direct_seller_count) over(order by s.observed_at,s.snapshot_id) prev_direct_sellers
  from public.market_supply_snapshots s, params p
  where s.source='tcgplayer_marketplace'
    and s.coverage_state='COMPLETE'
    and s.sku_id=p_sku_id
    and s.observed_at >= now()-make_interval(days=>p.days)-interval '24 hours'
), deltas as (
  select p.*,
    unit_count-prev_units unit_delta,
    listing_count-prev_listings listing_delta,
    seller_count-prev_sellers seller_delta,
    direct_unit_count-prev_direct_units direct_unit_delta,
    direct_listing_count-prev_direct_listings direct_listing_delta,
    direct_seller_count-prev_direct_sellers direct_seller_delta,
    extract(epoch from (observed_at-prev_observed_at))/3600.0 interval_hours,
    case when prev_units>0 then 100.0*(unit_count-prev_units)/prev_units end unit_pct,
    case when prev_listings>0 then 100.0*(listing_count-prev_listings)/prev_listings end listing_pct,
    case when prev_direct_units>0 then 100.0*(direct_unit_count-prev_direct_units)/prev_direct_units end direct_unit_pct
  from points p
  where prev_observed_at is not null
), classified as (
  select d.*,
    case
      when prev_direct_units>=4
       and direct_unit_delta<=-greatest(3,ceil(prev_direct_units*.40)::int)
       and unit_delta<=-greatest(3,ceil(abs(direct_unit_delta)*.25)::int)
        then 'DIRECT_DRAIN'
      when direct_unit_delta>=greatest(5,ceil(greatest(prev_direct_units,1)*.75)::int)
       and unit_delta>=greatest(5,ceil(abs(direct_unit_delta)*.25)::int)
        then 'DIRECT_RESTOCK'
      when prev_units>=12 and (
        unit_delta<=-greatest(6,ceil(prev_units*.35)::int)
        or (prev_listings>=8 and listing_delta<=-greatest(4,ceil(prev_listings*.30)::int))
      ) then 'MARKET_COMPRESSION'
      when (
        unit_delta>=greatest(8,ceil(greatest(prev_units,1)*.50)::int)
        or (prev_listings>=8 and listing_delta>=greatest(5,ceil(prev_listings*.40)::int))
      ) then 'MARKET_RESTOCK'
      else null
    end event_type,
    case
      when (prev_direct_units>0 and direct_unit_count=0 and abs(unit_delta)<=greatest(2,ceil(prev_units*.08)::int))
        or (prev_direct_units=0 and direct_unit_count>=5 and abs(unit_delta)<=greatest(2,ceil(prev_units*.08)::int))
      then true else false end direct_coverage_discontinuity
  from deltas d
), events as (
  select * from classified, params p
  where observed_at>=now()-make_interval(days=>p.days)
    and event_type is not null
    and not direct_coverage_discontinuity
), packed as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_at',observed_at,
    'kind','supply',
    'source','tcgplayer_marketplace',
    'title',case event_type
      when 'DIRECT_DRAIN' then 'Direct supply drained'
      when 'DIRECT_RESTOCK' then 'Direct supply restocked'
      when 'MARKET_COMPRESSION' then 'Market supply compressed'
      else 'Market supply restocked' end,
    'detail',case event_type
      when 'DIRECT_DRAIN' then format('Direct units %s → %s (%s%s); total market units %s → %s.',prev_direct_units,direct_unit_count,case when direct_unit_delta>=0 then '+' else '' end,direct_unit_delta,prev_units,unit_count)
      when 'DIRECT_RESTOCK' then format('Direct units %s → %s (+%s); total market units %s → %s.',prev_direct_units,direct_unit_count,direct_unit_delta,prev_units,unit_count)
      when 'MARKET_COMPRESSION' then format('Market units %s → %s (%s%s); listings %s → %s (%s%s).',prev_units,unit_count,case when unit_delta>=0 then '+' else '' end,unit_delta,prev_listings,listing_count,case when listing_delta>=0 then '+' else '' end,listing_delta)
      else format('Market units %s → %s (+%s); listings %s → %s (%s%s).',prev_units,unit_count,unit_delta,prev_listings,listing_count,case when listing_delta>=0 then '+' else '' end,listing_delta) end,
    'significance',least(100,greatest(
      case when abs(coalesce(unit_pct,0))>=50 then 65 else 45 end,
      case when abs(coalesce(direct_unit_pct,0))>=60 then 70 else 0 end,
      abs(coalesce(unit_delta,0))*2
    )),
    'data',jsonb_build_object(
      'event_type',event_type,
      'previous_observed_at',prev_observed_at,
      'interval_hours',round(interval_hours::numeric,2),
      'units_from',prev_units,'units_to',unit_count,'unit_delta',unit_delta,'unit_change_pct',round(unit_pct::numeric,1),
      'listings_from',prev_listings,'listings_to',listing_count,'listing_delta',listing_delta,'listing_change_pct',round(listing_pct::numeric,1),
      'sellers_from',prev_sellers,'sellers_to',seller_count,'seller_delta',seller_delta,
      'direct_units_from',prev_direct_units,'direct_units_to',direct_unit_count,'direct_unit_delta',direct_unit_delta,'direct_unit_change_pct',round(direct_unit_pct::numeric,1),
      'direct_listings_from',prev_direct_listings,'direct_listings_to',direct_listing_count,'direct_listing_delta',direct_listing_delta,
      'direct_sellers_from',prev_direct_sellers,'direct_sellers_to',direct_seller_count,'direct_seller_delta',direct_seller_delta,
      'coverage_state',coverage_state,'scope','exact_sku','source_table','market_supply_snapshots'
    )
  ) order by observed_at),'[]'::jsonb) rows
  from events
), coverage as (
  select count(*)::int observation_points,
    min(observed_at) first_observed_at,max(observed_at) last_observed_at,
    count(*) filter(where direct_coverage_discontinuity)::int suppressed_direct_discontinuities
  from classified
)
select case
  when auth.uid() is null and coalesce(auth.role(),'')<>'service_role' then jsonb_build_object('available',false,'error','authentication required')
  when coalesce(p_sku_id,'')='' then jsonb_build_object('available',false,'error','sku id required')
  else jsonb_build_object(
    'available',(select observation_points>=2 from coverage),
    'version','supply_events_v1',
    'sku_id',p_sku_id,
    'days',(select days from params),
    'observation_points',(select observation_points from coverage),
    'first_observed_at',(select first_observed_at from coverage),
    'last_observed_at',(select last_observed_at from coverage),
    'suppressed_direct_discontinuities',(select suppressed_direct_discontinuities from coverage),
    'events',(select rows from packed),
    'event_count',jsonb_array_length((select rows from packed)),
    'note','Events require COMPLETE exact-SKU marketplace snapshots. Direct drain/restock labels require corroborating total-market unit movement; Direct-only zero/nonzero classification discontinuities with stable total supply are suppressed.'
  ) end;
$$;
revoke all on function public.ask_collectish_supply_events_v1(text,integer) from public,anon;
grant execute on function public.ask_collectish_supply_events_v1(text,integer) to authenticated,service_role;

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
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  j := public.ask_collectish_market_timeline_v2(p_product_id,p_sku_id,v_days);
  if not coalesce((j->>'available')::boolean,false) then return j; end if;
  s := public.ask_collectish_supply_events_v1(coalesce(j->'card'->>'sku_id',p_sku_id),v_days);
  merged := coalesce(j->'events','[]'::jsonb)||coalesce(s->'events','[]'::jsonb);
  select coalesce(jsonb_agg(e order by (e->>'event_at')::timestamptz,coalesce((e->>'significance')::numeric,0) desc),'[]'::jsonb)
    into filtered
  from jsonb_array_elements(merged) e
  where nullif(e->>'event_at','') is not null
    and (e->>'event_at')::timestamptz>=now()-make_interval(days=>v_days);
  return j||jsonb_build_object(
    'version','v3_universal_evidence_supply',
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
    'window_semantics','event_at_within_requested_horizon'
  );
end;
$$;
revoke all on function public.ask_collectish_market_timeline_v3(text,text,integer) from public,anon;
grant execute on function public.ask_collectish_market_timeline_v3(text,text,integer) to authenticated,service_role;

create or replace function public.ask_collectish_scout_time_machine_v1(
  p_product_id text,
  p_sku_id text,
  p_offset_hours integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_offset integer := greatest(0, least(coalesce(p_offset_hours,0), 24*365));
  v_as_of timestamptz := now() - make_interval(hours => greatest(0, least(coalesce(p_offset_hours,0), 24*365)));
  v_days integer := greatest(7, least(365, ceil((greatest(0, least(coalesce(p_offset_hours,0),24*365)) + 48)::numeric / 24.0)::integer));
  v_timeline jsonb;
  v_decision jsonb;
  v_now_decision jsonb;
  v_events jsonb;
  v_prior_count integer := 0;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if coalesce(nullif(p_sku_id,''), nullif(p_product_id,'')) is null then raise exception 'product or sku required'; end if;

  select to_jsonb(h) - 'user_id' into v_decision
  from public.scout_evaluation_history h
  where h.user_id=v_user and h.sku_id=p_sku_id and h.evaluated_at <= v_as_of
  order by h.evaluated_at desc, h.id desc limit 1;

  select to_jsonb(h) - 'user_id' into v_now_decision
  from public.scout_evaluation_history h
  where h.user_id=v_user and h.sku_id=p_sku_id
  order by h.evaluated_at desc, h.id desc limit 1;

  v_timeline := public.ask_collectish_market_timeline_v3(p_product_id,p_sku_id,v_days);

  select coalesce(jsonb_agg(e order by (e->>'event_at')::timestamptz desc, coalesce((e->>'significance')::numeric,0) desc),'[]'::jsonb), count(*)
    into v_events, v_prior_count
  from (
    select e from jsonb_array_elements(coalesce(v_timeline->'events','[]'::jsonb)) e
    where nullif(e->>'event_at','') is not null
      and (e->>'event_at')::timestamptz <= v_as_of
      and (e->>'event_at')::timestamptz >= v_as_of - interval '48 hours'
    order by (e->>'event_at')::timestamptz desc, coalesce((e->>'significance')::numeric,0) desc
    limit 20
  ) q;

  return jsonb_build_object(
    'available', v_decision is not null,
    'version','scout_time_machine_v1_supply',
    'as_of',v_as_of,
    'offset_hours',v_offset,
    'decision',v_decision,
    'current_decision',v_now_decision,
    'decision_delta',case when v_decision is not null and v_now_decision is not null then jsonb_build_object(
      'score',coalesce((v_decision->>'promoted_score')::integer,0)-coalesce((v_now_decision->>'promoted_score')::integer,0),
      'grade_from',v_now_decision->>'promoted_grade',
      'grade_to',v_decision->>'promoted_grade',
      'same_fingerprint',coalesce(v_decision->>'model_version','')=coalesce(v_now_decision->>'model_version','')
        and coalesce(v_decision->>'promoted_score','')=coalesce(v_now_decision->>'promoted_score','')
        and coalesce(v_decision->>'promoted_grade','')=coalesce(v_now_decision->>'promoted_grade','')
        and coalesce(v_decision->>'flag','')=coalesce(v_now_decision->>'flag','')
    ) else null end,
    'evidence_events',v_events,
    'evidence_event_count',v_prior_count,
    'evidence_window_hours',48,
    'coverage',coalesce(v_timeline->'coverage','{}'::jsonb),
    'card',coalesce(v_timeline->'card','{}'::jsonb),
    'supply_history',coalesce(v_timeline->'supply_history','{}'::jsonb),
    'note',case when v_decision is null then 'No captured Scout evaluation existed at this point in time.' else 'Decision and evidence are restricted to observations at or before as_of; no future evidence is included.' end,
    'generated_at',now()
  );
end;
$$;
revoke all on function public.ask_collectish_scout_time_machine_v1(text,text,integer) from public,anon;
grant execute on function public.ask_collectish_scout_time_machine_v1(text,text,integer) to authenticated,service_role;
