drop view if exists public.market_intel_scout_synergy_lifecycle;
drop view if exists public.market_intel_synergy_cross_source_convergence;

create table if not exists public.market_intel_synergy_convergence_cache (
  user_id uuid not null,
  relationship_id uuid not null,
  source_intel_id uuid not null,
  oracle_id uuid,
  target_card_name text,
  corroborating_signal_count integer not null default 0,
  independent_source_count integer not null default 0,
  independent_source_type_count integer not null default 0,
  independent_creator_count integer not null default 0,
  independent_nonvideo_source_count integer not null default 0,
  corroborating_sources text[] not null default '{}',
  latest_corroboration_at timestamptz,
  convergence_score integer not null default 10,
  convergence_state text not null default 'single_source',
  refreshed_at timestamptz not null default now(),
  primary key (user_id,relationship_id)
);

alter table public.market_intel_synergy_convergence_cache enable row level security;
drop policy if exists synergy_convergence_own_select on public.market_intel_synergy_convergence_cache;
create policy synergy_convergence_own_select on public.market_intel_synergy_convergence_cache
  for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.market_intel_synergy_convergence_cache from anon;
grant select on public.market_intel_synergy_convergence_cache to authenticated;
grant all on public.market_intel_synergy_convergence_cache to service_role;
create index if not exists market_intel_synergy_convergence_cache_oracle_idx
  on public.market_intel_synergy_convergence_cache(user_id,oracle_id);

create view public.market_intel_scout_synergy_lifecycle
with (security_invoker = true)
as
select s.*,
  i.published_at as catalyst_published_at,
  extract(epoch from (now()-coalesce(i.published_at,i.observed_at,i.created_at)))/3600.0 as catalyst_age_hours,
  case when coalesce(s.market_response_score,0)>=greatest(45,coalesce(s.expected_market_reaction_score,0)-10) then 'market_caught_up'
       when coalesce(s.market_response_score,0)>=25 or coalesce(s.market_price_change_pct,0)>=8 or coalesce(s.transaction_velocity_lift_30d_pct,0)>=35 then 'starting_to_react'
       when now()-coalesce(i.published_at,i.observed_at,i.created_at)>=interval '7 days' and coalesce(s.unpriced_catalyst_gap_score,0)>=20 then 'still_unpriced_7d'
       when now()-coalesce(i.published_at,i.observed_at,i.created_at)>=interval '72 hours' and coalesce(s.unpriced_catalyst_gap_score,0)>=25 then 'still_unpriced_72h'
       when now()-coalesce(i.published_at,i.observed_at,i.created_at)>=interval '24 hours' and coalesce(s.unpriced_catalyst_gap_score,0)>=30 then 'still_unpriced_24h'
       else 'fresh_catalyst' end as synergy_lifecycle_state,
  case when greatest(coalesce(s.convergence_score,0),coalesce(x.convergence_score,10))>=60 then 'strong_convergence'
       when greatest(coalesce(s.convergence_score,0),coalesce(x.convergence_score,10))>=35 then 'multi_source'
       else 'single_source' end as convergence_state,
  least(100,greatest(0,coalesce(s.synergy_priority_score,0)
    + case when greatest(coalesce(s.convergence_score,0),coalesce(x.convergence_score,10))>=60 then 8 when greatest(coalesce(s.convergence_score,0),coalesce(x.convergence_score,10))>=35 then 4 else 0 end
    + case when now()-coalesce(i.published_at,i.observed_at,i.created_at)>=interval '72 hours' and coalesce(s.unpriced_catalyst_gap_score,0)>=25 then 6 when now()-coalesce(i.published_at,i.observed_at,i.created_at)>=interval '24 hours' and coalesce(s.unpriced_catalyst_gap_score,0)>=30 then 3 else 0 end
    - case when coalesce(s.market_response_score,0)>=greatest(45,coalesce(s.expected_market_reaction_score,0)-10) then 15 else 0 end))::integer as lifecycle_priority_score,
  coalesce(x.corroborating_signal_count,0) as corroborating_signal_count,
  coalesce(x.independent_source_count,0) as cross_source_independent_sources,
  coalesce(x.independent_source_type_count,0) as cross_source_type_count,
  coalesce(x.independent_creator_count,0) as cross_source_creator_count,
  coalesce(x.independent_nonvideo_source_count,0) as cross_source_nonvideo_count,
  coalesce(x.corroborating_sources,array[]::text[]) as corroborating_sources,
  x.latest_corroboration_at,
  greatest(coalesce(s.convergence_score,0),coalesce(x.convergence_score,10)) as effective_convergence_score,
  x.refreshed_at as convergence_refreshed_at
from public.market_intel_scout_synergy_opportunities s
left join public.market_intel_items i on i.intel_id=s.source_intel_id and i.user_id=s.user_id
left join public.market_intel_synergy_convergence_cache x on x.user_id=s.user_id and x.relationship_id=s.relationship_id;

grant select on public.market_intel_scout_synergy_lifecycle to authenticated;
revoke all on public.market_intel_scout_synergy_lifecycle from anon;
