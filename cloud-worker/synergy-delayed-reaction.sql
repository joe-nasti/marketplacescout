create or replace view public.market_intel_scout_synergy_lifecycle with (security_invoker=true) as
select
  s.*,
  i.published_at as catalyst_published_at,
  extract(epoch from (now() - coalesce(i.published_at,i.observed_at,i.created_at)))/3600.0 as catalyst_age_hours,
  case
    when coalesce(s.market_response_score,0) >= greatest(45, coalesce(s.expected_market_reaction_score,0)-10) then 'market_caught_up'
    when coalesce(s.market_response_score,0) >= 25
      or coalesce(s.market_price_change_pct,0) >= 8
      or coalesce(s.transaction_velocity_lift_30d_pct,0) >= 35 then 'starting_to_react'
    when now() - coalesce(i.published_at,i.observed_at,i.created_at) >= interval '7 days'
      and coalesce(s.unpriced_catalyst_gap_score,0) >= 20 then 'still_unpriced_7d'
    when now() - coalesce(i.published_at,i.observed_at,i.created_at) >= interval '72 hours'
      and coalesce(s.unpriced_catalyst_gap_score,0) >= 25 then 'still_unpriced_72h'
    when now() - coalesce(i.published_at,i.observed_at,i.created_at) >= interval '24 hours'
      and coalesce(s.unpriced_catalyst_gap_score,0) >= 30 then 'still_unpriced_24h'
    else 'fresh_catalyst'
  end as synergy_lifecycle_state,
  case
    when coalesce(s.convergence_score,0) >= 60 then 'strong_convergence'
    when coalesce(s.convergence_score,0) >= 35 then 'multi_source'
    else 'single_source'
  end as convergence_state,
  least(100,greatest(0,
    coalesce(s.synergy_priority_score,0)
    + case when coalesce(s.convergence_score,0)>=60 then 8 when coalesce(s.convergence_score,0)>=35 then 4 else 0 end
    + case
        when now() - coalesce(i.published_at,i.observed_at,i.created_at) >= interval '72 hours' and coalesce(s.unpriced_catalyst_gap_score,0)>=25 then 6
        when now() - coalesce(i.published_at,i.observed_at,i.created_at) >= interval '24 hours' and coalesce(s.unpriced_catalyst_gap_score,0)>=30 then 3
        else 0
      end
    - case when coalesce(s.market_response_score,0) >= greatest(45,coalesce(s.expected_market_reaction_score,0)-10) then 15 else 0 end
  ))::int as lifecycle_priority_score
from public.market_intel_scout_synergy_opportunities s
left join public.market_intel_items i on i.intel_id=s.source_intel_id and i.user_id=s.user_id;

revoke all on public.market_intel_scout_synergy_lifecycle from anon;
grant select on public.market_intel_scout_synergy_lifecycle to authenticated, service_role;
