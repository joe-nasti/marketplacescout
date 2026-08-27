-- Security hardening discovered while adding TCGplayer / YouTube Signals.
-- Keep the public Data API tenant-scoped and remove anonymous privileged execution.

alter table public.market_intel_youtube_video_ledger enable row level security;

revoke all on table public.market_intel_youtube_video_ledger from anon;
revoke all on table public.market_intel_youtube_video_ledger from authenticated;
grant select, insert, update on table public.market_intel_youtube_video_ledger to authenticated;

create policy "youtube ledger select own"
on public.market_intel_youtube_video_ledger for select to authenticated
using ((select auth.uid()) = user_id);

create policy "youtube ledger insert own"
on public.market_intel_youtube_video_ledger for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "youtube ledger update own"
on public.market_intel_youtube_video_ledger for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter view public.market_intel_entity_rollups_with_edhrec set (security_invoker = true);
alter view public.mtgjson_deck_ev_current set (security_invoker = true);
grant select on table public.edhrec_card_cache to authenticated;

alter function public.infer_sealed_language(text) set search_path = public;

-- Remove anonymous access to every SECURITY DEFINER function in public.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', r.signature);
  end loop;
end $$;

-- Future public-schema objects should not become anonymous API endpoints by default.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon;

create or replace function public.admin_signal_scout_analytics()
returns table(wakes_24h bigint, wakes_completed_24h bigint, wakes_failed_24h bigint, avg_refresh_seconds numeric, signals_wakes_24h bigint, user_wakes_24h bigint, refreshed_ab_24h bigint, latest_completed_at timestamptz)
language sql security definer set search_path='public'
as $$
  with u as (select auth.uid() user_id), q as (
    select q.* from scout_refresh_queue q,u
    where q.user_id=u.user_id and q.requested_at >= now()-interval '24 hours'
  ), completed as (
    select *, extract(epoch from (completed_at-requested_at)) as seconds
    from q where status='completed' and completed_at is not null
  )
  select
    (select count(*) from q),
    (select count(*) from q where status='completed'),
    (select count(*) from q where status='failed'),
    (select round(avg(seconds)::numeric,1) from completed),
    (select count(*) from q where reason like 'signal:%'),
    (select count(*) from q where reason like 'user%'),
    (select count(*) from completed c join scout_card_state s on s.user_id=c.user_id and s.sku_id=c.sku_id where s.last_grade in ('A','B') and s.last_evaluated_at >= c.requested_at),
    (select max(completed_at) from q where status='completed');
$$;

create or replace function public.admin_video_evaluation_channels()
returns table(channel_id text, channel_name text, creator_lane text, videos_evaluated bigint, events_detected bigint, first_evaluated_at timestamptz, latest_evaluated_at timestamptz)
language sql security definer set search_path='public'
as $$
  select nullif(ve.channel_id,''),coalesce(nullif(ve.channel_name,''),'Unknown channel'),coalesce(nullif(ve.creator_lane,''),'unknown'),count(distinct ve.video_id),count(*),min(ve.created_at),max(ve.created_at)
  from market_intel_video_events ve
  where ve.user_id=auth.uid()
  group by nullif(ve.channel_id,''),coalesce(nullif(ve.channel_name,''),'Unknown channel'),coalesce(nullif(ve.creator_lane,''),'unknown')
  order by max(ve.created_at) desc;
$$;

create or replace function public.admin_video_evaluations(p_limit integer default 100)
returns table(video_id text, channel_id text, channel_name text, creator_lane text, title text, source_url text, source_name text, events_detected bigint, cards_detected bigint, event_types text[], transcript_modes text[], first_evaluated_at timestamptz, latest_evaluated_at timestamptz)
language sql security definer set search_path='public'
as $$
  with ev as (
    select ve.video_id,nullif(ve.channel_id,'') channel_id,coalesce(nullif(ve.channel_name,''),'Unknown channel') channel_name,coalesce(nullif(ve.creator_lane,''),'unknown') creator_lane,min(ve.intel_id::text)::uuid intel_id,count(*) events_detected,
      array_agg(distinct ve.event_type order by ve.event_type) filter(where ve.event_type is not null) event_types,
      array_agg(distinct ve.transcript_mode order by ve.transcript_mode) filter(where ve.transcript_mode is not null) transcript_modes,
      min(ve.created_at) first_evaluated_at,max(ve.created_at) latest_evaluated_at
    from market_intel_video_events ve
    where ve.user_id=auth.uid()
    group by ve.video_id,nullif(ve.channel_id,''),coalesce(nullif(ve.channel_name,''),'Unknown channel'),coalesce(nullif(ve.creator_lane,''),'unknown')
  )
  select ev.video_id,ev.channel_id,ev.channel_name,ev.creator_lane,mi.title,mi.source_url,mi.source_name,ev.events_detected,
    coalesce((select count(distinct mie.entity_name) from market_intel_entities mie where mie.user_id=auth.uid() and mie.intel_id=ev.intel_id and mie.entity_type='card'),0)::bigint,
    ev.event_types,ev.transcript_modes,ev.first_evaluated_at,ev.latest_evaluated_at
  from ev left join market_intel_items mi on mi.user_id=auth.uid() and mi.intel_id=ev.intel_id
  order by ev.latest_evaluated_at desc
  limit greatest(1,least(coalesce(p_limit,100),500));
$$;

create or replace function public.rebalance_marketplace_scan_schedule(p_user_id uuid)
returns integer language plpgsql security definer set search_path='public'
as $$
declare n integer;
begin
  if not (p_user_id=auth.uid() or coalesce(auth.jwt()->>'role','')='service_role') then raise exception 'not authorized'; end if;
  with ranked as (
    select user_id,set_slug,cadence_hours,row_number() over(partition by user_id,cadence_hours order by set_slug)-1 rn,count(*) over(partition by user_id,cadence_hours) cnt
    from public.marketplace_scan_profiles where user_id=p_user_id and enabled=true
  ), calc as (
    select user_id,set_slug,floor((cadence_hours*60.0*rn)/greatest(cnt,1))::int off from ranked
  )
  update public.marketplace_scan_profiles p set schedule_offset_minutes=c.off,next_due_at=now()+make_interval(mins=>c.off),updated_at=now()
  from calc c where p.user_id=c.user_id and p.set_slug=c.set_slug;
  get diagnostics n=row_count;
  return n;
end;
$$;

revoke execute on function public.resolve_mtgstocks_interest_links(uuid[]) from authenticated, anon, public;
grant execute on function public.resolve_mtgstocks_interest_links(uuid[]) to service_role;

revoke execute on function public.sync_youtube_transcript_ledger() from authenticated, anon, public;
grant execute on function public.sync_youtube_transcript_ledger() to postgres;
