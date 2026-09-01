create or replace function public.refresh_scout_opportunities_v5_cache()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '180s'
as $function$
declare n integer;
begin
  delete from public.scout_opportunities_v5_cache where true;
  insert into public.scout_opportunities_v5_cache select * from public.scout_opportunities_v5;

  update public.scout_opportunities_v5_cache c
     set scryfall_id = catalog.scryfall_id
    from public.scout_card_catalog catalog
   where c.sku_id = catalog.sku_id
     and c.scryfall_id is null
     and catalog.scryfall_id is not null;

  update public.scout_opportunities_v5_cache c
     set sales_rank=o.sales_rank,
         score_components=coalesce(c.score_components,'{}'::jsonb)||jsonb_build_object(
           'tcgSetSalesRankSource','tcgplayer_official_search',
           'tcgSetSalesRankObservedAt',o.observed_at,
           'tcgSetSalesRank',o.sales_rank
         )
    from public.tcgplayer_set_sales_rank_current o
   where c.product_id=o.product_id
     and upper(coalesce(c.set_code,''))=upper(coalesce(o.set_code,''))
     and o.observed_at>=now()-interval '48 hours';

  select count(*) into n from public.scout_opportunities_v5_cache;
  return n;
end;
$function$;
