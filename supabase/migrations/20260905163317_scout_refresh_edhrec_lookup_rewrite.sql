-- Avoid a per-Scout-row bitmap OR across EDHREC scryfall/product identities.
-- Prefer exact scryfall identity, then product identity.
-- Production migration: scout_refresh_edhrec_lookup_rewrite

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
    select s.ctid rid,x.edhrec_rank
    from public.scout_opportunities_24h s
    left join lateral (
      select z.edhrec_rank
      from (
        select c.edhrec_rank,c.observed_at,0 as pri
        from public.edhrec_card_cache c
        where c.user_id=s.user_id
          and s.scryfall_id is not null
          and c.scryfall_id=s.scryfall_id::text
          and c.edhrec_rank is not null
        union all
        select c.edhrec_rank,c.observed_at,1 as pri
        from public.edhrec_card_cache c
        where c.user_id=s.user_id
          and s.product_id is not null
          and c.product_id=s.product_id
          and c.edhrec_rank is not null
      ) z
      order by z.pri,z.observed_at desc
      limit 1
    ) x on true
  )
  update public.scout_opportunities_24h s
     set edhrec_rank=b.edhrec_rank
    from best b
   where s.ctid=b.rid
     and b.edhrec_rank is not null
     and s.edhrec_rank is distinct from b.edhrec_rank;

  return n;
end;
$function$;