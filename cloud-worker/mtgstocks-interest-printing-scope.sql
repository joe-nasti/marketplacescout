-- Printing-aware MTGStocks Interests identity and corroboration.
-- Interests is a price-movement feed, so an isolated foil/showcase spike should
-- not be treated the same as broad Oracle-family demand.

create or replace function public.resolve_mtgstocks_interest_links(p_intel_ids uuid[] default null)
returns table(resolved_exact integer, left_oracle_only integer)
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_exact integer:=0;
  v_oracle integer:=0;
begin
  with base as (
    select i.user_id,i.intel_id,e.intel_entity_id,e.entity_name,
      i.metadata_json->>'mtgstocks_set_name' set_name,
      lower(coalesce(i.metadata_json->>'finish','regular')) finish,
      lower(coalesce(i.metadata_json->>'original_card_name','')) original_name
    from market_intel_items i
    join market_intel_entities e on e.intel_id=i.intel_id and e.user_id=i.user_id and e.entity_type='card'
    where i.source_name='MTGStocks' and i.source_subtype='interests'
      and (p_intel_ids is null or i.intel_id=any(p_intel_ids))
  ), candidates as (
    select b.user_id,b.intel_id,b.intel_entity_id,
      sk.product_id::text product_id,
      min(c.scryfall_id::text)::uuid scryfall_id,
      min(c.set_code) set_code
    from base b
    join magic_set_catalog ms on lower(coalesce(ms.tcgplayer_name,ms.name,''))=lower(b.set_name)
      or lower(coalesce(ms.scryfall_name,ms.name,''))=lower(b.set_name)
      or lower(ms.name)=lower(b.set_name)
    join mtgjson_cards c on upper(c.set_code)=upper(ms.code) and lower(c.name)=lower(b.entity_name)
    join mtgjson_tcgplayer_skus sk on sk.uuid=c.uuid
      and upper(coalesce(sk.language,'ENGLISH'))='ENGLISH'
      and upper(coalesce(sk.condition,'NEAR MINT'))='NEAR MINT'
      and (
        (b.original_name like '%etched%' and upper(coalesce(sk.finish,''))='ETCHED')
        or (b.original_name not like '%etched%' and b.finish='foil' and upper(coalesce(sk.printing,''))='FOIL' and upper(coalesce(sk.finish,''))<>'ETCHED')
        or (b.finish<>'foil' and upper(coalesce(sk.printing,''))='NON FOIL')
      )
    where sk.product_id is not null
    group by b.user_id,b.intel_id,b.intel_entity_id,sk.product_id
  ), unique_candidate as (
    select intel_entity_id,min(product_id) product_id,min(scryfall_id::text)::uuid scryfall_id,min(set_code) set_code
    from candidates group by intel_entity_id having count(distinct product_id)=1
  ), upd_exact as (
    update market_intel_entities e
      set product_id=u.product_id,scryfall_id=u.scryfall_id,set_code=u.set_code,confidence=greatest(e.confidence,0.995)
    from unique_candidate u where u.intel_entity_id=e.intel_entity_id
    returning 1
  ), ambiguous as (
    select b.intel_entity_id from base b left join unique_candidate u on u.intel_entity_id=b.intel_entity_id where u.intel_entity_id is null
  ), upd_ambiguous as (
    update market_intel_entities e
      set product_id=null,set_code=null,
          confidence=least(e.confidence,0.90)
    from ambiguous a where a.intel_entity_id=e.intel_entity_id
    returning 1
  )
  select (select count(*) from upd_exact),(select count(*) from upd_ambiguous) into v_exact,v_oracle;
  return query select v_exact,v_oracle;
end
$function$;

create or replace view public.market_intel_interest_printing_context
with (security_invoker=true)
as
with events as (
  select distinct
    i.user_id,i.intel_id,i.direction,coalesce(i.published_at,i.observed_at,i.created_at) signal_at,
    i.metadata_json->>'source_date' source_date,
    i.metadata_json->>'window' movement_window,
    i.metadata_json->>'finish' finish,
    i.metadata_json->>'price_type' price_type,
    nullif(i.metadata_json->>'change_pct','')::numeric change_pct,
    e.product_id source_product_id,
    l.oracle_id,l.canonical_name
  from market_intel_items i
  join market_intel_entities e on e.intel_id=i.intel_id and e.user_id=i.user_id and e.entity_type='card'
  left join market_intel_scout_signal_links l on l.intel_id=i.intel_id and l.user_id=i.user_id
  where i.source_name='MTGStocks' and i.source_subtype='interests'
), family as (
  select user_id,source_date,movement_window,oracle_id,direction,
    count(distinct intel_id)::int interest_events,
    count(distinct source_product_id) filter(where source_product_id is not null)::int exact_printings_moving,
    count(distinct finish)::int finishes_moving,
    max(abs(change_pct)) max_abs_change_pct
  from events where oracle_id is not null
  group by user_id,source_date,movement_window,oracle_id,direction
)
select e.*,
  coalesce(f.interest_events,1) family_interest_events,
  coalesce(f.exact_printings_moving,case when e.source_product_id is null then 0 else 1 end) corroborating_exact_printings,
  coalesce(f.finishes_moving,1) corroborating_finishes,
  case
    when e.source_product_id is not null and coalesce(f.exact_printings_moving,0)>=2 then 'cross_print_corroborated'
    when e.source_product_id is not null then 'exact_printing'
    when coalesce(f.exact_printings_moving,0)>=2 then 'oracle_corroborated'
    else 'oracle_only'
  end::text printing_scope,
  case
    when e.source_product_id is not null then 1.00
    when coalesce(f.exact_printings_moving,0)>=2 then 0.65
    else 0.35
  end::numeric family_context_weight
from events e
left join family f on f.user_id=e.user_id and f.source_date=e.source_date and f.movement_window=e.movement_window and f.oracle_id=e.oracle_id and f.direction=e.direction;

revoke all on function public.resolve_mtgstocks_interest_links(uuid[]) from public,anon;
grant execute on function public.resolve_mtgstocks_interest_links(uuid[]) to authenticated,service_role;
revoke all on public.market_intel_interest_printing_context from public,anon;
grant select on public.market_intel_interest_printing_context to authenticated;

select * from public.resolve_mtgstocks_interest_links(null);
