create table if not exists public.market_intel_relationship_speaker_consensus (
  relationship_id uuid primary key references public.market_intel_card_relationships(relationship_id) on delete cascade,
  user_id uuid not null,
  source_video_id text not null,
  target_card_name text not null,
  distinct_speaker_count integer not null default 0,
  substantive_speaker_count integer not null default 0,
  echo_count integer not null default 0,
  explicit_count integer not null default 0,
  independent_rationale_count integer not null default 0,
  independent_action_count integer not null default 0,
  consensus_tier text not null default 'none' check (consensus_tier in ('none','echo_only','multi_speaker','strong_multi_speaker')),
  consensus_score integer not null default 0 check (consensus_score between 0 and 100),
  consensus_bonus integer not null default 0 check (consensus_bonus between 0 and 8),
  attribution_confidence numeric not null default 0 check (attribution_confidence between 0 and 1),
  speaker_evidence jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now()
);
create index if not exists market_intel_relationship_speaker_consensus_user_idx on public.market_intel_relationship_speaker_consensus(user_id, refreshed_at desc);
alter table public.market_intel_relationship_speaker_consensus enable row level security;
drop policy if exists "relationship speaker consensus owner read" on public.market_intel_relationship_speaker_consensus;
create policy "relationship speaker consensus owner read" on public.market_intel_relationship_speaker_consensus for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.market_intel_relationship_speaker_consensus from anon, public;
grant select on public.market_intel_relationship_speaker_consensus to authenticated;
grant all on public.market_intel_relationship_speaker_consensus to service_role;
create or replace view public.market_intel_actionable_synergy_speaker_context with (security_invoker=true) as
select r.*, coalesce(s.distinct_speaker_count,0) as same_video_speaker_count,
       coalesce(s.substantive_speaker_count,0) as same_video_substantive_speakers,
       coalesce(s.consensus_tier,'none') as same_video_consensus_tier,
       coalesce(s.consensus_score,0) as same_video_consensus_score,
       coalesce(s.consensus_bonus,0) as same_video_consensus_bonus,
       coalesce(s.attribution_confidence,0) as same_video_attribution_confidence,
       coalesce(s.speaker_evidence,'[]'::jsonb) as same_video_speaker_evidence,
       s.refreshed_at as same_video_consensus_refreshed_at
from public.market_intel_actionable_synergy_relationships r
left join public.market_intel_relationship_speaker_consensus s on s.relationship_id=r.relationship_id and s.user_id=r.user_id;
revoke all on public.market_intel_actionable_synergy_speaker_context from anon, public;
grant select on public.market_intel_actionable_synergy_speaker_context to authenticated, service_role;
