create or replace function public.ask_mtgstocks_interests_vetted_v1(
  p_source_date text default null,
  p_finish text default 'regular',
  p_price_type text default 'average',
  p_window text default '24h',
  p_limit integer default 40
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with params as (
  select coalesce(nullif(p_source_date,''),(
    select max(sc.payload_json->>'date')
    from source_captures sc
    where sc.source='MTGStocks' and sc.capture_type='discovery_candidate'
      and sc.payload_json->>'discovery_source'='canonical_api'
      and sc.payload_json->>'finish'=p_finish
      and sc.payload_json->>'price_type'=p_price_type
      and sc.payload_json->>'window'=p_window
  )) as source_date,
  greatest(1,least(coalesce(p_limit,40),80)) as lim
), raw as (
  select sc.payload_json as payload,
         sc.payload_json->>'card_name' as card_name,
         sc.payload_json->>'set_name' as set_name,
         coalesce(sc.payload_json->>'mtgstocks_print_id',sc.payload_json->>'print_id') as print_id,
         sc.payload_json->>'finish' as finish,
         sc.payload_json->>'price_type' as price_type,
         sc.payload_json->>'window' as move_window,
         sc.payload_json->>'date' as source_date,
         nullif(sc.payload_json->>'pct_change','')::numeric as pct_change,
         nullif(sc.payload_json->>'old_price','')::numeric as old_price,
         nullif(sc.payload_json->>'new_price','')::numeric as new_price,
         sc.payload_json->>'url' as source_url,
         sc.captured_at
  from source_captures sc cross join params p
  where sc.source='MTGStocks' and sc.capture_type='discovery_candidate'
    and sc.payload_json->>'discovery_source'='canonical_api'
    and sc.payload_json->>'date'=p.source_date
    and sc.payload_json->>'finish'=p_finish
    and sc.payload_json->>'price_type'=p_price_type
    and sc.payload_json->>'window'=p_window
    and nullif(sc.payload_json->>'pct_change','') is not null
), market_peer as (
  select coalesce(sc.payload_json->>'mtgstocks_print_id',sc.payload_json->>'print_id') as print_id,
         nullif(sc.payload_json->>'pct_change','')::numeric as market_pct
  from source_captures sc cross join params p
  where sc.source='MTGStocks' and sc.capture_type='discovery_candidate'
    and sc.payload_json->>'discovery_source'='canonical_api'
    and sc.payload_json->>'date'=p.source_date
    and sc.payload_json->>'finish'=p_finish
    and sc.payload_json->>'price_type'='market'
    and sc.payload_json->>'window'=p_window
), enriched as (
 select r.*,
        coalesce(nullif(r.payload->>'set_code',''),setmap.code, ent.set_code) as set_code,
        ent.product_id,ent.scryfall_id,ent.confidence as resolution_confidence,
        scout.sku_id,scout.avg_daily_qty_sold,scout.direct_available,scout.direct_low,scout.sku_market_price,
        scout.ck_retail,scout.ck_buylist,scout.manapool_retail,scout.cardmarket_retail,
        peer.market_pct
 from raw r
 left join lateral (
   select m.code
   from magic_set_catalog m
   where lower(coalesce(m.name,''))=lower(coalesce(r.set_name,''))
      or lower(coalesce(m.tcgplayer_name,''))=lower(coalesce(r.set_name,''))
      or lower(coalesce(m.scryfall_name,''))=lower(coalesce(r.set_name,''))
   order by case when lower(coalesce(m.tcgplayer_name,''))=lower(coalesce(r.set_name,'')) then 0 else 1 end
   limit 1
 ) setmap on true
 left join lateral (
   select e.product_id,e.set_code,e.scryfall_id,e.confidence
   from market_intel_items i
   join market_intel_entities e on e.intel_id=i.intel_id and e.entity_type='card'
   where i.source_name='MTGStocks' and i.source_subtype='interests'
     and i.metadata_json->>'source_date'=r.source_date
     and i.metadata_json->>'mtgstocks_print_id'=r.print_id
   order by e.confidence desc nulls last
   limit 1
 ) ent on true
 left join lateral (
   select s.sku_id,s.avg_daily_qty_sold,s.direct_available,s.direct_low,s.sku_market_price,
          s.ck_retail,s.ck_buylist,s.manapool_retail,s.cardmarket_retail
   from scout_opportunities_v5_cache s
   where s.product_id=ent.product_id
     and lower(coalesce(s.condition,'')) like '%near mint%'
     and lower(coalesce(s.language,''))='english'
     and (case when p_finish='foil' then lower(coalesce(s.printing,'')) like '%foil%'
               else lower(coalesce(s.printing,'')) not like '%foil%' end)
   order by s.latest_scan_at desc nulls last
   limit 1
 ) scout on true
 left join market_peer peer on peer.print_id=r.print_id
), classified as (
 select e.*,
   case
     when coalesce(card_name,'') ~* 'art card|gold-stamped|planeswalker symbol|ultra pro puzzle|token|emblem|oversize' or coalesce(set_name,'') ~* '^Art Series:|Oversize Cards' then 'non_game'
     when coalesce(set_name,'') ~* '30th Anniversary Edition|International Edition|Collectors.? Edition|World Championship Decks' then 'non_tournament'
     when old_price is not null and old_price<=0.25 and abs(pct_change)>=100 then 'price_base_anomaly'
     when abs(pct_change)>=200 and market_pct is null and coalesce(avg_daily_qty_sold,0)<0.5 then 'thin_unconfirmed'
     when coalesce(set_code,'') in ('LEA','LEB','2ED','ARN','ATQ','LEG') and abs(pct_change)>=40 and coalesce(avg_daily_qty_sold,0)<0.5 then 'thin_collectible'
     when pct_change>0 then 'candidate'
     else 'down_move'
   end as vet_class,
   array_remove(array[
     case when coalesce(card_name,'') ~* 'art card|gold-stamped|planeswalker symbol|ultra pro puzzle|token|emblem|oversize' or coalesce(set_name,'') ~* '^Art Series:|Oversize Cards' then 'non-game / non-playable object' end,
     case when coalesce(set_name,'') ~* '30th Anniversary Edition|International Edition|Collectors.? Edition|World Championship Decks' then 'non-tournament printing' end,
     case when old_price is not null and old_price<=0.25 and abs(pct_change)>=100 then 'tiny starting price / percentage distortion' end,
     case when abs(pct_change)>=200 and market_pct is null and coalesce(avg_daily_qty_sold,0)<0.5 then 'extreme move without liquidity or same-print market corroboration' end,
     case when coalesce(set_code,'') in ('LEA','LEB','2ED','ARN','ATQ','LEG') and abs(pct_change)>=40 and coalesce(avg_daily_qty_sold,0)<0.5 then 'old/thin collectible printing' end,
     case when product_id is not null then 'exact Collectish printing resolved' end,
     case when coalesce(avg_daily_qty_sold,0)>=1 then trim(to_char(avg_daily_qty_sold,'FM999990.0'))||' sales/day' end,
     case when direct_available is not null then direct_available::text||' Direct available' end,
     case when market_pct is not null and sign(market_pct)=sign(pct_change) then 'MTGStocks market stream agrees' end,
     case when sku_market_price is not null and new_price is not null and new_price>0 and abs(sku_market_price-new_price)/new_price<=0.30 then 'TCG market near reported price' end,
     case when ck_retail is not null then 'Card Kingdom price available' end,
     case when manapool_retail is not null then 'Manapool price available' end,
     case when cardmarket_retail is not null then 'Cardmarket price available' end
   ],null) as reasons,
   round(
     least(greatest(pct_change,0),120)*0.28
     + case when product_id is not null then 18 else 0 end
     + least(coalesce(avg_daily_qty_sold,0)*4,18)
     + case when coalesce(direct_available,0)>=5 then 8 else 0 end
     + case when market_pct is not null and sign(market_pct)=sign(pct_change) then 14 else 0 end
     + case when sku_market_price is not null and new_price is not null and new_price>0 and abs(sku_market_price-new_price)/new_price<=0.30 then 12 else 0 end
     + case when ck_retail is not null or manapool_retail is not null or cardmarket_retail is not null then 6 else 0 end
     - case when product_id is null then 8 else 0 end
     - case when pct_change>150 and market_pct is null then 20 else 0 end
   ,1) as action_score
 from enriched e
), raw_ranked as (
 select * from classified order by abs(pct_change) desc nulls last limit (select lim from params)
), movers as (
 select * from classified where vet_class='candidate' and pct_change>=10
 order by action_score desc,pct_change desc limit 8
), noise as (
 select * from classified where vet_class in ('non_game','non_tournament','price_base_anomaly','thin_unconfirmed','thin_collectible')
 order by abs(pct_change) desc limit 8
)
select jsonb_build_object(
 'observed_date',(select source_date from params),'finish',p_finish,'price_type',p_price_type,'window',p_window,
 'raw',coalesce((select jsonb_agg(jsonb_build_object(
   'card_name',card_name,'set_name',set_name,'set_code',set_code,'finish',finish,'price_type',price_type,'window',move_window,
   'pct_change',pct_change,'old_price',old_price,'new_price',new_price,'source_url',source_url,'print_id',print_id,
   'product_id',product_id,'sku_id',sku_id,'scryfall_id',scryfall_id,'resolution_confidence',resolution_confidence
 ) order by abs(pct_change) desc) from raw_ranked),'[]'::jsonb),
 'early_movers',coalesce((select jsonb_agg(jsonb_build_object(
   'card_name',card_name,'set_name',set_name,'set_code',set_code,'finish',finish,'pct_change',pct_change,'old_price',old_price,'new_price',new_price,
   'market_pct',market_pct,'product_id',product_id,'sku_id',sku_id,'scryfall_id',scryfall_id,'avg_daily_qty_sold',avg_daily_qty_sold,
   'direct_available',direct_available,'direct_low',direct_low,'sku_market_price',sku_market_price,'ck_retail',ck_retail,'ck_buylist',ck_buylist,
   'manapool_retail',manapool_retail,'cardmarket_retail',cardmarket_retail,'action_score',action_score,'reasons',to_jsonb(reasons)
 ) order by action_score desc,pct_change desc) from movers),'[]'::jsonb),
 'noise',coalesce((select jsonb_agg(jsonb_build_object(
   'card_name',card_name,'set_name',set_name,'set_code',set_code,'finish',finish,'pct_change',pct_change,'old_price',old_price,'new_price',new_price,
   'vet_class',vet_class,'market_pct',market_pct,'product_id',product_id,'avg_daily_qty_sold',avg_daily_qty_sold,'direct_available',direct_available,
   'reasons',to_jsonb(reasons)
 ) order by abs(pct_change) desc) from noise),'[]'::jsonb)
);
$$;
revoke all on function public.ask_mtgstocks_interests_vetted_v1(text,text,text,text,integer) from public;
grant execute on function public.ask_mtgstocks_interests_vetted_v1(text,text,text,text,integer) to service_role;
