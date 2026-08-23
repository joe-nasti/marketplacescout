-- Production single-writer lease for the Scout ranking refresh chain.
-- Applied to Supabase on 2026-08-23.

create table if not exists public.scout_rankings_refresh_lease (
  lease_name text primary key,
  holder_token text not null,
  source text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.scout_rankings_refresh_lease enable row level security;
revoke all on table public.scout_rankings_refresh_lease from anon, authenticated;
grant select, insert, update, delete on table public.scout_rankings_refresh_lease to service_role;

create or replace function public.claim_scout_rankings_refresh_lease(
  p_holder_token text,
  p_source text,
  p_ttl_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare claimed boolean := false;
begin
  if p_holder_token is null or btrim(p_holder_token) = '' then
    raise exception 'holder token required';
  end if;
  if p_ttl_seconds < 30 or p_ttl_seconds > 1800 then
    raise exception 'ttl out of range';
  end if;

  insert into public.scout_rankings_refresh_lease as l
    (lease_name, holder_token, source, acquired_at, expires_at)
  values
    ('scout_rankings', p_holder_token, coalesce(nullif(p_source,''),'manual_or_other'), now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (lease_name) do update
    set holder_token = excluded.holder_token,
        source = excluded.source,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where l.expires_at <= now()
       or l.holder_token = excluded.holder_token
  returning true into claimed;

  return coalesce(claimed,false);
end;
$function$;

create or replace function public.release_scout_rankings_refresh_lease(p_holder_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare released boolean := false;
begin
  delete from public.scout_rankings_refresh_lease
   where lease_name = 'scout_rankings'
     and holder_token = p_holder_token
  returning true into released;
  return coalesce(released,false);
end;
$function$;

revoke all on function public.claim_scout_rankings_refresh_lease(text,text,integer) from public, anon, authenticated;
revoke all on function public.release_scout_rankings_refresh_lease(text) from public, anon, authenticated;
grant execute on function public.claim_scout_rankings_refresh_lease(text,text,integer) to service_role;
grant execute on function public.release_scout_rankings_refresh_lease(text) to service_role;
