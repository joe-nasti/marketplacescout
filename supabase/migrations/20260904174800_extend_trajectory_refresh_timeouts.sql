-- Historical trajectory refreshes grow with every preserved archive checkpoint.
-- Keep each service-only refresh bounded, but above PostgREST's short default budget.

alter function public.refresh_modeled_booster_ev_calibration()
  set statement_timeout='120s';

alter function public.refresh_modeled_play_booster_similarity_forecasts()
  set statement_timeout='120s';

alter function public.refresh_collector_booster_trajectory_forecasts()
  set statement_timeout='120s';
