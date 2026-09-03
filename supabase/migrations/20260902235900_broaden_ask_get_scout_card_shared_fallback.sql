create or replace function public.ask_collectish_get_scout_card(p_product_id text default null, p_sku_id text default null)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  card jsonb;
  variants jsonb;
  variant_count int;
  shared jsonb;
  shared_card jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_product_id is null and p_sku_id is null then raise exception 'product_id or sku_id required'; end if;

  select to_jsonb(s)
  into card
  from public.scout_opportunities_v5 s
  where s.user_id = auth.uid()
    and (p_sku_id is null or s.sku_id = p_sku_id)
    and (p_product_id is null or s.product_id = p_product_id)
  order by s.promoted_score desc nulls last
  limit 1;

  if card is not null then
    select count(*), coalesce(jsonb_agg(to_jsonb(v) order by v.promoted_score desc nulls last, v.set_name, v.collector_number), '[]'::jsonb)
    into variant_count, variants
    from (
      select sku_id,product_id,product_name,collector_number,set_name,set_code,printing,condition,language,
        promoted_score,promoted_grade,flag,latest_scan_at,observation_count,
        sku_market_price,tcg_low,low_with_shipping,direct_low,direct_available,direct_listings,
        avg_daily_qty_sold,sales_rank,supply_type,edhrec_rank,demand_signal,demand_signal_score,
        demand_adjustment,trend_adjustment,cheapest_buy,cheapest_source,direct_net_est,direct_net_profit,
        ck_buylist,manapool_retail,buylist_backed,buylist_roi_pct,direct_backed,near_direct_backed,confidence_label
      from public.scout_opportunities_v5 s2
      where s2.user_id = auth.uid() and lower(s2.product_name)=lower(card->>'product_name')
      order by s2.promoted_score desc nulls last, s2.observation_count desc
      limit 50
    ) v;

    return jsonb_build_object(
      'found', true,
      'scout_promoted', true,
      'identity_source', 'scout_opportunities_v5',
      'card', card,
      'same_name_scope', jsonb_build_object(
        'product_name', card->>'product_name',
        'variant_count', variant_count,
        'variants', variants,
        'scope_hint', 'If the user asks about this card name generally, compare same-name Scout variants. Stay exact when the user says this/current/exact printing, version, product, or SKU.'
      )
    );
  end if;

  if p_sku_id is not null and p_sku_id <> '' then
    select to_jsonb(x)
    into shared
    from public.ask_collectish_public_internal_sku_evidence_v1(array[p_sku_id]::text[]) x
    where x.sku_id = p_sku_id
    limit 1;
  end if;

  if shared is null and p_product_id is not null and p_product_id <> '' then
    select to_jsonb(x)
    into shared
    from public.ask_collectish_public_internal_sku_evidence_v1(
      array(
        select c.sku_id::text
        from public.scout_card_catalog c
        where c.product_id = p_product_id
          and upper(coalesce(c.condition,'')) = 'NEAR MINT'
          and upper(coalesce(c.language,'')) = 'ENGLISH'
        order by case when upper(coalesce(c.printing,'')) in ('NON FOIL','NORMAL') then 0 else 1 end, c.sku_id
        limit 20
      )
    ) x
    where x.product_id = p_product_id
    order by case when x.market_price is not null then 0 else 1 end,
             coalesce(x.sales_qty_14d,0) desc,
             coalesce(x.signal_count_14d,0) desc
    limit 1;
  end if;

  if shared is not null and coalesce(shared->>'sku_id','') <> '' then
    shared_card := jsonb_build_object(
      'sku_id', shared->>'sku_id',
      'product_id', shared->>'product_id',
      'product_name', shared->>'card_name',
      'set_code', shared->>'set_code',
      'set_name', shared->>'set_code',
      'printing', shared->>'printing',
      'condition', shared->>'condition',
      'language', shared->>'language',
      'sku_market_price', shared->'market_price',
      'direct_low', shared->'direct_low',
      'direct_available', shared->'direct_available',
      'direct_listings', shared->'direct_listings',
      'avg_daily_qty_sold', shared->'avg_daily_qty_sold',
      'sales_rank', shared->'sales_rank',
      'supply_type', shared->>'supply_type',
      'edhrec_rank', shared->'edhrec_rank',
      'demand_signal', shared->>'demand_signal',
      'demand_signal_score', shared->'demand_signal_score',
      'promoted_score', shared->'scout_score',
      'promoted_grade', shared->>'scout_grade',
      'buylist_backed', shared->'buylist_backed',
      'ck_buylist', shared->'ck_buylist',
      'shared_sales_qty_14d', shared->'sales_qty_14d',
      'shared_sales_tx_14d', shared->'sales_tx_14d',
      'signal_count_14d', shared->'signal_count_14d',
      'independent_sources_14d', shared->'independent_sources_14d'
    );

    return jsonb_build_object(
      'found', true,
      'scout_promoted', false,
      'identity_source', 'shared_public_internal_sku_evidence',
      'card', shared_card,
      'same_name_scope', jsonb_build_object(
        'product_name', shared->>'card_name',
        'variant_count', 1,
        'variants', jsonb_build_array(shared_card),
        'scope_hint', 'This exact SKU is known to Collectish shared market evidence but is not currently a promoted Scout opportunity.'
      )
    );
  end if;

  return jsonb_build_object('found', false, 'scout_promoted', false);
end
$function$;
