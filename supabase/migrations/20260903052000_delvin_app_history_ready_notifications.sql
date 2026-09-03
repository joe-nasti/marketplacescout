create or replace function public.list_delvin_history_ready_for_app_v1(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_uid uuid:=auth.uid(); v_rows jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'subscription_id',s.subscription_id,'job_id',s.job_id,'ask_session_id',s.ask_session_id,'original_question',s.original_question,
    'status',j.status,'treatment',j.treatment,'set_codes',j.set_codes,'coverage_before_start',j.coverage_before_start,
    'coverage_after_start',j.coverage_after_start,'coverage_after_end',j.coverage_after_end,'progress',j.progress,'result',j.result,'error_message',j.error_message
  ) order by j.completed_at desc),'[]'::jsonb) into v_rows
  from (
    select s.* from public.delvin_history_backfill_subscriptions s
    join public.delvin_history_backfill_jobs j on j.job_id=s.job_id
    where s.surface='app' and s.collectish_user_id=v_uid and s.delivery_status='pending' and j.status in ('ready','partial','failed')
    order by j.completed_at desc nulls last limit greatest(1,least(coalesce(p_limit,10),50))
  ) s join public.delvin_history_backfill_jobs j on j.job_id=s.job_id;
  return v_rows;
end $$;

create or replace function public.ack_delvin_history_ready_for_app_v1(p_subscription_id bigint)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare v_uid uuid:=auth.uid(); v_count integer;
begin
  if v_uid is null then return false; end if;
  update public.delvin_history_backfill_subscriptions
  set delivery_status='sent',notified_at=now(),delivery_error=null
  where subscription_id=p_subscription_id and surface='app' and collectish_user_id=v_uid and delivery_status='pending';
  get diagnostics v_count=row_count;
  return v_count>0;
end $$;

grant execute on function public.list_delvin_history_ready_for_app_v1(integer) to authenticated;
grant execute on function public.ack_delvin_history_ready_for_app_v1(bigint) to authenticated;
