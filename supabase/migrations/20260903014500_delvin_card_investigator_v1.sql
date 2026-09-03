create or replace function public.ask_delvin_card_investigation_v1(p_card_name text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_name text;
  v_rows jsonb;
  v_signal jsonb;
begin
  select c.product_name into v_name
  from public.scout_opportunities_v5_cache c
  where lower(c.product_name)=lower(trim(p_card_name))
  order by c.promoted_score desc nulls last
  limit 1;

  if v_name is null then
    select c.product_name into v_name
    from public.scout_opportunities_v5_cache c
    where lower(c.product_name) like '%'||lower(trim(p_card_name))||'%'
    order by length(c.product_name),c.promoted_score desc nulls last
    limit 1;
  end if;

  if v_name is null then
    return jsonb_build_object('ok',false,'error','I could not resolve that card in the current Scout universe.');
  end if;

  with base as (
    select c.*
    from public.scout_opportunities_v5_cache c
    where lower(c.product_name)=lower(v_name)
      and lower(coalesce(c.condition,'')) in ('near mint','nm')
      and lower(coalesce(c.language,''))='english'
    order by c.promoted_score desc nulls last,c.avg_daily_qty_sold desc nulls last
    limit 12
  ), enriched as (
    select b.*,
      p24.market_price as market_24h_ago,
      case when p24.market_price is not null and p24.market_price<>0 and b.sku_market_price is not null
        then round(((b.sku_market_price-p24.market_price)/p24.market_price)*100,1) end as market_change_24h_pct,
      p7.market_price as market_7d_ago,
      case when p7.market_price is not null and p7.market_price<>0 and b.sku_market_price is not null
        then round(((b.sku_market_price-p7.market_price)/p7.market_price)*100,1) end as market_change_7d_pct
    from base b
    left join lateral (
      select h.market_price from public.tcgplayer_official_sku_price_history h
      where h.sku_id=b.sku_id and h.observed_at <= now()-interval '24 hours'
      order by h.observed_at desc limit 1
    ) p24 on true
    left join lateral (
      select h.market_price from public.tcgplayer_official_sku_price_history h
      where h.sku_id=b.sku_id and h.observed_at <= now()-interval '7 days'
      order by h.observed_at desc limit 1
    ) p7 on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sku_id',sku_id,'product_id',product_id,'card_name',product_name,'set_code',set_code,'set_name',set_name,
    'collector_number',collector_number,'printing',printing,'grade',promoted_grade,'score',promoted_score,
    'market',sku_market_price,'market_change_24h_pct',market_change_24h_pct,'market_change_7d_pct',market_change_7d_pct,
    'tcg_low',tcg_low,'direct_low',direct_low,'direct_available',direct_available,'direct_listings',direct_listings,
    'avg_daily_qty_sold',avg_daily_qty_sold,'sales_rank',sales_rank,'cheapest_buy',cheapest_buy,'cheapest_source',cheapest_source,
    'direct_net_est',direct_net_est,'direct_net_profit',direct_net_profit,'ck_buylist',ck_buylist,'buylist_backed',buylist_backed,
    'confidence',confidence_label,'demand_signal',demand_signal,'edhrec_rank',edhrec_rank
  ) order by promoted_score desc nulls last,avg_daily_qty_sold desc nulls last),'[]'::jsonb)
  into v_rows from enriched;

  select jsonb_build_object(
    'observed_at',o.observed_at,'evidence_tier',o.evidence_tier,'source_count',o.source_count,
    'sources',o.sources,'signal_score',o.signal_score,'baseline_market',o.baseline_market,
    'baseline_direct_low',o.baseline_direct_low,'baseline_direct_available',o.baseline_direct_available,
    'baseline_sales_day',o.baseline_sales_day,'payload',o.payload
  ) into v_signal
  from public.delvin_signal_observations o
  where lower(o.card_name)=lower(v_name)
  order by o.observed_at desc limit 1;

  return jsonb_build_object('ok',true,'card_name',v_name,'printings',v_rows,'latest_radar_signal',v_signal,'generated_at',now());
end;
$$;

revoke all on function public.ask_delvin_card_investigation_v1(text) from public,anon,authenticated;
grant execute on function public.ask_delvin_card_investigation_v1(text) to service_role;
