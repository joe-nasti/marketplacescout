create table if not exists public.delvin_query_registry (
  query_key text primary key,
  prompt text not null,
  category text not null default 'market',
  aliases text[] not null default '{}',
  ttl_seconds integer not null default 600 check (ttl_seconds between 60 and 86400),
  sort_order integer not null default 100,
  enabled boolean not null default true,
  followups jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.delvin_query_registry enable row level security;

create table if not exists public.delvin_query_cache (
  query_key text primary key references public.delvin_query_registry(query_key) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  source_watermarks jsonb not null default '{}'::jsonb,
  refresh_ms integer,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.delvin_query_cache enable row level security;
create index if not exists delvin_query_cache_expires_idx on public.delvin_query_cache(expires_at);

insert into public.delvin_query_registry(query_key,prompt,category,aliases,ttl_seconds,sort_order,followups) values
('mtgstocks_interests_both','What are the top MTGStocks Interests today?','source',array['top mtgstocks interests','mtgstocks interests today'],900,10,'["What cards suddenly started selling faster?","What Direct cards are getting tight?"]'::jsonb),
('tcgplayer_climbing','What TCGplayer cards are climbing in price?','source',array['tcgplayer climbing','tcgplayer price trends'],3600,20,'["What cards suddenly started selling faster?","What cards are mispriced across markets today?"]'::jsonb),
('sales_acceleration','What cards suddenly started selling faster?','market',array['sales acceleration','selling faster'],300,30,'["What cards are seeing sales acceleration before the price moves?","What Direct cards are getting tight?"]'::jsonb),
('sales_acceleration_price_lag','What cards are seeing sales acceleration before the price moves?','market',array['price lag sales acceleration','selling faster before price moves'],300,40,'["What cards suddenly started selling faster?","What cards are mispriced across markets today?"]'::jsonb),
('direct_pressure_7d','What Direct cards are getting tight?','market',array['direct pressure','direct getting tight'],300,50,'["What cards suddenly started selling faster?","What cards are mispriced across markets today?"]'::jsonb),
('direct_pressure_24h','What Direct cards got tight today?','market',array['direct pressure today','direct tight 24h'],300,60,'["What Direct cards are getting tight?","What cards suddenly started selling faster?"]'::jsonb),
('cross_market_dislocations','What cards are mispriced across markets today?','market',array['cross market opportunities','mispriced across markets'],600,70,'["What Direct cards are getting tight?","What cards suddenly started selling faster?"]'::jsonb)
on conflict(query_key) do update set prompt=excluded.prompt,category=excluded.category,aliases=excluded.aliases,ttl_seconds=excluded.ttl_seconds,sort_order=excluded.sort_order,followups=excluded.followups,updated_at=now();

create or replace function public.refresh_delvin_query_cache_v1(p_query_key text default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; v_payload jsonb; v_start timestamptz; v_ms integer; refreshed jsonb:='[]'::jsonb; skipped jsonb:='[]'::jsonb; failed jsonb:='[]'::jsonb;
begin
  for r in select q.*,c.expires_at from delvin_query_registry q left join delvin_query_cache c using(query_key) where q.enabled and (p_query_key is null or q.query_key=p_query_key) order by q.sort_order,q.query_key loop
    if not p_force and r.expires_at is not null and r.expires_at>now() then skipped:=skipped||to_jsonb(r.query_key); continue; end if;
    v_start:=clock_timestamp();
    begin
      v_payload:=case r.query_key
        when 'mtgstocks_interests_both' then public.ask_mtgstocks_interests_vetted_all_v1(null,'average','24h',80)
        when 'tcgplayer_climbing' then public.ask_tcgplayer_climbing_v1(80)
        when 'sales_acceleration' then public.ask_sales_acceleration_v1(3,28,80,null,false)
        when 'sales_acceleration_price_lag' then public.ask_sales_acceleration_v1(3,28,80,null,true)
        when 'direct_pressure_7d' then public.ask_direct_pressure_v1(7,80,0.25)
        when 'direct_pressure_24h' then public.ask_direct_pressure_v1(1,80,0.25)
        when 'cross_market_dislocations' then public.ask_cross_market_dislocations_v1(80,0.25,1,10)
        else '{}'::jsonb end;
      v_ms:=greatest(0,round(extract(epoch from (clock_timestamp()-v_start))*1000)::integer);
      insert into delvin_query_cache(query_key,payload,generated_at,expires_at,source_watermarks,refresh_ms,last_error,updated_at)
      values(r.query_key,v_payload,now(),now()+make_interval(secs=>r.ttl_seconds),jsonb_build_object('refreshed_at',now()),v_ms,null,now())
      on conflict(query_key) do update set payload=excluded.payload,generated_at=excluded.generated_at,expires_at=excluded.expires_at,source_watermarks=excluded.source_watermarks,refresh_ms=excluded.refresh_ms,last_error=null,updated_at=now();
      refreshed:=refreshed||jsonb_build_object('query_key',r.query_key,'refresh_ms',v_ms);
    exception when others then
      insert into delvin_query_cache(query_key,payload,generated_at,expires_at,last_error,updated_at) values(r.query_key,'{}'::jsonb,now(),now()+interval '2 minutes',sqlerrm,now()) on conflict(query_key) do update set expires_at=now()+interval '2 minutes',last_error=sqlerrm,updated_at=now();
      failed:=failed||jsonb_build_object('query_key',r.query_key,'error',sqlerrm);
    end;
  end loop;
  return jsonb_build_object('refreshed',refreshed,'skipped',skipped,'failed',failed,'at',now());
end $$;

create or replace function public.get_delvin_query_cache_v1(p_query_key text)
returns jsonb language sql stable security definer set search_path=public as $$
select coalesce((select jsonb_build_object('query_key',q.query_key,'prompt',q.prompt,'category',q.category,'payload',c.payload,'generated_at',c.generated_at,'expires_at',c.expires_at,'stale',(c.expires_at<=now()),'refresh_ms',c.refresh_ms,'last_error',c.last_error,'followups',q.followups) from delvin_query_registry q left join delvin_query_cache c using(query_key) where q.query_key=p_query_key and q.enabled),'{}'::jsonb)
$$;

create or replace function public.list_delvin_query_starters_v1(p_search text default null,p_limit integer default 12)
returns jsonb language sql stable security definer set search_path=public as $$
select coalesce(jsonb_agg(jsonb_build_object('query_key',q.query_key,'prompt',q.prompt,'category',q.category,'warm',(c.payload is not null),'stale',coalesce(c.expires_at<=now(),true),'generated_at',c.generated_at) order by case when c.expires_at>now() then 0 else 1 end,q.sort_order,q.query_key),'[]'::jsonb)
from delvin_query_registry q left join delvin_query_cache c using(query_key)
where q.enabled and (nullif(trim(coalesce(p_search,'')),'') is null or q.prompt ilike '%'||p_search||'%' or exists(select 1 from unnest(q.aliases) a where a ilike '%'||p_search||'%'))
limit greatest(1,least(coalesce(p_limit,12),25))
$$;

select public.refresh_delvin_query_cache_v1(null,true);

do $$ declare j bigint; begin
  select jobid into j from cron.job where jobname='delvin-query-cache-refresh' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule('delvin-query-cache-refresh','*/5 * * * *','select public.refresh_delvin_query_cache_v1(null,false);');
end $$;

grant execute on function public.get_delvin_query_cache_v1(text) to service_role;
grant execute on function public.list_delvin_query_starters_v1(text,integer) to service_role;
grant execute on function public.refresh_delvin_query_cache_v1(text,boolean) to service_role;
