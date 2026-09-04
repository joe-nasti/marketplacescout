create or replace function public.ask_collectish_product_timeline_v1(
  p_entity_type text,
  p_product_id text default null,
  p_set_code text default null,
  p_entity_name text default null,
  p_days integer default 30,
  p_limit integer default 100
)
returns table(
  event_at timestamptz,
  observed_at timestamptz,
  ingested_at timestamptz,
  kind text,
  source text,
  event_type text,
  entity_type text,
  entity_name text,
  product_id text,
  set_code text,
  direction text,
  signal_stage text,
  confidence numeric,
  title text,
  summary text,
  evidence text,
  source_url text,
  metric text,
  old_value numeric,
  new_value numeric,
  detail jsonb
)
language sql
security definer
set search_path = public
as $$
with me as (
  select auth.uid() as user_id
), params as (
  select lower(trim(coalesce(p_entity_type,''))) entity_type,
         nullif(trim(p_product_id),'') product_id,
         lower(nullif(trim(p_set_code),'')) set_code,
         nullif(trim(p_entity_name),'') entity_name,
         greatest(1,least(coalesce(p_days,30),3650)) days,
         greatest(1,least(coalesce(p_limit,100),500)) lim
), video_events as (
  select
    coalesce(i.published_at,i.observed_at,i.created_at) event_at,
    i.observed_at,
    i.created_at ingested_at,
    'video_signal'::text kind,
    i.source_name source,
    coalesce(v.event_type,i.source_subtype,'video_signal') event_type,
    e.entity_type,
    e.entity_name,
    e.product_id,
    e.set_code,
    i.direction,
    i.signal_stage,
    least(coalesce(e.confidence,1),coalesce(i.confidence,1)) confidence,
    i.title,
    i.summary,
    v.evidence,
    i.source_url,
    null::text metric,
    null::numeric old_value,
    null::numeric new_value,
    jsonb_strip_nulls(jsonb_build_object(
      'intel_id',i.intel_id,
      'video_id',v.video_id,
      'creator_lane',v.creator_lane,
      'source_profile',i.source_profile,
      'source_subtype',i.source_subtype,
      'start_ms',v.start_ms,
      'end_ms',v.end_ms,
      'prominence',v.prominence,
      'speaker_name',v.speaker_name,
      'speaker_role',v.speaker_role,
      'endorsement_type',v.endorsement_type,
      'transcript_provider',v.transcript_provider,
      'transcript_mode',v.transcript_mode
    )) detail
  from market_intel_entities e
  join market_intel_items i on i.intel_id=e.intel_id and i.user_id=e.user_id
  left join market_intel_video_events v on v.intel_id=i.intel_id and v.user_id=i.user_id
  cross join me
  cross join params p
  where me.user_id is not null
    and e.user_id=me.user_id
    and lower(e.entity_type)=p.entity_type
    and (p.product_id is null or e.product_id=p.product_id)
    and (p.set_code is null or lower(e.set_code)=p.set_code)
    and (p.entity_name is null or lower(e.entity_name)=lower(p.entity_name))
    and coalesce(i.published_at,i.observed_at,i.created_at) >= now() - make_interval(days=>p.days)
), sealed_price as (
  select
    h.captured_at event_at,
    h.captured_at observed_at,
    h.created_at ingested_at,
    'sealed_price'::text kind,
    h.source,
    'price_observation'::text event_type,
    'sealed_product'::text entity_type,
    h.product_name entity_name,
    h.product_id,
    null::text set_code,
    null::text direction,
    null::text signal_stage,
    null::numeric confidence,
    h.product_name title,
    null::text summary,
    null::text evidence,
    null::text source_url,
    'market_price'::text metric,
    null::numeric old_value,
    h.market_price new_value,
    jsonb_strip_nulls(jsonb_build_object(
      'low_price',h.low_price,
      'low_with_shipping',h.low_with_shipping,
      'total_listings',h.total_listings,
      'sealed_uuid',h.sealed_uuid
    )) detail
  from sealed_product_price_history h
  cross join params p
  where p.entity_type='sealed_product'
    and p.product_id is not null
    and h.product_id=p.product_id
    and h.captured_at >= now() - make_interval(days=>p.days)
), all_events as (
  select * from video_events
  union all
  select * from sealed_price
)
select *
from all_events
order by event_at desc, ingested_at desc
limit (select lim from params);
$$;

revoke all on function public.ask_collectish_product_timeline_v1(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.ask_collectish_product_timeline_v1(text,text,text,text,integer,integer) to authenticated;
comment on function public.ask_collectish_product_timeline_v1(text,text,text,text,integer,integer) is 'Historical timeline for sealed products, precons, Secret Lair drops, and sets. Uses source event timestamps separately from observed/ingested timestamps for replay/no-lookahead semantics.';
