-- Secure browser-facing read model for Scout × Signals catalyst calibration.
-- The underlying backtest views intentionally reach protected TCGplayer history.
-- Keep that table private and expose only per-user calibration aggregates here.

create or replace function public.get_catalyst_calibration()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'bands', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.scorer_version desc, x.modifier_band)
      from (
        select *
        from public.market_intel_catalyst_shadow_backtest_summary
        where user_id = v_user_id
      ) x
    ), '[]'::jsonb),
    'proposals', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.matured_7d desc, x.snapshots desc, x.source_label)
      from (
        select *
        from public.market_intel_catalyst_shadow_weight_proposals
        where user_id = v_user_id
      ) x
    ), '[]'::jsonb),
    'candidates', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.decided_at desc nulls last, x.source_label)
      from (
        select *
        from public.market_intel_catalyst_candidate_weights
        where user_id = v_user_id
      ) x
    ), '[]'::jsonb),
    'shots', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.captured_at desc)
      from (
        select snapshot_id, future_release, captured_at
        from public.market_intel_catalyst_shadow_snapshots
        where user_id = v_user_id
        order by captured_at desc
        limit 500
      ) x
    ), '[]'::jsonb),
    'candidateMetrics', coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select *
        from public.market_intel_catalyst_candidate_model_metrics
        where user_id = v_user_id
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_catalyst_calibration() from public;
revoke all on function public.get_catalyst_calibration() from anon;
grant execute on function public.get_catalyst_calibration() to authenticated;
