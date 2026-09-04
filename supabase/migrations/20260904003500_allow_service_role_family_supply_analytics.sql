-- Discord/server presenters execute with service_role and need the same read-only
-- family analytics as signed-in users. Execution grants remain restricted to
-- authenticated + service_role; anon/public remain revoked.
do $$
declare d text;
begin
  select pg_get_functiondef('public.ask_collectish_family_supply_concentration_v1(text[])'::regprocedure) into d;
  d:=replace(d,'when auth.uid() is null then','when auth.uid() is null and coalesce(auth.role(),'''')<>''service_role'' then');
  execute d;

  select pg_get_functiondef('public.ask_collectish_family_supply_trend_v1(text[],integer)'::regprocedure) into d;
  d:=replace(d,'when auth.uid() is null then','when auth.uid() is null and coalesce(auth.role(),'''')<>''service_role'' then');
  execute d;
end $$;
notify pgrst,'reload schema';
