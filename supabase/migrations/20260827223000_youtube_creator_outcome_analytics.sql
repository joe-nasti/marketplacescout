create or replace function public.admin_youtube_creator_analytics()
returns table(
  channel_id text,
  channel_name text,
  creator_lane text,
  completed_videos bigint,
  signal_videos bigint,
  no_signal_videos bigint,
  unique_cards bigint,
  current_ab_cards bigint,
  measured_signals integer,
  predictive_pct numeric,
  reactive_pct numeric,
  confirming_pct numeric,
  avg_post7_velocity_change_pct numeric,
  avg_post7_market_price_change_pct numeric,
  latest_signal_at timestamptz
)
language sql
security definer
set search_path=public
as $$
with u as (select auth.uid() user_id),
ledger as (
  select l.user_id,l.channel_id,max(l.channel_name) channel_name,max(l.creator_lane) creator_lane,
         count(*) filter(where l.status in ('evaluated','no_signal')) completed_videos,
         count(*) filter(where l.status='evaluated') signal_videos,
         count(*) filter(where l.status='no_signal') no_signal_videos
  from market_intel_youtube_video_ledger l join u on u.user_id=l.user_id
  group by l.user_id,l.channel_id
),
card_rows as (
  select distinct e.user_id,v.channel_id,e.scryfall_id
  from market_intel_video_events v
  join market_intel_entities e on e.intel_id=v.intel_id and e.user_id=v.user_id and e.entity_type='card'
  join u on u.user_id=v.user_id
  where e.scryfall_id is not null
),
card_agg as (
  select cr.user_id,cr.channel_id,count(*) unique_cards,
         count(*) filter(where exists(
           select 1 from scout_card_catalog c join scout_card_state s on s.user_id=cr.user_id and s.sku_id=c.sku_id
           where c.scryfall_id=cr.scryfall_id and s.last_grade in ('A','B')
         )) current_ab_cards
  from card_rows cr group by cr.user_id,cr.channel_id
),
source_out as (
  select o.user_id,lower(o.source_name) source_key,
         sum(o.measured_signals)::int measured_signals,
         case when sum(o.measured_signals)>0 then round(100.0*sum(o.predictive_signals)/sum(o.measured_signals),1) end predictive_pct,
         case when sum(o.measured_signals)>0 then round(100.0*sum(o.reactive_signals)/sum(o.measured_signals),1) end reactive_pct,
         case when sum(o.measured_signals)>0 then round(100.0*sum(o.confirming_signals)/sum(o.measured_signals),1) end confirming_pct,
         avg(o.avg_post7_vs_pre7_pct) avg_post7_velocity_change_pct,
         avg(o.avg_post7_market_price_change_pct) avg_post7_market_price_change_pct,
         max(o.latest_signal_at) latest_signal_at
  from market_intel_source_outcomes o join u on u.user_id=o.user_id
  group by o.user_id,lower(o.source_name)
)
select l.channel_id,l.channel_name,l.creator_lane,l.completed_videos,l.signal_videos,l.no_signal_videos,
       coalesce(c.unique_cards,0),coalesce(c.current_ab_cards,0),coalesce(o.measured_signals,0),
       o.predictive_pct,o.reactive_pct,o.confirming_pct,o.avg_post7_velocity_change_pct,o.avg_post7_market_price_change_pct,o.latest_signal_at
from ledger l
left join card_agg c on c.user_id=l.user_id and c.channel_id=l.channel_id
left join source_out o on o.user_id=l.user_id and o.source_key=lower(l.channel_name)
order by l.completed_videos desc,l.channel_name;
$$;
grant execute on function public.admin_youtube_creator_analytics() to authenticated;
