-- Discord is a transport client for Ask Collectish. Keep user-owned identity/session
-- metadata separate from OAuth credentials so normal RLS reads can never expose tokens.

create table if not exists public.discord_collectish_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  discord_user_id text not null,
  discord_username text,
  discord_global_name text,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discord_collectish_links_user_unique unique (user_id),
  constraint discord_collectish_links_discord_unique unique (discord_user_id),
  constraint discord_collectish_links_user_id_format check (discord_user_id ~ '^[0-9]{5,32}$')
);

create table if not exists public.discord_collectish_oauth_credentials (
  link_id uuid primary key references public.discord_collectish_links(id) on delete cascade,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  token_version integer not null default 1,
  oauth_client_id text not null,
  scopes text[] not null default array['openid','email','profile']::text[],
  rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.discord_ask_bindings (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.discord_collectish_links(id) on delete cascade,
  guild_id text,
  channel_id text not null,
  thread_id text,
  ask_session_id uuid references public.ask_collectish_conversations(id) on delete set null,
  last_interaction_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discord_ask_bindings_channel_format check (channel_id ~ '^[0-9]{5,32}$'),
  constraint discord_ask_bindings_guild_format check (guild_id is null or guild_id ~ '^[0-9]{5,32}$'),
  constraint discord_ask_bindings_thread_format check (thread_id is null or thread_id ~ '^[0-9]{5,32}$')
);

create table if not exists public.discord_ask_deliveries (
  interaction_id text primary key,
  discord_user_id text not null,
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','link_required')),
  ask_session_id uuid references public.ask_collectish_conversations(id) on delete set null,
  response_text text,
  error_text text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint discord_ask_deliveries_user_id_format check (discord_user_id ~ '^[0-9]{5,32}$')
);

create unique index if not exists discord_ask_bindings_scope_unique
  on public.discord_ask_bindings (link_id, channel_id, coalesce(thread_id, ''));
create index if not exists discord_ask_bindings_session_idx
  on public.discord_ask_bindings (ask_session_id)
  where ask_session_id is not null;
create index if not exists discord_ask_deliveries_status_idx
  on public.discord_ask_deliveries (status, created_at);

alter table public.discord_collectish_links enable row level security;
alter table public.discord_collectish_oauth_credentials enable row level security;
alter table public.discord_ask_bindings enable row level security;
alter table public.discord_ask_deliveries enable row level security;

-- Users may inspect/delete their own non-secret Discord link metadata. OAuth
-- credentials and transport deliveries intentionally have no authenticated policies:
-- only the trusted bot service (service role) may read or mutate them.
drop policy if exists discord_collectish_links_owner_select on public.discord_collectish_links;
create policy discord_collectish_links_owner_select
  on public.discord_collectish_links for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists discord_collectish_links_owner_delete on public.discord_collectish_links;
create policy discord_collectish_links_owner_delete
  on public.discord_collectish_links for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists discord_ask_bindings_owner_select on public.discord_ask_bindings;
create policy discord_ask_bindings_owner_select
  on public.discord_ask_bindings for select to authenticated
  using (exists (
    select 1
    from public.discord_collectish_links l
    where l.id = discord_ask_bindings.link_id
      and l.user_id = (select auth.uid())
  ));

drop policy if exists discord_ask_bindings_owner_delete on public.discord_ask_bindings;
create policy discord_ask_bindings_owner_delete
  on public.discord_ask_bindings for delete to authenticated
  using (exists (
    select 1
    from public.discord_collectish_links l
    where l.id = discord_ask_bindings.link_id
      and l.user_id = (select auth.uid())
  ));

-- Queue delivery is at-least-once. Claiming is atomic and allows a stale running job
-- to be reclaimed after two minutes. A worker that already has response_text can retry
-- Discord delivery without calling Ask a second time.
create or replace function public.claim_discord_ask_delivery(
  p_interaction_id text,
  p_discord_user_id text
)
returns table (
  claimed boolean,
  delivery_status text,
  saved_response_text text,
  delivery_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.discord_ask_deliveries%rowtype;
begin
  insert into public.discord_ask_deliveries (interaction_id, discord_user_id)
  values (p_interaction_id, p_discord_user_id)
  on conflict (interaction_id) do nothing;

  update public.discord_ask_deliveries
  set status = 'running',
      attempts = attempts + 1,
      updated_at = now(),
      error_text = null
  where interaction_id = p_interaction_id
    and discord_user_id = p_discord_user_id
    and (
      status in ('queued', 'failed')
      or (status = 'running' and updated_at < now() - interval '2 minutes')
    )
  returning * into v_row;

  if found then
    return query select true, v_row.status, v_row.response_text, v_row.attempts;
    return;
  end if;

  select * into v_row
  from public.discord_ask_deliveries
  where interaction_id = p_interaction_id
    and discord_user_id = p_discord_user_id;

  return query select false, v_row.status, v_row.response_text, v_row.attempts;
end;
$$;

revoke all on function public.claim_discord_ask_delivery(text, text) from public, anon, authenticated;
grant execute on function public.claim_discord_ask_delivery(text, text) to service_role;

revoke all on table public.discord_collectish_oauth_credentials from anon, authenticated;
revoke all on table public.discord_ask_deliveries from anon, authenticated;
grant select, delete on table public.discord_collectish_links to authenticated;
grant select, delete on table public.discord_ask_bindings to authenticated;
