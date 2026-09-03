-- Source-specific freshness and confidence for market-wide supply.
--
-- Key semantic rule: deep/moderate complete TCGplayer depth can disprove a
-- market-wide thin-supply claim, but TCGplayer thinness alone cannot prove that
-- the broader market is thin. THIN / VERY_THIN therefore requires fresh
-- retailer quantity corroboration.
--
-- Also keep ManaPool total retail stock and threshold/optimizer depth in
-- separate lanes so the same copies are never summed twice.

create or replace function public.ask_collectish_market_supply_v1(
  p_product_id text default null,
  p_sku_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  r public.market_supply_snapshots%rowtype;
  age_hours numeric;
  tcg_label text;
  global_label text;
  days_cover numeric;
  velocity numeric;
  target_uuid uuid;
  target_finish text;
  target_condition text;
  ck_retail jsonb;
  ck_buylist jsonb;
  mp_retail jsonb;
  mp_threshold jsonb;
  tcg_freshness text;
  tcg_confidence text;
  market_confidence text;
  claim_basis text;
  thinness_proven boolean := false;
  ck_fresh boolean := false;
  mp_fresh boolean := false;
  ck_qty integer;
  mp_qty integer;
  retailer_qty integer := 0;
  retailer_fresh_sources integer := 0;
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
      'available',true,'quantity',d.quantity,'listing_count',d.listing_count,'price',d.price,
      'condition',d.condition,'finish',d.finish,'measurement_scope',d.measurement_scope,
      'count_quality',d.count_quality,'is_executable',d.is_executable,'observed_at',d.observed_at,
      'age_hours',round(extract(epoch from (now()-d.observed_at))/3600.0,2),
      'freshness_status',case when now()-d.observed_at <= interval '36 hours' then 'FRESH' when now()-d.observed_at <= interval '72 hours' then 'STALE' else 'EXPIRED' end,
      'usable_for_market_claim',now()-d.observed_at <= interval '36 hours' and d.count_quality='exact',
      'confidence',case when d.count_quality='exact' and now()-d.observed_at <= interval '36 hours' then 'HIGH' when now()-d.observed_at <= interval '72 hours' then 'MEDIUM' else 'LOW' end,
      'source_as_of',d.source_as_of,'source_as_of_raw',d.source_as_of_raw
    ) into ck_retail
    from public.vendor_item_identities i
    join public.vendor_depth_current d on d.source=i.source and d.source_item_key=i.source_item_key
    where i.source='cardkingdom' and i.mtgjson_uuid=target_uuid
      and i.finish=target_finish and d.lane='retail_supply' and d.finish=target_finish
      and d.condition=target_condition and upper(coalesce(d.language,'EN'))='EN'
    order by d.observed_at desc limit 1;

    select jsonb_build_object(
      'available',true,'remaining_acceptance',d.quantity,'buy_price',d.price,
      'condition_scope','UNSPECIFIED','finish',d.finish,'measurement_scope',d.measurement_scope,
      'count_quality',d.count_quality,'is_executable',d.is_executable,'observed_at',d.observed_at,
      'age_hours',round(extract(epoch from (now()-d.observed_at))/3600.0,2),
      'freshness_status',case when now()-d.observed_at <= interval '36 hours' then 'FRESH' when now()-d.observed_at <= interval '72 hours' then 'STALE' else 'EXPIRED' end,
      'confidence',case when d.count_quality='exact' and now()-d.observed_at <= interval '36 hours' then 'HIGH' when now()-d.observed_at <= interval '72 hours' then 'MEDIUM' else 'LOW' end,
      'source_as_of',d.source_as_of,'source_as_of_raw',d.source_as_of_raw
    ) into ck_buylist
    from public.vendor_item_identities i
    join public.vendor_depth_current d on d.source=i.source and d.source_item_key=i.source_item_key
    where i.source='cardkingdom' and i.mtgjson_uuid=target_uuid
      and i.finish=target_finish and d.lane='buylist_demand' and d.finish=target_finish
    order by d.observed_at desc limit 1;

    -- ManaPool total retail stock: exact resolved printing/finish/condition only.
    -- Do not mix threshold_supply into this total.
    select jsonb_build_object(
      'available',true,'quantity',d.quantity,'listing_count',d.listing_count,'lowest_price',d.price,
      'condition',d.condition,'finish',d.finish,'measurement_scope',d.measurement_scope,
      'count_quality',d.count_quality,'observed_at',d.observed_at,
      'age_hours',round(extract(epoch from (now()-d.observed_at))/3600.0,2),
      'freshness_status',case when now()-d.observed_at <= interval '2 hours' then 'FRESH' when now()-d.observed_at <= interval '12 hours' then 'STALE' else 'EXPIRED' end,
      'usable_for_market_claim',now()-d.observed_at <= interval '2 hours' and d.count_quality in ('exact','aggregate'),
      'confidence',case when d.count_quality in ('exact','aggregate') and now()-d.observed_at <= interval '2 hours' then 'HIGH' when now()-d.observed_at <= interval '12 hours' then 'MEDIUM' else 'LOW' end
    ) into mp_retail
    from public.vendor_item_identities i
    join public.vendor_depth_current d on d.source=i.source and d.source_item_key=i.source_item_key
    where i.source='manapool' and i.mtgjson_uuid=target_uuid
      and i.finish=target_finish and d.finish=target_finish and d.lane='retail_supply'
      and (target_condition='' or d.condition in (target_condition,'ALL'))
    order by d.observed_at desc limit 1;

    -- Optimizer/threshold depth is useful executable context, not total stock.
    select jsonb_build_object(
      'available',true,'quantity',d.quantity,'listing_count',d.listing_count,
      'threshold_price',d.threshold_price,'condition',d.condition,'finish',d.finish,
      'measurement_scope',d.measurement_scope,'count_quality',d.count_quality,'observed_at',d.observed_at,
      'age_hours',round(extract(epoch from (now()-d.observed_at))/3600.0,2),
      'freshness_status',case when now()-d.observed_at <= interval '2 hours' then 'FRESH' when now()-d.observed_at <= interval '12 hours' then 'STALE' else 'EXPIRED' end,
      'confidence',case when now()-d.observed_at <= interval '2 hours' then 'MEDIUM' when now()-d.observed_at <= interval '12 hours' then 'LOW' else 'EXPIRED' end,
      'note','Optimizer-selected offers at/below threshold; not added to ManaPool total retail stock.'
    ) into mp_threshold
    from public.vendor_item_identities i
    join public.vendor_depth_current d on d.source=i.source and d.source_item_key=i.source_item_key
    where i.source='manapool' and i.mtgjson_uuid=target_uuid
      and i.finish=target_finish and d.finish=target_finish and d.lane='threshold_supply'
      and (target_condition='' or d.condition in (target_condition,'ALL'))
    order by d.observed_at desc limit 1;
  end if;

  ck_fresh := coalesce((ck_retail->>'usable_for_market_claim')::boolean,false);
  mp_fresh := coalesce((mp_retail->>'usable_for_market_claim')::boolean,false);
  ck_qty := case when ck_fresh then nullif(ck_retail->>'quantity','')::integer end;
  mp_qty := case when mp_fresh then nullif(mp_retail->>'quantity','')::integer end;
  retailer_fresh_sources := (case when ck_fresh then 1 else 0 end) + (case when mp_fresh then 1 else 0 end);
  retailer_qty := coalesce(ck_qty,0)+coalesce(mp_qty,0);

  select s.* into r
  from public.market_supply_snapshots s
  where s.source='tcgplayer_marketplace'
    and (p_sku_id is null or s.sku_id=p_sku_id)
    and (p_product_id is null or s.product_id=p_product_id)
  order by s.observed_at desc,s.snapshot_id desc limit 1;

  if r.snapshot_id is null then
    return jsonb_build_object(
      'available',false,'usable_for_classification',false,
      'tcgplayer_supply_classification','UNPROVEN','global_supply_classification','UNPROVEN',
      'coverage_state','MISSING','market_supply_confidence','UNPROVEN','market_wide_thinness_proven',false,
      'claim_basis','NO_TCGPLAYER_EXACT_SKU_SNAPSHOT',
      'source_depth',jsonb_build_object(
        'cardkingdom_retail',coalesce(ck_retail,jsonb_build_object('available',false)),
        'cardkingdom_buylist_demand',coalesce(ck_buylist,jsonb_build_object('available',false)),
        'manapool',coalesce(mp_retail,jsonb_build_object('available',false)),
        'manapool_retail',coalesce(mp_retail,jsonb_build_object('available',false)),
        'manapool_threshold',coalesce(mp_threshold,jsonb_build_object('available',false))
      ),
      'source_coverage',jsonb_build_object('fresh_retailer_depth_sources',retailer_fresh_sources,'fresh_retailer_quantity',retailer_qty),
      'freshness_policy',jsonb_build_object('tcgplayer_high_confidence_hours',6,'tcgplayer_expired_hours',24,'cardkingdom_fresh_hours',36,'cardkingdom_expired_hours',72,'manapool_fresh_hours',2,'manapool_expired_hours',12),
      'note','No fresh exact-SKU all-TCGplayer listing snapshot is available. Retailer depth may be reported, but Direct or retailer evidence alone cannot prove market-wide thin supply.'
    );
  end if;

  age_hours := extract(epoch from (now()-r.observed_at))/3600.0;
  tcg_freshness := case when r.coverage_state<>'COMPLETE' then 'INCOMPLETE' when age_hours<=6 then 'FRESH' when age_hours<=24 then 'AGING' else 'EXPIRED' end;

  select nullif(x.avg_daily_qty_sold,0) into velocity
  from public.ask_collectish_public_internal_sku_evidence_v1(array[r.sku_id]::text[]) x
  where x.sku_id=r.sku_id limit 1;
  if velocity is not null and r.unit_count is not null then days_cover:=r.unit_count/velocity; end if;

  tcg_label := case
    when r.coverage_state<>'COMPLETE' or age_hours>24 then 'UNPROVEN'
    when days_cover is not null and days_cover<7 then 'VERY_THIN'
    when days_cover is not null and days_cover<21 then 'THIN'
    when coalesce(r.unit_count,0)<=8 or coalesce(r.seller_count,0)<=3 then 'VERY_THIN'
    when coalesce(r.unit_count,0)<=25 and coalesce(r.seller_count,0)<=10 then 'THIN'
    when coalesce(r.unit_count,0)>=100 and coalesce(r.seller_count,0)>=20 then 'DEEP'
    else 'MODERATE'
  end;
  tcg_confidence := case when tcg_label='UNPROVEN' then 'UNPROVEN' when age_hours<=6 then 'HIGH' else 'MEDIUM' end;

  -- Asymmetric evidence standard:
  -- * DEEP/MODERATE TCGplayer depth is already enough evidence that the exact
  --   printing is not globally thin.
  -- * THIN/VERY_THIN needs both CK and ManaPool fresh total-stock depth to make
  --   a market-wide thinness claim. A retailer-heavy result can instead reject
  --   thinness even when TCGplayer itself is tight.
  if tcg_label='UNPROVEN' then
    global_label := 'UNPROVEN'; market_confidence := 'UNPROVEN'; claim_basis := 'TCGPLAYER_STALE_OR_INCOMPLETE';
  elsif tcg_label in ('DEEP','MODERATE') then
    global_label := tcg_label; market_confidence := tcg_confidence; claim_basis := 'TCGPLAYER_DEPTH_DISPROVES_GLOBAL_THINNESS';
  elsif retailer_fresh_sources=2 and retailer_qty<=8 then
    global_label := tcg_label; market_confidence := case when tcg_confidence='HIGH' then 'HIGH' else 'MEDIUM' end;
    thinness_proven := true; claim_basis := 'TCGPLAYER_THINNESS_CORROBORATED_BY_CK_AND_MANAPOOL';
  elsif retailer_fresh_sources>=1 and retailer_qty>=25 then
    global_label := 'MODERATE'; market_confidence := case when retailer_fresh_sources=2 and tcg_confidence='HIGH' then 'HIGH' else 'MEDIUM' end;
    claim_basis := 'RETAILER_DEPTH_REJECTS_TCGPLAYER_THINNESS';
  else
    global_label := 'UNPROVEN'; market_confidence := 'LOW'; claim_basis := 'TCGPLAYER_THIN_RETAILER_CORROBORATION_INCOMPLETE';
  end if;

  return jsonb_build_object(
    'available',true,
    'usable_for_classification',tcg_label<>'UNPROVEN',
    'source',r.source,'source_method',r.source_method,'observed_at',r.observed_at,'age_hours',round(age_hours,2),
    'coverage_state',r.coverage_state,'freshness_status',tcg_freshness,'tcgplayer_confidence',tcg_confidence,
    'tcgplayer_supply_classification',tcg_label,
    'global_supply_classification',global_label,
    'market_supply_confidence',market_confidence,
    'market_wide_thinness_proven',thinness_proven,
    'claim_basis',claim_basis,
    'listing_count',r.listing_count,'seller_count',r.seller_count,'unit_count',r.unit_count,
    'direct_listing_count',r.direct_listing_count,'direct_seller_count',r.direct_seller_count,'direct_unit_count',r.direct_unit_count,
    'non_direct_listing_count',r.non_direct_listing_count,'non_direct_seller_count',r.non_direct_seller_count,'non_direct_unit_count',r.non_direct_unit_count,
    'direct_share_of_units',case when coalesce(r.unit_count,0)>0 then round(100.0*r.direct_unit_count/r.unit_count,1) end,
    'custom_listing_count',r.custom_listing_count,'lowest_price',r.lowest_price,'lowest_price_with_shipping',r.lowest_price_with_shipping,
    'avg_daily_qty_sold',velocity,'estimated_days_of_market_cover',case when days_cover is not null then round(days_cover,1) end,
    'source_depth',jsonb_build_object(
      'cardkingdom_retail',coalesce(ck_retail,jsonb_build_object('available',false)),
      'cardkingdom_buylist_demand',coalesce(ck_buylist,jsonb_build_object('available',false)),
      'manapool',coalesce(mp_retail,jsonb_build_object('available',false)),
      'manapool_retail',coalesce(mp_retail,jsonb_build_object('available',false)),
      'manapool_threshold',coalesce(mp_threshold,jsonb_build_object('available',false))
    ),
    'source_coverage',jsonb_build_object(
      'fresh_retailer_depth_sources',retailer_fresh_sources,
      'expected_retailer_depth_sources',2,
      'fresh_retailer_quantity',retailer_qty,
      'cardkingdom_fresh',ck_fresh,
      'manapool_fresh',mp_fresh
    ),
    'freshness_policy',jsonb_build_object(
      'tcgplayer_high_confidence_hours',6,'tcgplayer_expired_hours',24,
      'cardkingdom_fresh_hours',36,'cardkingdom_expired_hours',72,
      'manapool_fresh_hours',2,'manapool_expired_hours',12
    ),
    'note',case
      when claim_basis='TCGPLAYER_DEPTH_DISPROVES_GLOBAL_THINNESS' then 'Fresh complete TCGplayer depth is sufficient to reject a market-wide thin-supply claim; retailer quantities remain independent corroborating context.'
      when claim_basis='TCGPLAYER_THINNESS_CORROBORATED_BY_CK_AND_MANAPOOL' then 'Thin TCGplayer depth is corroborated by fresh exact/aggregate total-stock depth at both Card Kingdom and ManaPool.'
      when claim_basis='RETAILER_DEPTH_REJECTS_TCGPLAYER_THINNESS' then 'TCGplayer is tight, but fresh retailer stock depth shows meaningful supply outside TCGplayer.'
      when claim_basis='TCGPLAYER_THIN_RETAILER_CORROBORATION_INCOMPLETE' then 'TCGplayer is thin, but fresh retailer depth is incomplete or not uniformly thin; broader-market thinness remains unproven.'
      else 'Market-wide classification is unproven because the exact-SKU TCGplayer snapshot is stale or incomplete.'
    end
  );
end
$$;

revoke all on function public.ask_collectish_market_supply_v1(text,text) from public,anon;
grant execute on function public.ask_collectish_market_supply_v1(text,text) to authenticated,service_role;

notify pgrst,'reload schema';
