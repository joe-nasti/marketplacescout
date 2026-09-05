-- Split the reusable Scout core refresh from shadow/cache publication.
-- Production migration: scout_refresh_core_pipeline

create or replace function public.refresh_scout_opportunities_24h_core()
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
  perform public.apply_official_tcgplayer_prices_to_scout_24h(interval '6 hours');
  perform public.annotate_scout_sales_confidence();

  with best as (
    select s.ctid rid,
           c.edhrec_rank,
           row_number() over(
             partition by s.ctid
             order by case
               when s.scryfall_id is not null and c.scryfall_id=s.scryfall_id::text then 0
               else 1
             end,
             c.observed_at desc
           ) rn
    from public.scout_opportunities_24h s
    join public.edhrec_card_cache c
      on c.user_id=s.user_id
     and ((s.scryfall_id is not null and c.scryfall_id=s.scryfall_id::text)
       or (s.product_id is not null and c.product_id=s.product_id))
    where c.edhrec_rank is not null
  )
  update public.scout_opportunities_24h s
     set edhrec_rank=b.edhrec_rank
    from best b
   where s.ctid=b.rid
     and b.rn=1
     and s.edhrec_rank is distinct from b.edhrec_rank;

  return n;
end;
$function$;

revoke all on function public.refresh_scout_opportunities_24h_core() from public,anon,authenticated;
grant execute on function public.refresh_scout_opportunities_24h_core() to service_role;

create or replace function public.refresh_scout_opportunities_24h()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '180s'
as $function$
declare n integer;
begin
  n := public.refresh_scout_opportunities_24h_core();
  perform public.refresh_scout_v5_shadow();
  perform public.refresh_scout_opportunities_v5_cache();
  return n;
end;
$function$;

revoke all on function public.refresh_scout_opportunities_24h() from public,anon;
grant execute on function public.refresh_scout_opportunities_24h() to authenticated,service_role;