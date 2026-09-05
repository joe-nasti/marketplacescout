create or replace function public.claim_syp_collector_job(
  p_collector_id uuid,
  p_lease_seconds integer default 300
)
returns setof public.collector_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
      where c.user_id=v_uid and c.collector_id=p_collector_id
    ) then return; end if;
  end if;

  select j.job_id into v_job_id
  from public.collector_jobs j
  where (
      (j.status='queued' and coalesce(j.available_at,v_now)<=v_now)
      or
      (j.status='claimed' and j.lease_expires_at is not null and j.lease_expires_at<=v_now-interval '2 minutes')
    )
    and coalesce(j.attempt_count,0)<coalesce(j.max_attempts,5)
    and (v_role='service_role' or j.user_id=v_uid)
    and j.source='agent'
    and j.action='seller_portal_readonly_probe'
    and j.preferred_executor='android_agent'
    and j.required_capability='tcgplayer_authenticated_session'
    and j.payload_json->>'sypKind' in ('last_updated','export')
  order by j.priority asc,j.available_at asc nulls first,j.created_at asc
  for update skip locked
  limit 1;

  if v_job_id is null then return; end if;

  return query
  update public.collector_jobs j
  set status='claimed',
      claimed_at=v_now,
      claimed_by=p_collector_id,
      lease_expires_at=v_now+make_interval(secs=>greatest(30,coalesce(p_lease_seconds,300))),
      attempt_count=coalesce(j.attempt_count,0)+1,
      progress_json=coalesce(j.progress_json,'{}'::jsonb)||jsonb_build_object(
        'stage','claimed','percent',0,
        'detail','Claimed atomically by native SYP worker',
        'updatedAt',v_now,
        'claimant','android-native-syp'
      )
  where j.job_id=v_job_id
  returning j.*;
end;
$$;

create or replace function public.finish_syp_collector_job(
  p_job_id uuid,
  p_collector_id uuid,
  p_success boolean,
  p_detail text,
  p_probe jsonb default '{}'::jsonb,
  p_probe_state text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := auth.role();
  v_uid uuid := auth.uid();
  v_job public.collector_jobs%rowtype;
  v_now timestamptz := now();
begin
  select * into v_job
  from public.collector_jobs j
  where j.job_id=p_job_id
    and j.source='agent'
    and j.action='seller_portal_readonly_probe'
    and j.preferred_executor='android_agent'
    and j.required_capability='tcgplayer_authenticated_session'
    and j.payload_json->>'sypKind' in ('last_updated','export')
  for update;

  if not found then return false; end if;
  if coalesce(v_role,'') <> 'service_role' and (v_uid is null or v_job.user_id<>v_uid) then return false; end if;
  if v_job.status not in ('claimed','running') or v_job.claimed_by is distinct from p_collector_id then return false; end if;

  update public.collector_jobs
  set status=case when p_success then 'completed' else 'failed' end,
      completed_at=v_now,
      lease_expires_at=null,
      progress_json=jsonb_build_object(
        'stage',case when p_success then 'completed' else 'failed' end,
        'percent',100,
        'detail',left(coalesce(p_detail,''),1000),
        'updatedAt',v_now,
        'readOnlyProbe',coalesce(p_probe,'{}'::jsonb),
        'probeState',coalesce(p_probe_state,case when p_success then 'ready' else 'error' end),
        'claimant','android-native-syp'
      ),
      error_message=case when p_success then null else left(coalesce(p_detail,'Native SYP probe failed'),2000) end
  where job_id=p_job_id;

  insert into public.collector_job_events(job_id,user_id,event_type,collector_id,progress_json,message,metadata_json)
  values(
    p_job_id,v_job.user_id,case when p_success then 'completed' else 'failed' end,p_collector_id,
    jsonb_build_object('stage',case when p_success then 'completed' else 'failed' end,'percent',100,'detail',left(coalesce(p_detail,''),1000),'updatedAt',v_now,'probeState',coalesce(p_probe_state,case when p_success then 'ready' else 'error' end)),
    left(coalesce(p_detail,''),1000),
    jsonb_build_object('platform','android','agentVersion','native-syp-v1','probeState',coalesce(p_probe_state,case when p_success then 'ready' else 'error' end),'claimant','android-native-syp')
  );
  return true;
end;
$$;

create or replace function public.heartbeat_syp_collector(
  p_collector_id uuid,
  p_app_version text,
  p_session_state text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := auth.role();
  v_uid uuid := auth.uid();
  v_auth boolean := lower(coalesce(p_session_state,''))='authenticated';
  v_now timestamptz := now();
begin
  if coalesce(v_role,'') <> 'service_role' and v_uid is null then return false; end if;
  if coalesce(v_role,'') <> 'service_role' then
    insert into public.collectors(user_id,collector_id,name,collector_type,platform,last_seen_at,status,app_version,capabilities_json,session_health_json,metadata_json)
    values(v_uid,p_collector_id,'Collectish Android','mobile_agent','android',v_now,'online',left(coalesce(p_app_version,'unknown'),80),
      jsonb_build_object('tcgplayer_authenticated_session',v_auth,'authenticated_agent',true,'android_agent',true,'seller_portal_readonly_probe',v_auth,'native_syp_worker',true),
      jsonb_build_object('authenticated',v_auth,'state',coalesce(p_session_state,'unknown'),'checkedAt',v_now,'provider','tcgplayer'),
      jsonb_build_object('executionRole','android_agent','claimant','android-native-syp'))
    on conflict(user_id,collector_id) do update set
      last_seen_at=excluded.last_seen_at,status='online',app_version=excluded.app_version,
      capabilities_json=coalesce(public.collectors.capabilities_json,'{}'::jsonb)||excluded.capabilities_json,
      session_health_json=excluded.session_health_json,
      metadata_json=coalesce(public.collectors.metadata_json,'{}'::jsonb)||excluded.metadata_json;
  else
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_syp_collector_job(uuid,integer) from public,anon;
grant execute on function public.claim_syp_collector_job(uuid,integer) to authenticated,service_role;
revoke all on function public.finish_syp_collector_job(uuid,uuid,boolean,text,jsonb,text) from public,anon;
grant execute on function public.finish_syp_collector_job(uuid,uuid,boolean,text,jsonb,text) to authenticated,service_role;
revoke all on function public.heartbeat_syp_collector(uuid,text,text) from public,anon;
grant execute on function public.heartbeat_syp_collector(uuid,text,text) to authenticated;
