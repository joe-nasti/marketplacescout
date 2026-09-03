-- Persist the production vendor-depth/freshness extension to the market-wide
-- supply contract. TCGplayer remains the classification source; true CK and
-- ManaPool counts are reported independently and price presence is excluded.

CREATE OR REPLACE FUNCTION public.ask_collectish_market_supply_v1(p_product_id text DEFAULT NULL::text, p_sku_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.market_supply_snapshots%rowtype;
  age_hours numeric;
  depth_label text;
  days_cover numeric;
  velocity numeric;
  target_uuid uuid;
  target_finish text;
  target_condition text;
  ck_retail jsonb;
  ck_buylist jsonb;
  mp_depth jsonb;
  tcg_confidence text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if coalesce(p_sku_id,'')='' and coalesce(p_product_id,'')='' then raise exception 'product_id or sku_id required'; end if;

  select c.mtgjson_uuid,
         case when upper(coalesce(c.printing,'')) like '%FOIL%' and upper(coalesce(c.printing,'')) not like '%NON FOIL%' then 'foil' else 'nonfoil' end,
         case upper(coalesce(c.condition,''))
           when 'NEAR MINT' then 'NM'
           when 'LIGHTLY PLAYED' then 'EX'
           when 'MODERATELY PLAYED' then 'VG'
           when 'HEAVILY PLAYED' then 'G'
           else upper(coalesce(c.condition,''))
         end
    into target_uuid,target_finish,target_condition
  from public.scout_card_catalog c
  where (p_sku_id is null or c.sku_id=p_sku_id)
    and (p_product_id is null or c.product_id=p_product_id)
  order by case when p_sku_id is not null and c.sku_id=p_sku_id then 0 else 1 end
  limit 1;

  if target_uuid is not null then
    select jsonb_build_object(
      'available',true,
      'quantity',d.quantity,
      'listing_count',d.listing_count,
      'price',d.price,
      'condition',d.condition,
      'finish',d.finish,
      'measurement_scope',d.measurement_scope,
      'count_quality',d.count_quality,
      'is_executable',d.is_executable,
      'observed_at',d.observed_at,
      'age_hours',round(extract(epoch from (now()-d.observed_at))/3600.0,2),
      'freshness_status',case when now()-d.observed_at <= interval '36 hours' then 'FRESH' when now()-d.observed_at <= interval '72 hours' then 'STALE' else 'EXPIRED' end,
      'confidence',case when d.count_quality='exact' and now()-d.observed_at <= interval '36 hours' then 'HIGH' when now()-d.observed_at <= interval '72 hours' then 'MEDIUM' else 'LOW' end,
      'source_as_of',d.source_as_of,
      'source_as_of_raw',d.source_as_of_raw
    ) into ck_retail
    from public.vendor_item_identities i
    join public.vendor_depth_current d on d.source=i.source and d.source_item_key=i.source_item_key
    where i.source='cardkingdom' and i.mtgjson_uuid=target_uuid
      and i.finish=target_finish and d.lane='retail_supply'
      and d.finish=target_finish and d.condition=target_condition
      and upper(coalesce(d.language,'EN'))='EN'
    order by d.observed_at desc limit 1;

    select jsonb_build_object(
      'available',true,
      'remaining_acceptance',d.quantity,
      'buy_price',d.price,
      'condition_scope','UNSPECIFIED',
      'finish',d.finish,
      'measurement_scope',d.measurement_scope,
      'count_quality',d.count_quality,
      'is_executable',d.is_executable,
      'observed_at',d.observed_at,
      'age_hours',round(extract(epoch from (now()-d.observed_at))/3600.0,2),
      'freshness_status',case when now()-d.observed_at <= interval '36 hours' then 'FRESH' when now()-d.observed_at <= interval '72 hours' then 'STALE' else 'EXPIRED' end,
      'confidence',case when d.count_quality='exact' and now()-d.observed_at <= interval '36 hours' then 'HIGH' when now()-d.observed_at <= interval '72 hours' then 'MEDIUM' else 'LOW' end,
      'source_as_of',d.source_as_of,
      'source_as_of_raw',d.source_as_of_raw
    ) into ck_buylist
    from public.vendor_item_identities i
    join public.vendor_depth_current d on d.source=i.source and d.source_item_key=i.source_item_key
    where i.source='cardkingdom' and i.mtgjson_uuid=target_uuid
      and i.finish=target_finish and d.lane='buylist_demand' and d.finish=target_finish
    order by d.observed_at desc limit 1;

    select jsonb_build_object(
      'available',true,
      'quantity',sum(coalesce(d.quantity,0)),
      'listing_count',sum(coalesce(d.listing_count,0)),
      'lowest_price',min(d.price),
      'finish',target_finish,
      'measurement_scope',case when count(distinct d.measurement_scope)=1 then min(d.measurement_scope) else 'mixed_exact_card_depth' end,
      'count_quality',case when bool_and(d.count_quality='exact') then 'exact' else 'mixed' end,
      'observed_at',max(d.observed_at),
      'age_hours',round(extract(epoch from (now()-max(d.observed_at)))/3600.0,2),
      'freshness_status',case when now()-max(d.observed_at) <= interval '2 hours' then 'FRESH' when now()-max(d.observed_at) <= interval '12 hours' then 'STALE' else 'EXPIRED' end,
      'confidence',case when bool_and(d.count_quality='exact') and now()-max(d.observed_at) <= interval '2 hours' then 'HIGH' when now()-max(d.observed_at) <= interval '12 hours' then 'MEDIUM' else 'LOW' end
    ) into mp_depth
    from public.vendor_item_identities i
    join public.vendor_depth_current d on d.source=i.source and d.source_item_key=i.source_item_key
    where i.source='manapool' and i.mtgjson_uuid=target_uuid
      and i.finish=target_finish and d.finish=target_finish
      and d.lane in ('retail_supply','threshold_supply')
      and (target_condition='' or d.condition in (target_condition,'ALL'))
    having count(*)>0;
  end if;

  select s.* into r
  from public.market_supply_snapshots s
  where s.source='tcgplayer_marketplace'
    and (p_sku_id is null or s.sku_id=p_sku_id)
    and (p_product_id is null or s.product_id=p_product_id)
  order by s.observed_at desc,s.snapshot_id desc
  limit 1;

  if r.snapshot_id is null then
    return jsonb_build_object(
      'available',false,
      'global_supply_classification','UNPROVEN',
      'coverage_state','MISSING',
      'market_supply_confidence','UNPROVEN',
      'source_depth',jsonb_build_object(
        'cardkingdom_retail',coalesce(ck_retail,jsonb_build_object('available',false)),
        'cardkingdom_buylist_demand',coalesce(ck_buylist,jsonb_build_object('available',false)),
        'manapool',coalesce(mp_depth,jsonb_build_object('available',false,'note','No exact-card on-demand ManaPool depth snapshot is available.'))
      ),
      'freshness_policy',jsonb_build_object('tcgplayer_complete_max_hours',24,'cardkingdom_fresh_hours',36,'cardkingdom_expired_hours',72,'manapool_fresh_hours',2,'manapool_expired_hours',12),
      'note','No exact-SKU all-TCGplayer listing snapshot is available. Direct inventory alone cannot establish market-wide thin supply. Retailer stock counts are reported separately and do not convert an unproven TCGplayer classification into a global one.'
    );
  end if;

  age_hours := extract(epoch from (now()-r.observed_at))/3600.0;
  select nullif(x.avg_daily_qty_sold,0) into velocity
  from public.ask_collectish_public_internal_sku_evidence_v1(array[r.sku_id]::text[]) x
  where x.sku_id=r.sku_id limit 1;
  if velocity is not null and r.unit_count is not null then days_cover:=r.unit_count/velocity; end if;

  depth_label := case
    when r.coverage_state<>'COMPLETE' or age_hours>24 then 'UNPROVEN'
    when days_cover is not null and days_cover<7 then 'VERY_THIN'
    when days_cover is not null and days_cover<21 then 'THIN'
    when coalesce(r.unit_count,0)<=8 or coalesce(r.seller_count,0)<=3 then 'VERY_THIN'
    when coalesce(r.unit_count,0)<=25 and coalesce(r.seller_count,0)<=10 then 'THIN'
    when coalesce(r.unit_count,0)>=100 and coalesce(r.seller_count,0)>=20 then 'DEEP'
    else 'MODERATE'
  end;
  tcg_confidence := case when depth_label='UNPROVEN' then 'UNPROVEN' when age_hours<=6 then 'HIGH' else 'MEDIUM' end;

  return jsonb_build_object(
    'available',true,
    'source',r.source,
    'source_method',r.source_method,
    'observed_at',r.observed_at,
    'age_hours',round(age_hours,2),
    'coverage_state',r.coverage_state,
    'global_supply_classification',depth_label,
    'market_supply_confidence',tcg_confidence,
    'listing_count',r.listing_count,
    'seller_count',r.seller_count,
    'unit_count',r.unit_count,
    'direct_listing_count',r.direct_listing_count,
    'direct_seller_count',r.direct_seller_count,
    'direct_unit_count',r.direct_unit_count,
    'non_direct_listing_count',r.non_direct_listing_count,
    'non_direct_seller_count',r.non_direct_seller_count,
    'non_direct_unit_count',r.non_direct_unit_count,
    'direct_share_of_units',case when coalesce(r.unit_count,0)>0 then round(100.0*r.direct_unit_count/r.unit_count,1) end,
    'custom_listing_count',r.custom_listing_count,
    'lowest_price',r.lowest_price,
    'lowest_price_with_shipping',r.lowest_price_with_shipping,
    'avg_daily_qty_sold',velocity,
    'estimated_days_of_market_cover',case when days_cover is not null then round(days_cover,1) end,
    'source_depth',jsonb_build_object(
      'cardkingdom_retail',coalesce(ck_retail,jsonb_build_object('available',false)),
      'cardkingdom_buylist_demand',coalesce(ck_buylist,jsonb_build_object('available',false)),
      'manapool',coalesce(mp_depth,jsonb_build_object('available',false,'note','No exact-card on-demand ManaPool depth snapshot is available.'))
    ),
    'freshness_policy',jsonb_build_object('tcgplayer_complete_max_hours',24,'cardkingdom_fresh_hours',36,'cardkingdom_expired_hours',72,'manapool_fresh_hours',2,'manapool_expired_hours',12),
    'note','Global supply classification currently uses fresh, complete exact-SKU all-TCGplayer listing depth. Retailer inventory depth is reported separately as corroborating market-wide context; retailer price presence alone is never stock depth.'
  );
end
$function$
;

revoke all on function public.ask_collectish_market_supply_v1(text,text) from public,anon;
grant execute on function public.ask_collectish_market_supply_v1(text,text) to authenticated,service_role;

notify pgrst,'reload schema';
