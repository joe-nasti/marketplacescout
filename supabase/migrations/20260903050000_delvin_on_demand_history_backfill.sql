create table if not exists public.delvin_history_backfill_jobs (
  job_id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  job_type text not null default 'tcgcsv_collectible_cohort',
  treatment text not null,
  set_codes text[] not null default '{}',
  product_ids bigint[] not null default '{}',
  group_ids integer[] not null default '{}',
  desired_start_date date not null,
  desired_end_date date not null default current_date,
  sample_every_days integer not null default 7 check(sample_every_days between 1 and 31),
  status text not null default 'queued' check(status in ('queued','running','ready','partial','failed')),
  coverage_before_start date,
  coverage_after_start date,
  coverage_after_end date,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0,
  progress jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  updated_at timestamptz not null default now()
);
create index if not exists delvin_history_backfill_jobs_status_idx on public.delvin_history_backfill_jobs(status,requested_at);

create table if not exists public.delvin_history_backfill_subscriptions (
  subscription_id bigserial primary key,
  job_id uuid not null references public.delvin_history_backfill_jobs(job_id) on delete cascade,
  surface text not null check(surface in ('discord','app')),
  discord_user_id text,
  discord_guild_id text,
  discord_channel_id text,
  discord_thread_id text,
  collectish_user_id uuid references auth.users(id) on delete cascade,
  ask_session_id text,
  original_question text,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  delivery_status text not null default 'pending' check(delivery_status in ('pending','claimed','sent','failed')),
  delivery_claimed_at timestamptz,
  delivery_error text
);
create index if not exists delvin_history_backfill_subscriptions_pending_idx on public.delvin_history_backfill_subscriptions(delivery_status,created_at);
create unique index if not exists delvin_history_backfill_subscriptions_discord_uq on public.delvin_history_backfill_subscriptions(job_id,surface,discord_user_id,discord_channel_id) where surface='discord';
create unique index if not exists delvin_history_backfill_subscriptions_app_uq on public.delvin_history_backfill_subscriptions(job_id,surface,collectish_user_id,coalesce(ask_session_id,'')) where surface='app';

alter table public.delvin_history_backfill_jobs enable row level security;
alter table public.delvin_history_backfill_subscriptions enable row level security;

do $$ begin
  create policy delvin_history_backfill_app_read on public.delvin_history_backfill_jobs for select to authenticated using (
    exists(select 1 from public.delvin_history_backfill_subscriptions s where s.job_id=delvin_history_backfill_jobs.job_id and s.surface='app' and s.collectish_user_id=auth.uid())
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy delvin_history_backfill_app_sub_read on public.delvin_history_backfill_subscriptions for select to authenticated using(surface='app' and collectish_user_id=auth.uid());
exception when duplicate_object then null; end $$;

create or replace function public.ensure_delvin_collectible_history_v1(
  p_treatment text,
  p_set_codes text[] default null,
  p_surface text default 'app',
  p_original_question text default null,
  p_discord_user_id text default null,
  p_discord_guild_id text default null,
  p_discord_channel_id text default null,
  p_discord_thread_id text default null,
  p_collectish_user_id uuid default null,
  p_ask_session_id text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_sets text[] := coalesce((select array_agg(distinct upper(x) order by upper(x)) from unnest(coalesce(p_set_codes,'{}'::text[])) x),'{}'::text[]);
  v_products bigint[]; v_groups integer[]; v_release date; v_have date; v_desired date; v_fingerprint text; v_job public.delvin_history_backfill_jobs%rowtype;
  v_surface text:=lower(trim(coalesce(p_surface,'app'))); v_uid uuid:=coalesce(p_collectish_user_id,auth.uid());
begin
  if v_surface not in ('discord','app') then return jsonb_build_object('ok',false,'error','Unsupported surface.'); end if;
  if v_surface='discord' and nullif(trim(coalesce(p_discord_user_id,'')),'') is null then return jsonb_build_object('ok',false,'error','Discord user id required.'); end if;
  if v_surface='app' and v_uid is null then return jsonb_build_object('ok',false,'error','Collectish user required for app notification.'); end if;

  select array_agg(distinct c.product_id::bigint order by c.product_id::bigint)
    into v_products
  from public.scout_opportunities_v5_cache c
  where c.product_id ~ '^[0-9]+$'
    and lower(coalesce(c.condition,'')) in ('near mint','nm') and lower(coalesce(c.language,''))='english'
    and public.delvin_treatment_label_v1(c.product_name,c.set_code,c.collector_number,c.printing)=p_treatment
    and (cardinality(v_sets)=0 or upper(c.set_code)=any(v_sets));
  if coalesce(cardinality(v_products),0)=0 then return jsonb_build_object('ok',false,'error','No matching cohort products found.'); end if;

  if cardinality(v_sets)>0 then
    select min(released_at),array_agg(distinct tcgplayer_group_id order by tcgplayer_group_id) filter(where tcgplayer_group_id is not null)
      into v_release,v_groups from public.magic_set_catalog where upper(code)=any(v_sets);
  else
    select array_agg(distinct group_id order by group_id) filter(where group_id is not null) into v_groups from public.tcgcsv_tcgplayer_prices where product_id=any(v_products);
  end if;
  v_desired:=greatest(date '2024-02-08',coalesce(v_release,current_date-365));
  select min(observed_on) into v_have from public.tcgcsv_tcgplayer_prices where product_id=any(v_products);
  if v_have is not null and v_have<=v_desired+14 then
    return jsonb_build_object('ok',true,'status','ready','needs_backfill',false,'coverage_start',v_have,'desired_start',v_desired,'product_count',cardinality(v_products));
  end if;

  v_fingerprint:=md5(lower(p_treatment)||'|'||array_to_string(v_sets,',')||'|'||v_desired::text||'|'||current_date::text);
  insert into public.delvin_history_backfill_jobs(fingerprint,treatment,set_codes,product_ids,group_ids,desired_start_date,desired_end_date,coverage_before_start)
  values(v_fingerprint,p_treatment,v_sets,v_products,coalesce(v_groups,'{}'::integer[]),v_desired,current_date,v_have)
  on conflict(fingerprint) do update set updated_at=now()
  returning * into v_job;

  if v_surface='discord' then
    insert into public.delvin_history_backfill_subscriptions(job_id,surface,discord_user_id,discord_guild_id,discord_channel_id,discord_thread_id,original_question)
    values(v_job.job_id,'discord',p_discord_user_id,p_discord_guild_id,p_discord_channel_id,p_discord_thread_id,p_original_question)
    on conflict do nothing;
  else
    insert into public.delvin_history_backfill_subscriptions(job_id,surface,collectish_user_id,ask_session_id,original_question)
    values(v_job.job_id,'app',v_uid,p_ask_session_id,p_original_question)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok',true,'status',v_job.status,'needs_backfill',true,'job_id',v_job.job_id,'coverage_start',v_have,'desired_start',v_desired,'product_count',cardinality(v_products),'group_count',cardinality(coalesce(v_groups,'{}'::integer[])),'sample_every_days',v_job.sample_every_days,'eta_hint','usually a few minutes after a worker claims the job');
end $$;

create or replace function public.claim_delvin_history_backfill_job_v1() returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.delvin_history_backfill_jobs%rowtype;
begin
  select * into v from public.delvin_history_backfill_jobs where status='queued' order by requested_at for update skip locked limit 1;
  if v.job_id is null then return null; end if;
  update public.delvin_history_backfill_jobs set status='running',started_at=coalesce(started_at,now()),attempt_count=attempt_count+1,updated_at=now() where job_id=v.job_id returning * into v;
  return to_jsonb(v);
end $$;

create or replace function public.finish_delvin_history_backfill_job_v1(p_job_id uuid,p_status text,p_progress jsonb default '{}'::jsonb,p_result jsonb default '{}'::jsonb,p_error text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.delvin_history_backfill_jobs set status=p_status,progress=coalesce(p_progress,'{}'::jsonb),result=coalesce(p_result,'{}'::jsonb),error_message=p_error,
    coverage_after_start=(select min(observed_on) from public.tcgcsv_tcgplayer_prices where product_id=any(product_ids)),coverage_after_end=(select max(observed_on) from public.tcgcsv_tcgplayer_prices where product_id=any(product_ids)),completed_at=case when p_status in ('ready','partial','failed') then now() else completed_at end,updated_at=now()
  where job_id=p_job_id;
end $$;

create or replace function public.claim_delvin_history_ready_notifications_v1(p_limit integer default 20) returns setof public.delvin_history_backfill_subscriptions language plpgsql security definer set search_path=public as $$
begin
  return query with x as (
    select s.subscription_id from public.delvin_history_backfill_subscriptions s join public.delvin_history_backfill_jobs j on j.job_id=s.job_id
    where s.delivery_status='pending' and j.status in ('ready','partial','failed') and s.surface='discord'
    order by s.created_at for update of s skip locked limit greatest(1,least(coalesce(p_limit,20),100))
  ) update public.delvin_history_backfill_subscriptions s set delivery_status='claimed',delivery_claimed_at=now() from x where s.subscription_id=x.subscription_id returning s.*;
end $$;

create or replace function public.finish_delvin_history_ready_notification_v1(p_subscription_id bigint,p_ok boolean,p_error text default null) returns void language sql security definer set search_path=public as $$
 update public.delvin_history_backfill_subscriptions set delivery_status=case when p_ok then 'sent' else 'failed' end,notified_at=case when p_ok then now() else notified_at end,delivery_error=p_error where subscription_id=p_subscription_id;
$$;

revoke all on function public.claim_delvin_history_backfill_job_v1() from public,anon,authenticated;
revoke all on function public.finish_delvin_history_backfill_job_v1(uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.claim_delvin_history_ready_notifications_v1(integer) from public,anon,authenticated;
revoke all on function public.finish_delvin_history_ready_notification_v1(bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.ensure_delvin_collectible_history_v1(text,text[],text,text,text,text,text,text,uuid,text) to authenticated,service_role;
grant execute on function public.claim_delvin_history_backfill_job_v1() to service_role;
grant execute on function public.finish_delvin_history_backfill_job_v1(uuid,text,jsonb,jsonb,text) to service_role;
grant execute on function public.claim_delvin_history_ready_notifications_v1(integer) to service_role;
grant execute on function public.finish_delvin_history_ready_notification_v1(bigint,boolean,text) to service_role;
