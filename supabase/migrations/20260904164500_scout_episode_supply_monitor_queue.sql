-- Prioritize exact-SKU TCGplayer supply observations when Scout opens a new opportunity episode.
-- The hourly job is queue-only; the existing six-hour job continues bounded top-120 rotation.

create table if not exists public.market_supply_monitor_queue (
  queue_id bigint generated always as identity primary key,
  user_id uuid not null,
  sku_id text not null,
  product_id text not null,
  requested_at timestamptz not null default now(),
  episode_opened_at timestamptz not null,
  reason text not null default 'scout_episode_open',
  priority integer not null default 100,
  status text not null default 'PENDING' check (status in ('PENDING','CLAIMED','COMPLETED','FAILED')),
  claimed_at timestamptz,
  completed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists market_supply_monitor_queue_due_idx on public.market_supply_monitor_queue(status,priority desc,requested_at);
create index if not exists market_supply_monitor_queue_sku_time_idx on public.market_supply_monitor_queue(sku_id,requested_at desc);
create unique index if not exists market_supply_monitor_queue_one_pending_sku_idx on public.market_supply_monitor_queue(sku_id) where status in ('PENDING','CLAIMED');
alter table public.market_supply_monitor_queue enable row level security;
revoke all on public.market_supply_monitor_queue from public,anon,authenticated;
grant select,insert,update on public.market_supply_monitor_queue to service_role;

create or replace function public.enqueue_scout_episode_supply_observation_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actionable boolean;
  v_prev_actionable boolean:=false;
begin
  v_actionable := coalesce(new.flag,'PASS')='HOT'
    or (new.promoted_grade in ('A','B') and coalesce(new.flag,'PASS')<>'PASS');
  if not v_actionable or coalesce(new.sku_id,'')!~ '^\d+$' or coalesce(new.product_id,'')!~ '^\d+$' then
    return new;
  end if;

  select (coalesce(h.flag,'PASS')='HOT' or (h.promoted_grade in ('A','B') and coalesce(h.flag,'PASS')<>'PASS'))
    into v_prev_actionable
  from public.scout_evaluation_history h
  where h.user_id=new.user_id and h.sku_id=new.sku_id
    and (h.evaluated_at,h.id)<(new.evaluated_at,new.id)
  order by h.evaluated_at desc,h.id desc limit 1;

  if coalesce(v_prev_actionable,false) then return new; end if;

  insert into public.market_supply_monitor_queue(
    user_id,sku_id,product_id,episode_opened_at,reason,priority,metadata
  ) values(
    new.user_id,new.sku_id,new.product_id,new.evaluated_at,'scout_episode_open',100,
    jsonb_build_object(
      'evaluation_id',new.id,'grade',new.promoted_grade,'score',new.promoted_score,'flag',new.flag,
      'product_name',new.product_name,'set_code',new.set_code,'collector_number',new.collector_number,
      'printing',new.printing,'condition',new.condition,'language',new.language
    )
  )
  on conflict (sku_id) where status in ('PENDING','CLAIMED') do update set
    priority=greatest(public.market_supply_monitor_queue.priority,excluded.priority),
    requested_at=least(public.market_supply_monitor_queue.requested_at,excluded.requested_at),
    metadata=public.market_supply_monitor_queue.metadata||excluded.metadata;
  return new;
end;
$$;
revoke all on function public.enqueue_scout_episode_supply_observation_v1() from public,anon,authenticated;
grant execute on function public.enqueue_scout_episode_supply_observation_v1() to service_role;

drop trigger if exists scout_episode_supply_observation_enqueue on public.scout_evaluation_history;
create trigger scout_episode_supply_observation_enqueue
after insert on public.scout_evaluation_history
for each row execute function public.enqueue_scout_episode_supply_observation_v1();

create or replace function public.market_supply_monitor_targets_v1(p_limit integer default 40)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
with lim as (select greatest(1,least(coalesce(p_limit,40),60))::int n),
queued as (
  select q.queue_id,q.sku_id,q.product_id,q.requested_at,q.episode_opened_at,q.priority,q.metadata,
    coalesce(q.metadata->>'product_name',c.product_name) card_name,
    coalesce(q.metadata->>'set_code',c.set_code) set_code,
    coalesce(q.metadata->>'collector_number',c.collector_number) collector_number,
    coalesce(q.metadata->>'printing',c.printing) printing,
    coalesce(q.metadata->>'condition',c.condition,'Near Mint') condition,
    coalesce(q.metadata->>'language',c.language,'English') language,
    coalesce((q.metadata->>'score')::numeric,c.promoted_score,c.opportunity_score) promoted_score,
    coalesce(q.metadata->>'grade',c.promoted_grade) promoted_grade,
    c.direct_available,c.avg_daily_qty_sold,0 sort_lane,
    null::timestamptz last_observed_at,null::int observation_count
  from public.market_supply_monitor_queue q
  left join lateral (
    select x.* from public.scout_opportunities_v5_cache x where x.sku_id=q.sku_id order by x.computed_at desc nulls last limit 1
  ) c on true
  where q.status='PENDING'
  order by q.priority desc,q.requested_at
  limit (select n from lim)
), queued_count as (select count(*)::int n from queued),
ranked as (
  select distinct on (c.sku_id)
    c.sku_id,c.product_id,c.product_name,c.set_code,c.collector_number,c.printing,c.condition,c.language,
    c.promoted_score,c.promoted_grade,c.direct_available,c.avg_daily_qty_sold
  from public.scout_opportunities_v5_cache c
  where c.sku_id ~ '^\d+$' and c.product_id ~ '^\d+$'
    and coalesce(c.promoted_score,c.opportunity_score,0)>=70
    and upper(coalesce(c.condition,'NEAR MINT')) in ('NEAR MINT','LIGHTLY PLAYED')
    and upper(coalesce(c.language,'ENGLISH'))='ENGLISH'
  order by c.sku_id,coalesce(c.promoted_score,c.opportunity_score,0) desc,c.computed_at desc nulls last
), cohort as (
  select r.* from ranked r
  order by coalesce(r.promoted_score,0) desc,coalesce(r.avg_daily_qty_sold,0) desc,r.sku_id
  limit 120
), aged as (
  select c.*,s.last_observed_at,s.observation_count
  from cohort c
  left join lateral (
    select max(m.observed_at) last_observed_at,count(*)::int observation_count
    from public.market_supply_snapshots m
    where m.source='tcgplayer_marketplace' and m.sku_id=c.sku_id and m.coverage_state='COMPLETE'
  ) s on true
  where not exists(select 1 from queued q where q.sku_id=c.sku_id)
), rotating as (
  select null::bigint queue_id,a.sku_id,a.product_id,null::timestamptz requested_at,null::timestamptz episode_opened_at,0 priority,'{}'::jsonb metadata,
    a.product_name card_name,a.set_code,a.collector_number,a.printing,a.condition,a.language,a.promoted_score,a.promoted_grade,
    a.direct_available,a.avg_daily_qty_sold,1 sort_lane,a.last_observed_at,a.observation_count
  from aged a
  order by a.last_observed_at asc nulls first,coalesce(a.promoted_score,0) desc,a.sku_id
  limit greatest(0,(select n from lim)-(select n from queued_count))
), all_targets as (
  select * from queued union all select * from rotating
), packed as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'queue_id',queue_id,'product_id',product_id,'sku_id',sku_id,'card_name',card_name,'set_code',set_code,'collector_number',collector_number,
    'printing',printing,'condition',condition,'language',language,'promoted_score',promoted_score,'promoted_grade',promoted_grade,
    'direct_available',direct_available,'avg_daily_qty_sold',avg_daily_qty_sold,'episode_opened_at',episode_opened_at,
    'target_reason',case when queue_id is not null then 'SCOUT_EPISODE_OPEN' else 'ROTATING_COHORT' end,
    'last_supply_observed_at',last_observed_at,'supply_observation_count',coalesce(observation_count,0)
  ) order by sort_lane,priority desc,requested_at nulls last,last_observed_at asc nulls first),'[]'::jsonb) targets,
  count(*)::int target_count,
  count(*) filter(where queue_id is not null)::int queued_target_count,
  count(*) filter(where queue_id is null)::int rotating_target_count
  from all_targets
)
select case when coalesce(auth.role(),'')<>'service_role'
  then jsonb_build_object('available',false,'error','service role required')
  else jsonb_build_object(
    'available',true,'scope','EPISODE_QUEUE_THEN_SCOUT_TOP_120_ROTATION','target_count',p.target_count,
    'queued_target_count',p.queued_target_count,'rotating_target_count',p.rotating_target_count,'targets',p.targets,
    'note','New Scout episode openings are observed first; remaining capacity rotates through the top-120 English NM/LP cohort. Queueing is exact-SKU and bounded, not catalog-wide.'
  ) end
from packed p;
$$;
revoke all on function public.market_supply_monitor_targets_v1(integer) from public,anon,authenticated;
grant execute on function public.market_supply_monitor_targets_v1(integer) to service_role;

create or replace function public.market_supply_episode_queue_targets_v1(p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
with picked as (
  select q.queue_id,q.sku_id,q.product_id,q.requested_at,q.episode_opened_at,q.priority,q.metadata,
    coalesce(q.metadata->>'product_name',c.product_name) card_name,
    coalesce(q.metadata->>'set_code',c.set_code) set_code,
    coalesce(q.metadata->>'collector_number',c.collector_number) collector_number,
    coalesce(q.metadata->>'printing',c.printing) printing,
    coalesce(q.metadata->>'condition',c.condition,'Near Mint') condition,
    coalesce(q.metadata->>'language',c.language,'English') language,
    coalesce((q.metadata->>'score')::numeric,c.promoted_score,c.opportunity_score) promoted_score,
    coalesce(q.metadata->>'grade',c.promoted_grade) promoted_grade,
    c.direct_available,c.avg_daily_qty_sold
  from public.market_supply_monitor_queue q
  left join lateral (
    select x.* from public.scout_opportunities_v5_cache x where x.sku_id=q.sku_id order by x.computed_at desc nulls last limit 1
  ) c on true
  where q.status='PENDING'
  order by q.priority desc,q.requested_at
  limit greatest(1,least(coalesce(p_limit,20),40))
), packed as (
  select count(*)::int target_count,
    coalesce(jsonb_agg(jsonb_build_object(
      'queue_id',queue_id,'product_id',product_id,'sku_id',sku_id,'card_name',card_name,'set_code',set_code,'collector_number',collector_number,
      'printing',printing,'condition',condition,'language',language,'promoted_score',promoted_score,'promoted_grade',promoted_grade,
      'direct_available',direct_available,'avg_daily_qty_sold',avg_daily_qty_sold,'episode_opened_at',episode_opened_at,
      'target_reason','SCOUT_EPISODE_OPEN'
    ) order by priority desc,requested_at),'[]'::jsonb) targets
  from picked
)
select case when coalesce(auth.role(),'')<>'service_role'
  then jsonb_build_object('available',false,'error','service role required')
  else jsonb_build_object(
    'available',true,'scope','SCOUT_EPISODE_QUEUE_ONLY','target_count',target_count,
    'queued_target_count',target_count,'rotating_target_count',0,'targets',targets,
    'note','Queue-only exact-SKU Scout episode observations. Returns no rotating cohort targets when the queue is empty.'
  ) end
from packed;
$$;
revoke all on function public.market_supply_episode_queue_targets_v1(integer) from public,anon,authenticated;
grant execute on function public.market_supply_episode_queue_targets_v1(integer) to service_role;

insert into public.data_preservation_registry(
  table_name,data_class,preservation_tier,minimum_granularity,future_features,
  authoritative_source,can_rebuild,destructive_change_blocked,notes,reviewed_at
) values(
  'market_supply_monitor_queue','operational','REBUILDABLE','One pending exact-SKU observation request per currently queued SKU',
  array['Scout episode entry supply capture']::text[],false,true,true,
  'Operational bounded queue linking new Scout opportunity episodes to near-entry TCGplayer marketplace supply observations.',now()
)
on conflict(table_name) do update set preservation_tier='REBUILDABLE',destructive_change_blocked=true,reviewed_at=now();

do $$ declare j bigint; begin
  select jobid into j from cron.job where jobname='market-supply-episode-queue-hourly' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
end $$;
select cron.schedule(
  'market-supply-episode-queue-hourly','5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://bnsnlikjeogzdubgyvxk.supabase.co/functions/v1/market-supply-monitor',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-collectish-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='tcgplayer_price_cron' limit 1)
    ),
    body := '{"limit":20,"max_pages":40,"queue_only":true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
notify pgrst,'reload schema';
