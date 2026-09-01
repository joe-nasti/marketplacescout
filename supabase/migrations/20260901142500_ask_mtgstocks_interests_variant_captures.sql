do $$
declare d text;
begin
  select pg_get_functiondef('public.ask_mtgstocks_interests_vetted_base_v1(text,text,text,text,integer)'::regprocedure) into d;
  d := replace(d,'sc.capture_type=''discovery_candidate''','sc.capture_type in (''discovery_candidate'',''mtgstocks_interest_variant'')');
  execute d;
end $$;
