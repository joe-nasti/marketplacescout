do $$ declare v text; begin
  select pg_get_functiondef('public.refresh_secret_lair_forward_test_outcome(uuid,uuid,text)'::regprocedure) into v;
  execute replace(v,'order by evaluated_at asc limit 1','order by evaluated_at desc limit 1');
end $$;
with latest as (
  select distinct on (user_id,drop_id,finish) user_id,drop_id,finish,evaluation_id,recommendation,opportunity_score,collector_score,expected_roi_pct,acquisition_cost,model_version
  from public.secret_lair_evaluations
  where evaluation_phase='pre_sale' and evaluation_status='scored'
  order by user_id,drop_id,finish,evaluated_at desc
)
update public.secret_lair_forward_test_outcomes o set frozen_evaluation_id=l.evaluation_id,frozen_recommendation=l.recommendation,frozen_opportunity_score=l.opportunity_score,frozen_collector_score=l.collector_score,frozen_expected_roi_pct=l.expected_roi_pct,frozen_acquisition_cost=l.acquisition_cost,frozen_model_version=l.model_version,updated_at=now()
from latest l where o.user_id=l.user_id and o.drop_id=l.drop_id and o.finish=l.finish;
