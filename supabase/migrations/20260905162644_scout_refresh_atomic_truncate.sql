-- Rebuild the derived Scout 24h table without accumulating delete churn/dead tuples.
-- Production migration: scout_refresh_atomic_truncate

do $$
declare v text;
begin
  select pg_get_functiondef('public.refresh_scout_opportunities_24h_unlocked()'::regprocedure) into v;
  if position('delete from public.scout_opportunities_24h where user_id is not null;' in lower(v))=0 then
    raise exception 'expected Scout rebuild delete statement not found';
  end if;
  v := replace(v,
    'delete from public.scout_opportunities_24h where user_id is not null;',
    'truncate table public.scout_opportunities_24h;');
  execute v;
end$$;