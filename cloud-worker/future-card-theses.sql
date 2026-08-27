-- Preserve strong creator theses on cards that were unreleased when discussed.
-- These rows are deliberately separate from current Scout opportunities.

create table if not exists public.market_intel_future_card_theses (
  thesis_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  intel_id uuid not null,
  scryfall_id uuid,
  oracle_id uuid,
  card_name text not null,
  set_code text,
  release_date date,
  source_name text,
  source_url text,
  source_title text,
  event_type text,
  conviction_score integer not null default 0,
  evidence text,
  first_captured_at timestamptz not null default now(),
  last_captured_at timestamptz not null default now(),
  retained_until date,
  metadata_json jsonb not null default '{}'::jsonb,
  unique(user_id,intel_id)
);

alter table public.market_intel_future_card_theses enable row level security;
drop policy if exists future_card_theses_select_own on public.market_intel_future_card_theses;
create policy future_card_theses_select_own on public.market_intel_future_card_theses
  for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.market_intel_future_card_theses from public,anon;
grant select on public.market_intel_future_card_theses to authenticated;
grant all on public.market_intel_future_card_theses to service_role;

create or replace function public.refresh_future_card_theses()
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare n integer:=0;
begin
  insert into public.market_intel_future_card_theses(
    user_id,intel_id,scryfall_id,oracle_id,card_name,set_code,release_date,
    source_name,source_url,source_title,event_type,conviction_score,evidence,
    first_captured_at,last_captured_at,retained_until,metadata_json
  )
  select
    i.user_id,i.intel_id,e.scryfall_id,
    coalesce(mc.scryfall_oracle_id,l.oracle_id),e.entity_name,e.set_code,
    coalesce(mc.release_date,(i.metadata_json->>'card_release_date')::date),
    i.source_name,i.source_url,i.title,v.event_type,
    round(v.prominence*100)::integer,v.evidence,
    coalesce(i.published_at,i.observed_at,i.created_at,now()),now(),
    coalesce(mc.release_date,(i.metadata_json->>'card_release_date')::date)+90,
    jsonb_build_object(
      'creator_lane',v.creator_lane,
      'video_id',v.video_id,
      'speaker_name',v.speaker_name,
      'speaker_role',v.speaker_role,
      'endorsement_type',v.endorsement_type,
      'speaker_confidence',v.speaker_confidence,
      'captured_as_unreleased',true
    )
  from public.market_intel_items i
  join public.market_intel_entities e on e.user_id=i.user_id and e.intel_id=i.intel_id and e.entity_type='card'
  join public.market_intel_video_events v on v.user_id=i.user_id and v.intel_id=i.intel_id
  left join public.mtgjson_cards mc on mc.scryfall_id=e.scryfall_id
  left join public.market_intel_scout_signal_links l on l.user_id=i.user_id and l.intel_id=i.intel_id
  where coalesce(mc.release_date,(i.metadata_json->>'card_release_date')::date) > coalesce(i.published_at,i.observed_at,i.created_at,now())::date
  on conflict(user_id,intel_id) do update set
    scryfall_id=excluded.scryfall_id,
    oracle_id=coalesce(excluded.oracle_id,market_intel_future_card_theses.oracle_id),
    card_name=excluded.card_name,
    set_code=coalesce(excluded.set_code,market_intel_future_card_theses.set_code),
    release_date=coalesce(excluded.release_date,market_intel_future_card_theses.release_date),
    source_name=excluded.source_name,
    source_url=excluded.source_url,
    source_title=excluded.source_title,
    event_type=excluded.event_type,
    conviction_score=greatest(market_intel_future_card_theses.conviction_score,excluded.conviction_score),
    evidence=case when excluded.conviction_score>=market_intel_future_card_theses.conviction_score then excluded.evidence else market_intel_future_card_theses.evidence end,
    last_captured_at=now(),
    retained_until=greatest(market_intel_future_card_theses.retained_until,excluded.retained_until),
    metadata_json=market_intel_future_card_theses.metadata_json||excluded.metadata_json;
  get diagnostics n=row_count;
  return n;
end $$;

revoke all on function public.refresh_future_card_theses() from public,anon,authenticated;
grant execute on function public.refresh_future_card_theses() to service_role;

create or replace view public.market_intel_future_card_thesis_rollups
with (security_invoker=true)
as
select
  user_id,
  coalesce(oracle_id,scryfall_id) as card_key,
  max(card_name) as card_name,
  max(set_code) as set_code,
  min(release_date) as release_date,
  min(first_captured_at) as first_captured_at,
  max(last_captured_at) as last_captured_at,
  max(retained_until) as retained_until,
  max(conviction_score) as strongest_conviction_score,
  count(*)::integer as thesis_count,
  count(distinct lower(coalesce(source_name,'')))::integer as independent_creator_count,
  array_agg(distinct source_name) filter(where source_name is not null) as sources,
  (array_agg(event_type order by conviction_score desc,first_captured_at asc))[1] as strongest_event_type,
  (array_agg(evidence order by conviction_score desc,first_captured_at asc))[1] as strongest_evidence,
  case
    when min(release_date) is null then 'release_unknown'
    when current_date < min(release_date) then 'unreleased_deferred'
    when current_date <= min(release_date)+14 then 'release_window'
    when current_date <= max(retained_until) then 'post_release_retained'
    else 'archived'
  end as lifecycle_state,
  case
    when min(release_date) is null then false
    when current_date < min(release_date) then false
    when current_date <= max(retained_until) then true
    else false
  end as resurfaced_for_action
from public.market_intel_future_card_theses
group by user_id,coalesce(oracle_id,scryfall_id);

revoke all on public.market_intel_future_card_thesis_rollups from public,anon;
grant select on public.market_intel_future_card_thesis_rollups to authenticated,service_role;
