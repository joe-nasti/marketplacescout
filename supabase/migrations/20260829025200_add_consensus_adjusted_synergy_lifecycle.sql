create or replace view public.market_intel_scout_synergy_lifecycle_consensus with (security_invoker=true) as
select l.*,
       coalesce(c.distinct_speaker_count,0) as same_video_speaker_count,
       coalesce(c.substantive_speaker_count,0) as same_video_substantive_speakers,
       coalesce(c.consensus_tier,'none') as same_video_consensus_tier,
       coalesce(c.consensus_score,0) as same_video_consensus_score,
       coalesce(c.consensus_bonus,0) as same_video_consensus_bonus,
       coalesce(c.attribution_confidence,0) as same_video_attribution_confidence,
       coalesce(c.speaker_evidence,'[]'::jsonb) as same_video_speaker_evidence,
       least(100,greatest(0,coalesce(l.lifecycle_priority_score,0)+coalesce(c.consensus_bonus,0))) as consensus_adjusted_lifecycle_priority_score
from public.market_intel_scout_synergy_lifecycle l
left join public.market_intel_relationship_speaker_consensus c
  on c.relationship_id=l.relationship_id and c.user_id=l.user_id;
revoke all on public.market_intel_scout_synergy_lifecycle_consensus from anon, public;
grant select on public.market_intel_scout_synergy_lifecycle_consensus to authenticated, service_role;
