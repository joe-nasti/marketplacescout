-- Ensure every Scout 24h snapshot refresh immediately hydrates measured shared sales velocity
-- and then republishes the v5 read cache that the frontend prefers.
create or replace function public.refresh_scout_opportunities_24h()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '180s'
as $function$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtext('collectish_refresh_scout_opportunities_24h'));
  n := public.refresh_scout_opportunities_24h_unlocked();
  perform public.annotate_scout_sales_confidence();
  perform public.refresh_scout_opportunities_v5_cache();
  return n;
end;
$function$;
