-- Maintain one current demand row per card name instead of re-scanning demand history.
-- Production migration: scout_refresh_current_demand

create table if not exists public.marketplace_product_demand_current (
  user_id uuid not null,
  product_name text not null,
  demand_adjustment numeric not null default 0,
  demand_signal text,
  demand_signal_score numeric,
  demand_sources jsonb not null default '{}'::jsonb,
  edhrec_rank integer,
  demand_observed_at timestamptz,
  source_row_id bigint not null,
  updated_at timestamptz not null default now(),
  primary key(user_id,product_name)
);

alter table public.marketplace_product_demand_current enable row level security;
revoke all on public.marketplace_product_demand_current from public,anon,authenticated;
grant select,insert,update,delete on public.marketplace_product_demand_current to service_role;

create or replace function public.refresh_marketplace_product_demand_current(p_user_id uuid,p_product_name text)
returns void language plpgsql security definer set search_path=public as $$
begin
  delete from public.marketplace_product_demand_current
  where user_id=p_user_id and product_name=p_product_name;

  insert into public.marketplace_product_demand_current(
    user_id,product_name,demand_adjustment,demand_signal,demand_signal_score,demand_sources,edhrec_rank,demand_observed_at,source_row_id,updated_at)
  select r.user_id,r.product_name,
    coalesce(r.demand_adjustment,r.edhrec_adjustment,0),
    r.demand_signal,r.demand_signal_score,coalesce(r.demand_sources,'{}'::jsonb),r.edhrec_rank,
    coalesce(r.edhrec_observed_at,r.commander_enriched_at),r.id,now()
  from public.marketplace_scan_rows r
  where r.user_id=p_user_id and r.product_name=p_product_name
    and (r.demand_signal is not null or r.edhrec_signal is not null or coalesce(r.demand_adjustment,r.edhrec_adjustment,0)<>0)
  order by coalesce(r.edhrec_observed_at,r.commander_enriched_at) desc nulls last,r.id desc
  limit 1;
end;$$;

revoke all on function public.refresh_marketplace_product_demand_current(uuid,text) from public,anon,authenticated;
grant execute on function public.refresh_marketplace_product_demand_current(uuid,text) to service_role;

create or replace function public.sync_marketplace_product_demand_current()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_observed timestamptz;
  v_qualifies boolean;
  v_current_id bigint;
begin
  if tg_op='DELETE' then
    select source_row_id into v_current_id
      from public.marketplace_product_demand_current
     where user_id=old.user_id and product_name=old.product_name;
    if v_current_id=old.id then
      perform public.refresh_marketplace_product_demand_current(old.user_id,old.product_name);
    end if;
    return old;
  end if;

  v_qualifies := new.demand_signal is not null
    or new.edhrec_signal is not null
    or coalesce(new.demand_adjustment,new.edhrec_adjustment,0)<>0;
  v_observed := coalesce(new.edhrec_observed_at,new.commander_enriched_at);

  if tg_op='UPDATE' and (old.user_id,old.product_name) is distinct from (new.user_id,new.product_name) then
    select source_row_id into v_current_id
      from public.marketplace_product_demand_current
     where user_id=old.user_id and product_name=old.product_name;
    if v_current_id=old.id then
      perform public.refresh_marketplace_product_demand_current(old.user_id,old.product_name);
    end if;
  end if;

  if not v_qualifies then
    select source_row_id into v_current_id
      from public.marketplace_product_demand_current
     where user_id=new.user_id and product_name=new.product_name;
    if v_current_id=new.id then
      perform public.refresh_marketplace_product_demand_current(new.user_id,new.product_name);
    end if;
    return new;
  end if;

  insert into public.marketplace_product_demand_current(
    user_id,product_name,demand_adjustment,demand_signal,demand_signal_score,demand_sources,edhrec_rank,demand_observed_at,source_row_id,updated_at)
  values(
    new.user_id,new.product_name,coalesce(new.demand_adjustment,new.edhrec_adjustment,0),new.demand_signal,new.demand_signal_score,
    coalesce(new.demand_sources,'{}'::jsonb),new.edhrec_rank,v_observed,new.id,now())
  on conflict(user_id,product_name) do update set
    demand_adjustment=excluded.demand_adjustment,
    demand_signal=excluded.demand_signal,
    demand_signal_score=excluded.demand_signal_score,
    demand_sources=excluded.demand_sources,
    edhrec_rank=excluded.edhrec_rank,
    demand_observed_at=excluded.demand_observed_at,
    source_row_id=excluded.source_row_id,
    updated_at=excluded.updated_at
  where (excluded.demand_observed_at is not null and marketplace_product_demand_current.demand_observed_at is null)
     or excluded.demand_observed_at > marketplace_product_demand_current.demand_observed_at
     or (excluded.demand_observed_at is not distinct from marketplace_product_demand_current.demand_observed_at
         and excluded.source_row_id > marketplace_product_demand_current.source_row_id);
  return new;
end;$$;

revoke all on function public.sync_marketplace_product_demand_current() from public,anon,authenticated;
grant execute on function public.sync_marketplace_product_demand_current() to service_role;

drop trigger if exists marketplace_scan_rows_demand_current_sync on public.marketplace_scan_rows;
create trigger marketplace_scan_rows_demand_current_sync
after insert or update or delete on public.marketplace_scan_rows
for each row execute function public.sync_marketplace_product_demand_current();

insert into public.marketplace_product_demand_current(
  user_id,product_name,demand_adjustment,demand_signal,demand_signal_score,demand_sources,edhrec_rank,demand_observed_at,source_row_id,updated_at)
select distinct on(r.user_id,r.product_name)
  r.user_id,r.product_name,coalesce(r.demand_adjustment,r.edhrec_adjustment,0),r.demand_signal,r.demand_signal_score,
  coalesce(r.demand_sources,'{}'::jsonb),r.edhrec_rank,coalesce(r.edhrec_observed_at,r.commander_enriched_at),r.id,now()
from public.marketplace_scan_rows r
where r.demand_signal is not null
   or r.edhrec_signal is not null
   or coalesce(r.demand_adjustment,r.edhrec_adjustment,0)<>0
order by r.user_id,r.product_name,coalesce(r.edhrec_observed_at,r.commander_enriched_at) desc nulls last,r.id desc
on conflict(user_id,product_name) do update set
  demand_adjustment=excluded.demand_adjustment,
  demand_signal=excluded.demand_signal,
  demand_signal_score=excluded.demand_signal_score,
  demand_sources=excluded.demand_sources,
  edhrec_rank=excluded.edhrec_rank,
  demand_observed_at=excluded.demand_observed_at,
  source_row_id=excluded.source_row_id,
  updated_at=excluded.updated_at;

analyze public.marketplace_product_demand_current;