-- Canonical public.claim_collector_job definition used by cloud and Android agents.
-- Deferred retries must not be claimable before collector_jobs.available_at.
-- service_role may claim globally; authenticated clients may claim only their own
-- jobs and only with a collector_id already registered to the same user.
create or replace function public.claim_collector_job(
  p_source text,
  p_action text,
  p_preferred_executors text[],
  p_required_capability text,
  p_collector_id uuid,
  p_lease_seconds integer default 300
)
returns setof public.collector_jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job_id uuid;
  v_now timestamptz := now();
  v_role text := auth.role();
  v_uid uuid := auth.uid();
begin
  if coalesce(v_role,'') <> 'service_role' then
    if v_uid is null then return; end if;
    if not exists (
      select 1 from public.collectors c
      where c.user_id = v_uid and c.collector_id = p_collector_id
    ) then return; end if;
  end if;

  select j.job_id into v_job_id
  from public.collector_jobs j
  where j.status = 'queued'
    and coalesce(j.available_at, v_now) <= v_now
    and (v_role = 'service_role' or j.user_id = v_uid)
    and (p_source is null or j.source = p_source)
    and (p_action is null or j.action = p_action)
    and (p_preferred_executors is null or cardinality(p_preferred_executors)=0 or j.preferred_executor = any(p_preferred_executors))
    and (p_required_capability is null or j.required_capability = p_required_capability)
  order by j.priority asc, j.available_at asc nulls first, j.created_at asc
  for update skip locked
  limit 1;

  if v_job_id is null then return; end if;

  return query
  update public.collector_jobs j
  set status='claimed',
      claimed_at=v_now,
      claimed_by=p_collector_id,
      lease_expires_at=v_now + make_interval(secs => greatest(30,coalesce(p_lease_seconds,300))),
      attempt_count=coalesce(j.attempt_count,0)+1,
      progress_json=coalesce(j.progress_json,'{}'::jsonb) || jsonb_build_object(
        'stage','claimed','percent',0,
        'detail','Claimed atomically by Collectish worker',
        'updatedAt',v_now
      )
  where j.job_id=v_job_id
  returning j.*;
end;
$function$;

revoke all on function public.claim_collector_job(text,text,text[],text,uuid,integer) from public, anon;
grant execute on function public.claim_collector_job(text,text,text[],text,uuid,integer) to authenticated, service_role;
