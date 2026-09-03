-- Direct inventory/listings describe TCGplayer Direct only. Do not let the
-- legacy supply_type label masquerade as a market-wide supply conclusion.
-- Retailer prices are included as availability signals, not stock counts.

create or replace function public.ask_collectish_get_scout_card(p_product_id text default null, p_sku_id text default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  card jsonb;
  variants jsonb;
  variant_count int;
  shared jsonb;
  shared_card jsonb;
  vendor jsonb;
  v_uuid uuid;
  v_finish text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_product_id is null and p_sku_id is null then raise exception 'product_id or sku_id required'; end if;

  select to_jsonb(s) into card
  from public.scout_opportunities_v5 s
  where s.user_id=auth.uid()
    and (p_sku_id is null or s.sku_id=p_sku_id)
    and (p_product_id is null or s.product_id=p_product_id)
  order by s.promoted_score desc nulls last limit 1;

  if card is not null then
    select c.mtgjson_uuid,
           case when lower(coalesce(c.printing,'')) like '%foil%' then 'foil' else 'nonfoil' end
      into v_uuid,v_finish
    from public.scout_card_catalog c
    where c.sku_id=card->>'sku_id' limit 1;
    if v_uuid is not null then
      select jsonb_build_object(
        'cardkingdom_retail',v.cardkingdom_retail,
        'manapool_retail',v.manapool_retail,
        'cardmarket_retail',v.cardmarket_retail,
        'tcgplayer_retail',v.tcgplayer_retail,
        'observed_on',v.observed_on)
      into vendor
      from public.scout_vendor_price_current_cache v
      where v.mtgjson_uuid=v_uuid and v.finish=v_finish limit 1;
    end if;
    card := card || jsonb_build_object(
      'direct_supply_classification',card->>'supply_type',
      'global_supply_classification','UNPROVEN',
      'supply_scope','DIRECT_ONLY',
      'supply_scope_note','Direct inventory/listings measure TCGplayer Direct tightness only; do not infer market-wide thin supply without non-Direct/all-market or retailer stock depth.',
      'retailer_price_presence',coalesce(vendor,'{}'::jsonb));

    select count(*),coalesce(jsonb_agg(to_jsonb(v) order by v.promoted_score desc nulls last,v.set_name,v.collector_number),'[]'::jsonb)
      into variant_count,variants
    from (
      select sku_id,product_id,product_name,collector_number,set_name,set_code,printing,condition,language,
        promoted_score,promoted_grade,flag,latest_scan_at,observation_count,
        sku_market_price,tcg_low,low_with_shipping,direct_low,direct_available,direct_listings,
        avg_daily_qty_sold,sales_rank,supply_type,edhrec_rank,demand_signal,demand_signal_score,
        demand_adjustment,trend_adjustment,cheapest_buy,cheapest_source,direct_net_est,direct_net_profit,
        ck_buylist,manapool_retail,buylist_backed,buylist_roi_pct,direct_backed,near_direct_backed,confidence_label
      from public.scout_opportunities_v5 s2
      where s2.user_id=auth.uid() and lower(s2.product_name)=lower(card->>'product_name')
      order by s2.promoted_score desc nulls last,s2.observation_count desc limit 50
    ) v;

    return jsonb_build_object(
      'found',true,'scout_promoted',true,'identity_source','scout_opportunities_v5','card',card,
      'same_name_scope',jsonb_build_object(
        'product_name',card->>'product_name','variant_count',variant_count,'variants',variants,
        'scope_hint','Direct supply classification is not market-wide supply.'));
  end if;

  if p_sku_id is not null and p_sku_id<>'' then
    select to_jsonb(x) into shared
    from public.ask_collectish_public_internal_sku_evidence_v1(array[p_sku_id]::text[]) x
    where x.sku_id=p_sku_id limit 1;
  end if;

  if shared is null and p_product_id is not null and p_product_id<>'' then
    select to_jsonb(x) into shared
    from public.ask_collectish_public_internal_sku_evidence_v1(array(
      select c.sku_id::text
      from public.scout_card_catalog c
      where c.product_id=p_product_id
        and upper(coalesce(c.condition,''))='NEAR MINT'
        and upper(coalesce(c.language,''))='ENGLISH'
      order by case when upper(coalesce(c.printing,'')) in ('NON FOIL','NORMAL') then 0 else 1 end,c.sku_id
      limit 20)) x
    where x.product_id=p_product_id
    order by case when x.market_price is not null then 0 else 1 end,
             coalesce(x.sales_qty_14d,0) desc,
             coalesce(x.signal_count_14d,0) desc
    limit 1;
  end if;

  if shared is not null and coalesce(shared->>'sku_id','')<>'' then
    select c.mtgjson_uuid,
           case when lower(coalesce(c.printing,'')) like '%foil%' then 'foil' else 'nonfoil' end
      into v_uuid,v_finish
    from public.scout_card_catalog c
    where c.sku_id=shared->>'sku_id' limit 1;
    if v_uuid is not null then
      select jsonb_build_object(
        'cardkingdom_retail',v.cardkingdom_retail,
        'manapool_retail',v.manapool_retail,
        'cardmarket_retail',v.cardmarket_retail,
        'tcgplayer_retail',v.tcgplayer_retail,
        'observed_on',v.observed_on)
      into vendor
      from public.scout_vendor_price_current_cache v
      where v.mtgjson_uuid=v_uuid and v.finish=v_finish limit 1;
    end if;

    shared_card:=jsonb_build_object(
      'sku_id',shared->>'sku_id','product_id',shared->>'product_id','product_name',shared->>'card_name',
      'set_code',shared->>'set_code','set_name',shared->>'set_code','printing',shared->>'printing',
      'condition',shared->>'condition','language',shared->>'language',
      'sku_market_price',shared->'market_price','direct_low',shared->'direct_low',
      'direct_available',shared->'direct_available','direct_listings',shared->'direct_listings',
      'avg_daily_qty_sold',shared->'avg_daily_qty_sold','sales_rank',shared->'sales_rank',
      'supply_type',shared->>'supply_type',
      'direct_supply_classification',shared->>'supply_type',
      'global_supply_classification','UNPROVEN',
      'supply_scope','DIRECT_ONLY',
      'supply_scope_note','Direct inventory/listings measure TCGplayer Direct tightness only; do not infer market-wide thin supply without non-Direct/all-market or retailer stock depth.',
      'retailer_price_presence',coalesce(vendor,'{}'::jsonb),
      'shared_sales_qty_14d',shared->'sales_qty_14d','shared_sales_tx_14d',shared->'sales_tx_14d',
      'signal_count_14d',shared->'signal_count_14d','independent_sources_14d',shared->'independent_sources_14d');

    return jsonb_build_object(
      'found',true,'scout_promoted',false,'identity_source','shared_public_internal_sku_evidence','card',shared_card,
      'same_name_scope',jsonb_build_object(
        'product_name',shared->>'card_name','variant_count',1,'variants',jsonb_build_array(shared_card),
        'scope_hint','Exact SKU known to shared market evidence; Direct supply classification is not market-wide supply.'));
  end if;

  return jsonb_build_object('found',false,'scout_promoted',false);
end
$function$;

grant execute on function public.ask_collectish_get_scout_card(text,text) to authenticated,service_role;
