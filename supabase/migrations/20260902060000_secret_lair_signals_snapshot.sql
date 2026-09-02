create or replace function public.secret_lair_signals_snapshot(
  p_release_name text default 'Secret Lair: A Perfectly Normal Superdrop'
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with selected_release as (
    select r.release_id, r.release_name, r.sale_start_at, r.lifecycle_state, r.supply_confidence
    from public.secret_lair_releases r
    where r.user_id = auth.uid()
      and r.release_name = p_release_name
    limit 1
  )
  select jsonb_build_object(
    'release', (select to_jsonb(r) from selected_release r),
    'drops', coalesce((
      select jsonb_agg(to_jsonb(d)) from (
        select d.drop_id, d.drop_name, d.ip_name, d.artist_name, d.supply_prior,
          d.supply_prior_confidence, d.supply_prior_rationale
        from public.secret_lair_drops d join selected_release r using (release_id)
        order by d.created_at asc
      ) d
    ), '[]'::jsonb),
    'evaluations', coalesce((
      select jsonb_agg(to_jsonb(e)) from (
        select e.evaluation_id, e.drop_id, e.evaluated_at, e.evaluation_status, e.recommendation,
          e.opportunity_score, e.collector_score, e.confidence, e.compression_adjusted_ev,
          e.acquisition_cost, e.expected_roi_pct, e.region, e.finish, e.model_version
        from public.secret_lair_evaluations e join selected_release r using (release_id)
        order by e.evaluated_at desc limit 400
      ) e
    ), '[]'::jsonb),
    'predictions', coalesce((
      select jsonb_agg(to_jsonb(p)) from (
        select p.prediction_id, p.drop_id, p.prediction_label, p.prediction_type, p.predicted_rating,
          p.predicted_rating_scale, p.claim, p.frozen_at
        from public.secret_lair_predictions p join selected_release r using (release_id)
        order by p.frozen_at desc limit 100
      ) p
    ), '[]'::jsonb),
    'observations', coalesce((
      select jsonb_agg(to_jsonb(o)) from (
        select o.drop_id, o.region, o.finish, o.availability_state, o.observation_type,
          o.observed_at, o.elapsed_minutes_from_sale
        from public.secret_lair_observations o join selected_release r using (release_id)
        order by o.observed_at desc limit 500
      ) o
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(to_jsonb(e)) from (
        select e.drop_id, e.source_type, e.raw_rating, e.raw_rating_scale, e.summary, e.observed_at
        from public.secret_lair_evidence e join selected_release r using (release_id)
        where e.source_type = 'expert_review'
        order by e.observed_at desc limit 200
      ) e
    ), '[]'::jsonb),
    'assets', coalesce((
      select jsonb_agg(to_jsonb(a)) from (
        select a.drop_id, a.asset_type, a.public_url, a.is_primary, a.sort_order, a.download_status
        from public.secret_lair_assets a join selected_release r using (release_id)
        where a.download_status = 'downloaded'
        order by a.sort_order asc
      ) a
    ), '[]'::jsonb),
    'intervals', coalesce((
      select jsonb_agg(to_jsonb(i)) from (
        select i.drop_id, i.region, i.finish, i.last_available_elapsed,
          i.first_sold_out_elapsed, i.first_sold_out_at
        from public.secret_lair_sellout_intervals i join selected_release r using (release_id)
      ) i
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(to_jsonb(c)) from (
        select c.evaluation_id, c.drop_id, c.finish, c.card_name, c.normal_market_floor,
          c.naive_comparable_value, c.compression_adjusted_value, c.liquid_premium_comparable,
          c.bling_gap, c.reprint_compression_penalty, c.total_sales_90d, c.comparable_metadata, c.created_at
        from public.secret_lair_card_valuations c join selected_release r using (release_id)
        order by c.created_at desc limit 800
      ) c
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.secret_lair_signals_snapshot(text) from public;
revoke all on function public.secret_lair_signals_snapshot(text) from anon;
grant execute on function public.secret_lair_signals_snapshot(text) to authenticated;

comment on function public.secret_lair_signals_snapshot(text) is
  'Returns the release-scoped Secret Lair Signals read model in one RLS-protected request.';
