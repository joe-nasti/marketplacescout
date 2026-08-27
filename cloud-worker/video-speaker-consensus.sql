-- Speaker-aware creator-video conviction semantics.
-- Multiple qualified speakers inside one piece of content can strengthen conviction,
-- but they remain one independent source for cross-source convergence.

alter table public.market_intel_video_events
  add column if not exists speaker_name text,
  add column if not exists speaker_role text,
  add column if not exists endorsement_type text,
  add column if not exists speaker_confidence numeric;

comment on column public.market_intel_video_events.speaker_name is 'Named or stable transcript speaker label when the extractor can distinguish the speaker.';
comment on column public.market_intel_video_events.speaker_role is 'host, guest, panelist, player, or unknown when known.';
comment on column public.market_intel_video_events.endorsement_type is 'echo, explicit, independent_rationale, or independent_action. Echoes do not earn speaker-consensus credit.';
comment on column public.market_intel_video_events.speaker_confidence is '0-1 confidence that this event is attributed to the stated speaker; low-confidence attributions do not earn consensus credit.';

drop view if exists public.market_intel_video_market_response;
create view public.market_intel_video_market_response with (security_invoker=true) as
with event_speakers as (
  select v.*,
    case
      when coalesce(v.speaker_confidence,0) >= .70 and nullif(trim(v.speaker_name),'') is not null
        then lower(trim(v.speaker_name))
      else lower(coalesce(nullif(trim(v.channel_name),''),'primary_creator'))
    end speaker_key,
    case
      when coalesce(v.speaker_confidence,0) >= .70
       and nullif(trim(v.speaker_name),'') is not null
       and coalesce(v.endorsement_type,'explicit') <> 'echo'
       and v.prominence >= .55
      then true else false
    end qualified_speaker_support
  from public.market_intel_video_events v
), speaker_rollup as (
  select intel_id,user_id,speaker_key,
    max(prominence) speaker_conviction,
    bool_or(qualified_speaker_support) qualified_support,
    max(case coalesce(endorsement_type,'explicit')
      when 'independent_action' then 4
      when 'independent_rationale' then 3
      when 'explicit' then 2
      else 0 end) endorsement_strength
  from event_speakers
  group by intel_id,user_id,speaker_key
), speaker_summary as (
  select intel_id,user_id,
    max(speaker_conviction) strongest_speaker_conviction,
    greatest(1,count(*) filter(where qualified_support))::integer qualified_speaker_count,
    coalesce(sum(endorsement_strength) filter(where qualified_support),0)::integer endorsement_strength_sum
  from speaker_rollup
  group by intel_id,user_id
), video_items as (
  select i.intel_id,i.user_id,i.source_name,i.source_url,i.title,i.direction,e.entity_name card_name,
         max(v.prominence) creator_conviction,
         least(1::numeric,
           coalesce(ss.strongest_speaker_conviction,max(v.prominence)) +
           case greatest(1,coalesce(ss.qualified_speaker_count,1))
             when 1 then 0
             when 2 then .04
             when 3 then .07
             else .10 end
         ) content_conviction,
         greatest(1,coalesce(ss.qualified_speaker_count,1))::integer qualified_speaker_count,
         coalesce(ss.endorsement_strength_sum,0)::integer endorsement_strength_sum,
         (array_agg(v.event_type order by v.prominence desc,v.start_ms asc))[1] primary_event_type,
         min(v.start_ms) first_start_ms,min(l.oracle_id::text)::uuid oracle_id
  from public.market_intel_items i
  join public.market_intel_entities e on e.intel_id=i.intel_id and e.user_id=i.user_id and e.entity_type='card'
  join public.market_intel_video_events v on v.intel_id=i.intel_id and v.user_id=i.user_id
  left join speaker_summary ss on ss.intel_id=i.intel_id and ss.user_id=i.user_id
  left join public.market_intel_scout_signal_links l on l.intel_id=i.intel_id and l.user_id=i.user_id
  where i.source_type='youtube'
  group by i.intel_id,i.user_id,i.source_name,i.source_url,i.title,i.direction,e.entity_name,ss.strongest_speaker_conviction,ss.qualified_speaker_count,ss.endorsement_strength_sum
), priors as (
  select vi.*,
    case lower(coalesce(vi.source_name,''))
      when 'the command zone' then 90
      when 'aspiringspike' then 62
      else 55 end::integer source_reach_prior,
    case vi.primary_event_type
      when 'precon_upgrade' then 96
      when 'reprint_reveal' then 92
      when 'competitive_result' then 90
      when 'commander_recommendation' then 88
      when 'precon_reveal' then 86
      when 'new_commander_synergy' then 84
      when 'deck_innovation' then 82
      when 'commander_showcase' then 78
      when 'spoiler_reaction' then 70
      when 'precon_cut' then 68
      when 'competitive_test' then 65
      else 55 end::integer intent_prior
  from video_items vi
), support as (
  select p.intel_id,p.user_id,
    count(distinct lower(coalesce(i2.source_name,i2.source_type)))::integer independent_source_count,
    count(distinct i2.source_type)::integer independent_source_type_count,
    count(distinct lower(i2.source_name)) filter(where i2.source_type='youtube')::integer independent_creator_count,
    count(distinct lower(coalesce(i2.source_name,i2.source_type))) filter(where i2.source_type<>'youtube')::integer independent_nonvideo_source_count
  from priors p
  left join public.market_intel_scout_signal_links l2 on l2.user_id=p.user_id and l2.oracle_id=p.oracle_id
  left join public.market_intel_items i2 on i2.intel_id=l2.intel_id and i2.user_id=l2.user_id
    and coalesce(i2.published_at,i2.observed_at,i2.created_at)>=now()-interval '7 days'
    and ((p.direction='bearish' and i2.direction='bearish') or (coalesce(p.direction,'bullish')<>'bearish' and i2.direction='bullish'))
  group by p.intel_id,p.user_id
), ranked_snapshots as (
  select s.*,row_number() over(partition by s.intel_id,s.user_id order by s.captured_at desc) rn
  from public.market_intel_market_snapshots s
), joined as (
  select p.*,greatest(1,coalesce(su.independent_source_count,0)) independent_source_count,
         greatest(1,coalesce(su.independent_source_type_count,0)) independent_source_type_count,
         greatest(1,coalesce(su.independent_creator_count,0)) independent_creator_count,
         coalesce(su.independent_nonvideo_source_count,0) independent_nonvideo_source_count,
         b.snapshot_id baseline_id,b.captured_at baseline_captured_at,b.market_price baseline_market_price,b.direct_low baseline_direct_low,b.direct_available baseline_direct_available,b.direct_listings baseline_direct_listings,b.avg_daily_qty_sold baseline_avg_daily_qty_sold,
         l.captured_at latest_captured_at,l.horizon latest_horizon,l.market_price latest_market_price,l.direct_low latest_direct_low,l.direct_available latest_direct_available,l.direct_listings latest_direct_listings,l.avg_daily_qty_sold latest_avg_daily_qty_sold,
         s.transaction_velocity_lift_30d_pct,s.evidence_level,s.evidence_status,s.evidence_confidence,s.post_signal_transactions_to_date,s.post_signal_quantity_to_date
  from priors p
  left join support su on su.intel_id=p.intel_id and su.user_id=p.user_id
  left join ranked_snapshots b on b.intel_id=p.intel_id and b.user_id=p.user_id and b.horizon='t0'
  left join ranked_snapshots l on l.intel_id=p.intel_id and l.user_id=p.user_id and l.rn=1
  left join public.marketplace_signal_card_sales_response s on s.user_id=p.user_id and lower(s.card_name)=lower(p.card_name)
), metrics as (
  select j.*,
    case when baseline_market_price>0 and latest_market_price is not null then round((latest_market_price/baseline_market_price-1)*100,2) end market_price_change_pct,
    case when baseline_direct_low>0 and latest_direct_low is not null then round((latest_direct_low/baseline_direct_low-1)*100,2) end direct_low_change_pct,
    case when baseline_direct_available>0 and latest_direct_available is not null then round((latest_direct_available::numeric/baseline_direct_available-1)*100,2) end direct_available_change_pct,
    round(least(100,greatest(0,content_conviction*45 + intent_prior*.35 + source_reach_prior*.20)))::integer catalyst_impact_score,
    least(100,
      case independent_source_count when 1 then 10 when 2 then 35 when 3 then 60 when 4 then 78 else 90 end
      + least(10,greatest(0,(independent_source_type_count-1)*5)))::integer convergence_score
  from joined j
), scored as (
  select m.*,least(100,greatest(0,
    least(40,greatest(0,coalesce(m.market_price_change_pct,0)*2))+
    least(25,greatest(0,coalesce(-m.direct_available_change_pct,0)*0.5))+
    least(35,greatest(0,coalesce(m.transaction_velocity_lift_30d_pct,0)*0.35))))::integer market_response_score
  from metrics m
)
select intel_id,user_id,source_name,source_url,title,card_name,oracle_id,primary_event_type,
       round(creator_conviction*100)::integer creator_conviction_score,
       round(content_conviction*100)::integer content_conviction_score,
       qualified_speaker_count,endorsement_strength_sum,
       source_reach_prior,intent_prior,catalyst_impact_score,
       convergence_score,independent_source_count,independent_source_type_count,independent_creator_count,independent_nonvideo_source_count,
       catalyst_impact_score as attention_score,first_start_ms,
       baseline_captured_at,latest_captured_at,latest_horizon,baseline_market_price,latest_market_price,market_price_change_pct,
       baseline_direct_low,latest_direct_low,direct_low_change_pct,baseline_direct_available,latest_direct_available,direct_available_change_pct,
       baseline_direct_listings,latest_direct_listings,baseline_avg_daily_qty_sold,latest_avg_daily_qty_sold,
       transaction_velocity_lift_30d_pct,evidence_level,evidence_status,evidence_confidence,post_signal_transactions_to_date,post_signal_quantity_to_date,market_response_score,
       case when baseline_id is null then 'awaiting_baseline' when latest_horizon='t0' then 'baseline_only' when market_response_score>=60 then 'strong_reaction' when market_response_score>=25 then 'emerging_reaction' else 'limited_reaction' end market_response_status,
       case when independent_source_count>=4 then 'high_convergence' when independent_source_count>=2 then 'multi_source' else 'single_source' end attention_scope,
       case when market_response_score>=60 then 'market_confirming'
            when convergence_score>=60 and market_response_score<25 then 'converging_ahead_of_market'
            when catalyst_impact_score>=85 and independent_source_count=1 and market_response_score<25 then 'major_single_source_catalyst'
            when catalyst_impact_score>=75 and independent_source_count=1 and market_response_score<25 then 'meaningful_single_source_catalyst'
            when catalyst_impact_score>=80 and market_response_score<25 then 'high_impact_unconfirmed'
            else 'watching' end catalyst_market_state,
       case when market_response_score>=60 then 'market_confirming'
            when convergence_score>=60 and market_response_score<25 then 'converging_ahead_of_market'
            when catalyst_impact_score>=85 and independent_source_count=1 and market_response_score<25 then 'major_single_source_catalyst'
            when catalyst_impact_score>=75 and independent_source_count=1 and market_response_score<25 then 'meaningful_single_source_catalyst'
            when catalyst_impact_score>=80 and market_response_score<25 then 'high_impact_unconfirmed'
            else 'watching' end attention_market_state
from scored;

grant select on public.market_intel_video_market_response to authenticated,service_role;
revoke all on public.market_intel_video_market_response from anon;
