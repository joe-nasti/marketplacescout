-- User-owned Delvin watches. Shared market state is evaluated centrally; Discord is a delivery target.
create table if not exists public.delvin_user_watches (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, prompt text not null,
  rule_type text not null check (rule_type in ('syp_direct_tight','price_lag_confirmed')),
  rule_json jsonb not null default '{}'::jsonb, enabled boolean not null default true,
  cooldown_minutes integer not null default 360 check (cooldown_minutes between 30 and 43200),
  delivery_type text not null default 'discord' check (delivery_type in ('discord','in_app')),
  discord_guild_id text, discord_channel_id text, discord_thread_id text,
  last_triggered_at timestamptz, last_match_fingerprint text, last_match_count integer not null default 0,
  last_evaluated_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists delvin_user_watches_user_enabled_idx on public.delvin_user_watches(user_id,enabled);
create table if not exists public.delvin_user_watch_events (
  id bigserial primary key, watch_id uuid not null references public.delvin_user_watches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, fingerprint text not null,
  matched_at timestamptz not null default now(), match_count integer not null default 0,
  matches jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','delivered','suppressed','failed')),
  processing_at timestamptz, delivered_at timestamptz, delivery_error text, created_at timestamptz not null default now(),
  unique(watch_id,fingerprint)
);
create index if not exists delvin_user_watch_events_user_idx on public.delvin_user_watch_events(user_id,matched_at desc);
alter table public.delvin_user_watches enable row level security;
alter table public.delvin_user_watch_events enable row level security;
drop policy if exists delvin_user_watches_own on public.delvin_user_watches;
create policy delvin_user_watches_own on public.delvin_user_watches for all using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists delvin_user_watch_events_own on public.delvin_user_watch_events;
create policy delvin_user_watch_events_own on public.delvin_user_watch_events for select using ((select auth.uid())=user_id);
grant select,insert,update,delete on public.delvin_user_watches to authenticated;
grant select on public.delvin_user_watch_events to authenticated;
grant all on public.delvin_user_watches,public.delvin_user_watch_events to service_role;
grant usage,select on sequence public.delvin_user_watch_events_id_seq to service_role;

create or replace function public.create_delvin_watch_from_discord_v1(p_discord_user_id text,p_prompt text,p_guild_id text default null,p_channel_id text default null,p_thread_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid; v_rule text; v_name text; v_rule_json jsonb; v_id uuid; s text:=lower(coalesce(p_prompt,''));
begin
 select user_id into v_user from public.discord_collectish_links where discord_user_id=p_discord_user_id limit 1;
 if v_user is null then return jsonb_build_object('ok',false,'link_required',true,'error','Link your Collectish account before creating a persistent watch.'); end if;
 if s ~ 'syp' and s ~ '(direct|cover)' then v_rule:='syp_direct_tight'; v_name:='SYP + tight Direct'; v_rule_json:=jsonb_build_object('max_direct_cover_days',2,'require_appetite_up',true);
 elsif s ~ '(sales|selling)' and s ~ '(before.*price|price.*move|price lag)' and s ~ '(confirm|another signal|corrobor)' then v_rule:='price_lag_confirmed'; v_name:='Price-lag confirmation'; v_rule_json:=jsonb_build_object('max_price_change_pct',10,'min_other_signals',1);
 else return jsonb_build_object('ok',false,'unsupported',true,'error','I can currently save SYP + tight Direct watches and sales-acceleration-before-price + confirmation watches.'); end if;
 insert into public.delvin_user_watches(user_id,name,prompt,rule_type,rule_json,delivery_type,discord_guild_id,discord_channel_id,discord_thread_id)
 values(v_user,v_name,p_prompt,v_rule,v_rule_json,'discord',p_guild_id,p_channel_id,p_thread_id) returning id into v_id;
 return jsonb_build_object('ok',true,'watch_id',v_id,'name',v_name,'rule_type',v_rule,'rule',v_rule_json,'delivery','discord');
end $$;
revoke all on function public.create_delvin_watch_from_discord_v1(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_delvin_watch_from_discord_v1(text,text,text,text,text) to service_role;

create or replace function public.list_delvin_watches_for_discord_v1(p_discord_user_id text) returns jsonb language sql stable security definer set search_path=public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'prompt',w.prompt,'rule_type',w.rule_type,'rule',w.rule_json,'enabled',w.enabled,'cooldown_minutes',w.cooldown_minutes,'last_triggered_at',w.last_triggered_at,'last_match_count',w.last_match_count,'created_at',w.created_at) order by w.created_at desc),'[]'::jsonb)
from public.delvin_user_watches w join public.discord_collectish_links l on l.user_id=w.user_id where l.discord_user_id=p_discord_user_id;
$$;
revoke all on function public.list_delvin_watches_for_discord_v1(text) from public,anon,authenticated;
grant execute on function public.list_delvin_watches_for_discord_v1(text) to service_role;

create or replace function public.evaluate_delvin_user_watches_v1(p_watch_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare w record; v_matches jsonb; v_fp text; v_count int; v_event bigint; v_now timestamptz:=now(); v_created jsonb:='[]'::jsonb; v_suppressed jsonb:='[]'::jsonb;
begin
 for w in select * from public.delvin_user_watches where enabled and (p_watch_id is null or id=p_watch_id) loop
  if w.rule_type='syp_direct_tight' then
   select coalesce(jsonb_agg(x order by coalesce((x->>'importance_score')::numeric,0) desc),'[]'::jsonb) into v_matches
   from public.delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x
   where c.query_key='syp_pressure_7d' and x->>'syp_direction'='appetite_up' and coalesce((x->>'days_of_direct_cover')::numeric,999)<coalesce((w.rule_json->>'max_direct_cover_days')::numeric,2);
  else
   with lag as (select x,coalesce(nullif(x->>'sku_id',''),nullif(x->>'product_id','')) k from public.delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x where c.query_key='sales_acceleration_price_lag'),
   other as (select coalesce(nullif(x->>'sku_id',''),nullif(x->>'product_id','')) k,src from (values ('direct_pressure_7d'),('syp_pressure_7d'),('cross_market_dislocations'),('edh_demand_7d'),('creator_catalysts_7d')) q(src) join public.delvin_query_cache c on c.query_key=q.src cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x),
   g as (select lag.x,count(distinct other.src) other_signals,array_agg(distinct other.src) sources from lag join other using(k) where lag.k is not null group by lag.x having count(distinct other.src)>=coalesce((w.rule_json->>'min_other_signals')::int,1))
   select coalesce(jsonb_agg(x||jsonb_build_object('confirming_sources',to_jsonb(sources),'other_signal_count',other_signals) order by other_signals desc),'[]'::jsonb) into v_matches from g;
  end if;
  v_count:=jsonb_array_length(v_matches); v_fp:=encode(digest(coalesce(v_matches,'[]'::jsonb)::text,'sha256'),'hex');
  update public.delvin_user_watches set last_evaluated_at=v_now,last_match_count=v_count,updated_at=v_now where id=w.id;
  if v_count=0 then continue; end if;
  if w.last_match_fingerprint=v_fp or (w.last_triggered_at is not null and w.last_triggered_at>v_now-make_interval(mins=>w.cooldown_minutes)) then v_suppressed:=v_suppressed||jsonb_build_object('watch_id',w.id,'matches',v_count); continue; end if;
  insert into public.delvin_user_watch_events(watch_id,user_id,fingerprint,match_count,matches,status) values(w.id,w.user_id,v_fp,v_count,v_matches,'pending') on conflict(watch_id,fingerprint) do nothing returning id into v_event;
  if v_event is not null then update public.delvin_user_watches set last_triggered_at=v_now,last_match_fingerprint=v_fp,updated_at=v_now where id=w.id; v_created:=v_created||jsonb_build_object('watch_id',w.id,'event_id',v_event,'matches',v_count,'delivery_type',w.delivery_type,'discord_guild_id',w.discord_guild_id,'discord_channel_id',w.discord_channel_id,'discord_thread_id',w.discord_thread_id); end if; v_event:=null;
 end loop;
 return jsonb_build_object('at',v_now,'created',v_created,'suppressed',v_suppressed);
end $$;
revoke all on function public.evaluate_delvin_user_watches_v1(uuid) from public,anon,authenticated;
grant execute on function public.evaluate_delvin_user_watches_v1(uuid) to service_role;

create or replace function public.claim_delvin_watch_events_v1(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_rows jsonb; begin
 with picked as (select e.id from public.delvin_user_watch_events e join public.delvin_user_watches w on w.id=e.watch_id where e.status='pending' and w.enabled and w.delivery_type='discord' and w.discord_channel_id is not null order by e.matched_at for update skip locked limit greatest(1,least(coalesce(p_limit,20),50))),
 upd as (update public.delvin_user_watch_events e set status='processing',processing_at=now() from picked p where e.id=p.id returning e.*)
 select coalesce(jsonb_agg(jsonb_build_object('event_id',u.id,'watch_id',u.watch_id,'user_id',u.user_id,'matched_at',u.matched_at,'match_count',u.match_count,'matches',u.matches,'watch_name',w.name,'prompt',w.prompt,'rule_type',w.rule_type,'discord_guild_id',w.discord_guild_id,'discord_channel_id',w.discord_channel_id,'discord_thread_id',w.discord_thread_id) order by u.matched_at),'[]'::jsonb) into v_rows from upd u join public.delvin_user_watches w on w.id=u.watch_id; return v_rows; end $$;
revoke all on function public.claim_delvin_watch_events_v1(integer) from public,anon,authenticated; grant execute on function public.claim_delvin_watch_events_v1(integer) to service_role;
create or replace function public.finish_delvin_watch_event_v1(p_event_id bigint,p_ok boolean,p_error text default null) returns void language sql security definer set search_path=public as $$ update public.delvin_user_watch_events set status=case when p_ok then 'delivered' else 'failed' end,delivered_at=case when p_ok then now() else delivered_at end,delivery_error=case when p_ok then null else left(coalesce(p_error,'delivery failed'),1000) end where id=p_event_id and status='processing'; $$;
revoke all on function public.finish_delvin_watch_event_v1(bigint,boolean,text) from public,anon,authenticated; grant execute on function public.finish_delvin_watch_event_v1(bigint,boolean,text) to service_role;
create or replace function public.requeue_stale_delvin_watch_events_v1() returns integer language plpgsql security definer set search_path=public as $$ declare n int; begin update public.delvin_user_watch_events set status='pending',processing_at=null where status='processing' and processing_at<now()-interval '15 minutes'; get diagnostics n=row_count; return n; end $$;
revoke all on function public.requeue_stale_delvin_watch_events_v1() from public,anon,authenticated; grant execute on function public.requeue_stale_delvin_watch_events_v1() to service_role;
select cron.unschedule(jobid) from cron.job where jobname='delvin-user-watch-evaluation';
select cron.schedule('delvin-user-watch-evaluation','*/5 * * * *',$cron$select public.evaluate_delvin_user_watches_v1(null);$cron$);
