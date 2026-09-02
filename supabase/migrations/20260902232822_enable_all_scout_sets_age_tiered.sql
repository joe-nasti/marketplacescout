-- Expand Scout to every routable paper set while keeping full-set traffic age-tiered.

alter table public.marketplace_scan_profiles
  add column if not exists cadence_policy text not null default 'manual';

alter table public.marketplace_scan_profiles
  drop constraint if exists marketplace_scan_profiles_cadence_hours_check;

alter table public.marketplace_scan_profiles
  add constraint marketplace_scan_profiles_cadence_hours_check
  check (cadence_hours = any (array[3,6,12,24,48,72,168,336]));

alter table public.marketplace_scan_profiles
  drop constraint if exists marketplace_scan_profiles_cadence_policy_check;

alter table public.marketplace_scan_profiles
  add constraint marketplace_scan_profiles_cadence_policy_check
  check (cadence_policy in ('manual','age_tiered'));

create or replace function public.scout_set_age_cadence_hours(p_released_at date)
returns integer
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
    when p_released_at is null then null
    when p_released_at >= current_date - 90 then 6
    when p_released_at >= current_date - 365 then 12
    when p_released_at >= current_date - 1095 then 48
    when p_released_at >= current_date - 1825 then 72
    when p_released_at >= current_date - 2555 then 168
    else 336
  end;
$$;

create or replace function public.sync_scout_age_tiered_profiles(p_user_id uuid default auth.uid())
returns table(inserted_or_updated integer, duplicates_disabled integer, enabled_profiles integer)
language plpgsql
security invoker
set search_path = 'public'
as $$
declare
  v_changed integer := 0;
  v_disabled integer := 0;
  v_enabled integer := 0;
begin
  if p_user_id is null or not (
    p_user_id = auth.uid()
    or coalesce(auth.jwt()->>'role','') = 'service_role'
    or session_user = 'postgres'
  ) then
    raise exception 'not authorized';
  end if;

  insert into public.marketplace_scan_profiles (
    user_id,set_slug,set_name,enabled,cadence_hours,cadence_policy,
    printing,condition,language,scan_depth,updated_at,next_due_at,
    tcgplayer_group_id,tcgplayer_set_slug,display_set_name,tcgplayer_set_name
  )
  select
    p_user_id,m.tcgplayer_slug,m.name,true,
    public.scout_set_age_cadence_hours(m.released_at),'age_tiered',
    'Both','Near Mint','English','Smart',now(),null,
    m.tcgplayer_group_id,m.tcgplayer_slug,m.name,coalesce(m.tcgplayer_name,m.name)
  from (
    select distinct on (tcgplayer_slug) *
    from public.magic_set_catalog
    where digital=false
      and released_at is not null
      and tcgplayer_group_id is not null
      and nullif(tcgplayer_slug,'') is not null
    order by tcgplayer_slug,released_at desc,code
  ) m
  on conflict (user_id,set_slug) do update set
    set_name=excluded.set_name,
    enabled=true,
    cadence_hours=excluded.cadence_hours,
    cadence_policy='age_tiered',
    updated_at=now(),
    next_due_at=null,
    tcgplayer_group_id=excluded.tcgplayer_group_id,
    tcgplayer_set_slug=excluded.tcgplayer_set_slug,
    display_set_name=excluded.display_set_name,
    tcgplayer_set_name=excluded.tcgplayer_set_name
  where marketplace_scan_profiles.cadence_policy='age_tiered'
    and (
      marketplace_scan_profiles.enabled is distinct from true
      or marketplace_scan_profiles.cadence_hours is distinct from excluded.cadence_hours
      or marketplace_scan_profiles.tcgplayer_group_id is distinct from excluded.tcgplayer_group_id
      or marketplace_scan_profiles.tcgplayer_set_slug is distinct from excluded.tcgplayer_set_slug
      or marketplace_scan_profiles.set_name is distinct from excluded.set_name
    );
  get diagnostics v_changed = row_count;

  update public.marketplace_scan_profiles p
  set enabled=false,updated_at=now(),next_due_at=null
  from public.magic_set_catalog m
  where p.user_id=p_user_id
    and p.enabled=true
    and p.tcgplayer_group_id=m.tcgplayer_group_id
    and p.set_slug<>m.tcgplayer_slug
    and m.digital=false
    and m.tcgplayer_group_id is not null
    and nullif(m.tcgplayer_slug,'') is not null;
  get diagnostics v_disabled = row_count;

  if v_changed+v_disabled > 0 then
    perform public.rebalance_marketplace_scan_schedule(p_user_id);
  end if;

  select count(*)::integer into v_enabled
  from public.marketplace_scan_profiles
  where user_id=p_user_id and enabled=true;

  return query select v_changed,v_disabled,v_enabled;
end;
$$;

revoke all on function public.scout_set_age_cadence_hours(date) from public,anon;
grant execute on function public.scout_set_age_cadence_hours(date) to authenticated,service_role;
revoke all on function public.sync_scout_age_tiered_profiles(uuid) from public,anon;
grant execute on function public.sync_scout_age_tiered_profiles(uuid) to authenticated,service_role;

-- Adopt the policy for existing configured users, then populate the complete catalog.
update public.marketplace_scan_profiles set cadence_policy='age_tiered';

insert into public.marketplace_scan_profiles (
  user_id,set_slug,set_name,enabled,cadence_hours,cadence_policy,
  printing,condition,language,scan_depth,updated_at,next_due_at,
  tcgplayer_group_id,tcgplayer_set_slug,display_set_name,tcgplayer_set_name
)
select
  u.user_id,m.tcgplayer_slug,m.name,true,
  public.scout_set_age_cadence_hours(m.released_at),'age_tiered',
  'Both','Near Mint','English','Smart',now(),null,
  m.tcgplayer_group_id,m.tcgplayer_slug,m.name,coalesce(m.tcgplayer_name,m.name)
from (select distinct user_id from public.marketplace_scan_profiles) u
cross join (
  select distinct on (tcgplayer_slug) *
  from public.magic_set_catalog
  where digital=false
    and released_at is not null
    and tcgplayer_group_id is not null
    and nullif(tcgplayer_slug,'') is not null
  order by tcgplayer_slug,released_at desc,code
) m
on conflict (user_id,set_slug) do update set
  set_name=excluded.set_name,
  enabled=true,
  cadence_hours=excluded.cadence_hours,
  cadence_policy='age_tiered',
  updated_at=now(),
  next_due_at=null,
  tcgplayer_group_id=excluded.tcgplayer_group_id,
  tcgplayer_set_slug=excluded.tcgplayer_set_slug,
  display_set_name=excluded.display_set_name,
  tcgplayer_set_name=excluded.tcgplayer_set_name;

update public.marketplace_scan_profiles p
set enabled=false,updated_at=now(),next_due_at=null
from public.magic_set_catalog m
where p.enabled=true
  and p.tcgplayer_group_id=m.tcgplayer_group_id
  and p.set_slug<>m.tcgplayer_slug
  and m.digital=false
  and m.tcgplayer_group_id is not null
  and nullif(m.tcgplayer_slug,'') is not null;

with ranked as (
  select user_id,set_slug,cadence_hours,
    row_number() over(partition by user_id,cadence_hours order by set_slug)-1 rn,
    count(*) over(partition by user_id,cadence_hours) cnt
  from public.marketplace_scan_profiles
  where enabled=true
), calc as (
  select user_id,set_slug,
    floor((cadence_hours*60.0*rn)/greatest(cnt,1))::integer schedule_offset_minutes
  from ranked
)
update public.marketplace_scan_profiles p
set schedule_offset_minutes=c.schedule_offset_minutes,
    next_due_at=now()+make_interval(mins=>c.schedule_offset_minutes),
    updated_at=now()
from calc c
where p.user_id=c.user_id and p.set_slug=c.set_slug;
