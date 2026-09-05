-- Internal deterministic opportunity RPCs are already protected by EXECUTE grants.
-- Do not additionally depend on request JWT claims inside SECURITY DEFINER functions,
-- because internal service calls may use a non-JWT service secret.
do $$
declare r record; d text;
begin
  for r in
    select p.oid,p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'ask_collectish_family_printing_opportunity_v1',
        'ask_collectish_family_printing_opportunity_v2',
        'ask_collectish_family_printing_opportunity_v3'
      )
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d,
      'auth.uid() is null and coalesce(auth.role(),'''')<>''service_role''',
      'false'
    );
    execute d;
  end loop;
end $$;

revoke all on function public.ask_collectish_family_printing_opportunity_v1(text[]) from public,anon;
revoke all on function public.ask_collectish_family_printing_opportunity_v2(text[]) from public,anon;
revoke all on function public.ask_collectish_family_printing_opportunity_v3(text[]) from public,anon;
grant execute on function public.ask_collectish_family_printing_opportunity_v1(text[]) to authenticated,service_role;
grant execute on function public.ask_collectish_family_printing_opportunity_v2(text[]) to authenticated,service_role;
grant execute on function public.ask_collectish_family_printing_opportunity_v3(text[]) to authenticated,service_role;
notify pgrst,'reload schema';
