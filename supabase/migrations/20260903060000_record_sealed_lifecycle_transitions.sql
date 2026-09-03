create table if not exists public.sealed_product_lifecycle_state (
  user_id uuid not null,
  sealed_uuid uuid not null,
  current_state text not null,
  previous_state text,
  trajectory_action text not null,
  pattern_score numeric not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  state_changed_at timestamptz not null default now(),
  primary key (user_id,sealed_uuid)
);

create table if not exists public.sealed_product_lifecycle_events (
  transition_key text primary key,
  user_id uuid not null,
  sealed_uuid uuid not null,
  from_state text not null,
  to_state text not null,
  trajectory_action text not null,
  pattern_score numeric not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);

alter table public.sealed_product_lifecycle_state enable row level security;
alter table public.sealed_product_lifecycle_events enable row level security;

create policy sealed_lifecycle_state_owner_read on public.sealed_product_lifecycle_state
for select to authenticated using ((select auth.uid())=user_id);
create policy sealed_lifecycle_events_owner_read on public.sealed_product_lifecycle_events
for select to authenticated using ((select auth.uid())=user_id);

grant select on public.sealed_product_lifecycle_state,public.sealed_product_lifecycle_events to authenticated;
grant select,insert,update on public.sealed_product_lifecycle_state,public.sealed_product_lifecycle_events to service_role;

create index if not exists sealed_lifecycle_events_user_time_idx
  on public.sealed_product_lifecycle_events (user_id,observed_at desc);

create or replace function public.snapshot_sealed_product_lifecycle_states()
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare changed_count integer:=0;
begin
  with signals as (
    select s.*,
      round(greatest(0,
        case s.lifecycle_state when 'SUPPLY SQUEEZE' then 45 when 'BREAKOUT' then 38
          when 'REVERSAL' then 30 when 'ACCUMULATION' then 24 when 'PLATEAU' then 12 else 5 end
        +least(20,greatest(0,coalesce(s.supply_compression_7d_pct,s.supply_compression_30d_pct,0))*.4)
        +least(20,greatest(0,coalesce(s.change_30d_pct,0))*.5)
        +least(15,ln(greatest(coalesce(s.units_30d,0),0)+1)*5)
      ),1) score
    from public.sealed_product_lifecycle_signal_current s
  ), inserted as (
    insert into public.sealed_product_lifecycle_events (
      transition_key,user_id,sealed_uuid,from_state,to_state,trajectory_action,pattern_score,evidence,observed_at
    )
    select concat(s.user_id,':',s.sealed_uuid,':',st.current_state,':',s.lifecycle_state,':',current_date),
      s.user_id,s.sealed_uuid,st.current_state,s.lifecycle_state,s.trajectory_action,s.score,s.lifecycle_evidence,now()
    from signals s join public.sealed_product_lifecycle_state st
      on st.user_id=s.user_id and st.sealed_uuid=s.sealed_uuid
    where st.current_state<>s.lifecycle_state
    on conflict (transition_key) do nothing returning 1
  ) select count(*) into changed_count from inserted;

  with signals as (
    select s.*,
      round(greatest(0,
        case s.lifecycle_state when 'SUPPLY SQUEEZE' then 45 when 'BREAKOUT' then 38
          when 'REVERSAL' then 30 when 'ACCUMULATION' then 24 when 'PLATEAU' then 12 else 5 end
        +least(20,greatest(0,coalesce(s.supply_compression_7d_pct,s.supply_compression_30d_pct,0))*.4)
        +least(20,greatest(0,coalesce(s.change_30d_pct,0))*.5)
        +least(15,ln(greatest(coalesce(s.units_30d,0),0)+1)*5)
      ),1) score
    from public.sealed_product_lifecycle_signal_current s
  )
  insert into public.sealed_product_lifecycle_state (
    user_id,sealed_uuid,current_state,previous_state,trajectory_action,pattern_score,evidence,observed_at,state_changed_at
  ) select user_id,sealed_uuid,lifecycle_state,null,trajectory_action,score,lifecycle_evidence,now(),now()
    from signals
  on conflict (user_id,sealed_uuid) do update set
    previous_state=case when sealed_product_lifecycle_state.current_state<>excluded.current_state
      then sealed_product_lifecycle_state.current_state else sealed_product_lifecycle_state.previous_state end,
    current_state=excluded.current_state,
    trajectory_action=excluded.trajectory_action,
    pattern_score=excluded.pattern_score,
    evidence=excluded.evidence,
    observed_at=excluded.observed_at,
    state_changed_at=case when sealed_product_lifecycle_state.current_state<>excluded.current_state
      then excluded.observed_at else sealed_product_lifecycle_state.state_changed_at end;
  return changed_count;
end;
$$;

revoke all on function public.snapshot_sealed_product_lifecycle_states() from public,anon,authenticated;
grant execute on function public.snapshot_sealed_product_lifecycle_states() to service_role;

create or replace view public.sealed_product_developing_patterns_current
with (security_invoker=true) as
select st.user_id,st.sealed_uuid,p.name product_name,p.set_code,p.release_date,
  st.current_state lifecycle_state,st.previous_state,st.trajectory_action,st.pattern_score,
  st.evidence,st.observed_at,st.state_changed_at,
  e.from_state recent_from_state,e.to_state recent_to_state,e.observed_at recent_transition_at,
  case when e.observed_at>=now()-interval '14 days' then true else false end recently_transitioned,
  'Observational ranking only until walk-forward calibration earns HIGH confidence.'::text caveat
from public.sealed_product_lifecycle_state st
join public.mtgjson_sealed_products p on p.uuid=st.sealed_uuid
left join lateral (
  select x.from_state,x.to_state,x.observed_at
  from public.sealed_product_lifecycle_events x
  where x.user_id=st.user_id and x.sealed_uuid=st.sealed_uuid
  order by x.observed_at desc limit 1
) e on true
where st.current_state<>'MIXED' or e.observed_at>=now()-interval '14 days';

grant select on public.sealed_product_developing_patterns_current to authenticated,service_role;

select public.snapshot_sealed_product_lifecycle_states();
