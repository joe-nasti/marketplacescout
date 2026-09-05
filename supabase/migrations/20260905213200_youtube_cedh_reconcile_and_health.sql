alter table public.market_intel_youtube_video_ledger
  add column if not exists cedh_reconciled_at timestamptz,
  add column if not exists cedh_reconcile_events integer not null default 0;

create index if not exists market_intel_youtube_ledger_cedh_reconcile_idx
  on public.market_intel_youtube_video_ledger (channel_id, cedh_reconciled_at, status);

create or replace function public.mark_youtube_cedh_reconciled(p_user_id uuid,p_video_id text,p_events integer)
returns void
language sql
security invoker
set search_path=public
as $$
  update public.market_intel_youtube_video_ledger
  set cedh_reconciled_at=now(),
      cedh_reconcile_events=greatest(coalesce(cedh_reconcile_events,0),coalesce(p_events,0)),
      status=case when coalesce(p_events,0)>0 then 'evaluated' else status end,
      events_detected=greatest(coalesce(events_detected,0),coalesce(p_events,0)),
      cards_detected=greatest(coalesce(cards_detected,0),coalesce(p_events,0)),
      evaluated_at=case when coalesce(p_events,0)>0 then coalesce(evaluated_at,now()) else evaluated_at end,
      updated_at=now()
  where user_id=p_user_id and video_id=p_video_id;
$$;
grant execute on function public.mark_youtube_cedh_reconciled(uuid,text,integer) to service_role;
revoke execute on function public.mark_youtube_cedh_reconciled(uuid,text,integer) from anon,authenticated,public;

create or replace view public.market_intel_youtube_cedh_reconcile_pending with (security_invoker=true) as
select l.user_id,l.video_id,l.channel_id,l.channel_name,l.title,l.source_url,l.published_at,l.status,l.cards_detected,l.events_detected,l.cedh_reconciled_at
from public.market_intel_youtube_video_ledger l
join public.source_captures s
  on s.user_id=l.user_id
 and s.capture_type='video_subscription'
 and s.payload_json->>'channel_id'=l.channel_id
where coalesce(s.payload_json->>'source_profile','')='creator_cedh'
  and (l.cedh_reconciled_at is null or l.cedh_reconciled_at<coalesce(l.evaluated_at,l.updated_at))
  and l.status in ('evaluated','no_signal','transcript_ready');
grant select on public.market_intel_youtube_cedh_reconcile_pending to service_role;
revoke all on public.market_intel_youtube_cedh_reconcile_pending from anon,authenticated,public;

create or replace function public.admin_youtube_channel_health()
returns table(user_id uuid,channel_id text,channel_name text,creator_lane text,enabled boolean,videos_discovered bigint,videos_completed bigint,videos_pending bigint,videos_failed bigint,no_native_captions bigint,completion_pct numeric,signal_yield_pct numeric,latest_discovered_at timestamptz,latest_evaluated_at timestamptz,latest_success_at timestamptz,consecutive_failures integer,stalled boolean,measured_signals integer,predictive_pct numeric,reactive_pct numeric,confirming_pct numeric,scheduler_priority integer)
language sql
security invoker
set search_path=public
as $$
with me as (select auth.uid() user_id), subs as (
  select sc.user_id,sc.source channel_name,sc.payload_json->>'channel_id' channel_id,coalesce(sc.payload_json->>'creator_lane','general') creator_lane,coalesce((sc.payload_json->>'enabled')::boolean,true) enabled
  from source_captures sc cross join me
  where (me.user_id is null or sc.user_id=me.user_id) and sc.capture_type='video_subscription'
), agg as (
  select l.user_id,l.channel_id,count(*) videos_discovered,count(*) filter(where l.status in ('evaluated','no_signal')) videos_completed,count(*) filter(where l.status in ('discovered','queued','transcript_ready','unavailable_native')) videos_pending,count(*) filter(where l.status='failed') videos_failed,count(*) filter(where l.status='unavailable_native') no_native_captions,max(l.discovered_at) latest_discovered_at,max(l.evaluated_at) latest_evaluated_at,max(coalesce(l.evaluated_at,l.last_attempt_at)) filter(where l.status in ('evaluated','no_signal')) latest_success_at,count(*) filter(where l.status='evaluated') signal_videos
  from market_intel_youtube_video_ledger l cross join me
  where me.user_id is null or l.user_id=me.user_id
  group by l.user_id,l.channel_id
), ranked as (
  select l.user_id,l.channel_id,l.status,row_number() over(partition by l.user_id,l.channel_id order by coalesce(l.last_attempt_at,l.updated_at,l.discovered_at) desc) rn
  from market_intel_youtube_video_ledger l cross join me
  where me.user_id is null or l.user_id=me.user_id
), failstreak as (
  select user_id,channel_id,case when max(case when rn=1 then status end)='failed' then count(*) filter(where rn<=3 and status='failed')::int else 0 end consecutive_failures
  from ranked group by user_id,channel_id
), outcomes as (
  select o.user_id,lower(o.source_name) source_name,o.measured_signals,o.predictive_pct,o.reactive_pct,o.confirming_pct
  from market_intel_source_outcomes o cross join me
  where me.user_id is null or o.user_id=me.user_id
)
select s.user_id,s.channel_id,s.channel_name,s.creator_lane,s.enabled,
       coalesce(a.videos_discovered,0),coalesce(a.videos_completed,0),coalesce(a.videos_pending,0),coalesce(a.videos_failed,0),coalesce(a.no_native_captions,0),
       case when coalesce(a.videos_discovered,0)=0 then 0 else round(100.0*a.videos_completed/a.videos_discovered,1) end,
       case when coalesce(a.videos_completed,0)=0 then null else round(100.0*a.signal_videos/a.videos_completed,1) end,
       a.latest_discovered_at,a.latest_evaluated_at,a.latest_success_at,coalesce(f.consecutive_failures,0),
       (coalesce(a.videos_pending,0)>0 and coalesce(a.latest_success_at,a.latest_discovered_at)<now()-interval '12 hours'),
       coalesce(o.measured_signals,0),o.predictive_pct,o.reactive_pct,o.confirming_pct,
       (case s.creator_lane when 'competitive' then 40 when 'commander_product' then 35 when 'commander_gameplay' then 32 else 20 end
        + least(coalesce(a.videos_pending,0)::int,20)
        + case when coalesce(o.predictive_pct,0)>=50 then 15 when coalesce(o.predictive_pct,0)>=25 then 8 else 0 end
        + case when coalesce(a.latest_discovered_at,now()-interval '30 days')>now()-interval '3 days' then 10 else 0 end
        - least(coalesce(f.consecutive_failures,0)*10,30))::int
from subs s
left join agg a on a.user_id=s.user_id and a.channel_id=s.channel_id
left join failstreak f on f.user_id=s.user_id and f.channel_id=s.channel_id
left join outcomes o on o.user_id=s.user_id and o.source_name=lower(s.channel_name)
order by 22 desc,s.channel_name;
$$;
grant execute on function public.admin_youtube_channel_health() to authenticated,service_role;
revoke execute on function public.admin_youtube_channel_health() from anon,public;
