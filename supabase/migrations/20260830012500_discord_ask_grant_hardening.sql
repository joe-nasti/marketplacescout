-- Supabase grants broad default table privileges to API roles. RLS protects row-level
-- DML, but it does not protect TRUNCATE. Remove every inherited/default privilege from
-- Discord integration tables and add back only the two owner-facing operations intended
-- for non-secret metadata.

revoke all on table public.discord_collectish_links from anon, authenticated;
revoke all on table public.discord_ask_bindings from anon, authenticated;
revoke all on table public.discord_collectish_oauth_credentials from anon, authenticated;
revoke all on table public.discord_ask_deliveries from anon, authenticated;

grant select, delete on table public.discord_collectish_links to authenticated;
grant select, delete on table public.discord_ask_bindings to authenticated;
