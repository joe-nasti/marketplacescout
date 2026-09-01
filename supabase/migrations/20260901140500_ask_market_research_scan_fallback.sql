-- Canonical source for the production hotfixes applied as
-- broaden_ask_market_investigation_identity,
-- make_ask_market_timeline_intraday,
-- add_official_price_history_to_ask_timeline, and
-- secure_ask_market_timeline_official_history.
--
-- Market-move research must not require an exact SKU to already be promoted into
-- scout_opportunities_v5. Marketplace Scan is a valid user-scoped identity source,
-- while official TCGplayer SKU history supplies the shared intraday price timeline.

CREATE OR REPLACE FUNCTION public.ask_collectish_market_investigation_v3(p_product_id text DEFAULT NULL::text, p_sku_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  scout_row jsonb := null;
  scan_row jsonb := null;
  card_row jsonb := null;
  merged_scout jsonb := '{}'::jsonb;
  sales jsonb := '{}'::jsonb;
  supply jsonb := '{}'::jsonb;
  edh jsonb := '{}'::jsonb;
  roll jsonb := '{}'::jsonb;
  claims jsonb := '[]'::jsonb;
  v_sku text;
  v_product text;
  v_scry text;
  v_name text;
  v_set text;
  v_printing text;
  v_condition text;
  v_language text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_product_id is null and p_sku_id is null then
    return jsonb_build_object('available',false,'reason','product_id or sku_id required');
  end if;

  select to_jsonb(x) into scout_row
  from public.scout_opportunities_v5 x
  where x.user_id=auth.uid()
    and (p_sku_id is null or x.sku_id=p_sku_id)
    and (p_product_id is null or x.product_id=p_product_id)
  order by x.latest_scan_at desc nulls last, x.promoted_score desc nulls last
  limit 1;

  select to_jsonb(z) into scan_row
  from (
    select r.*, sc.captured_at as latest_scan_at
    from public.marketplace_scan_rows r
    join public.marketplace_scans sc on sc.scan_id=r.scan_id and sc.user_id=r.user_id
    where r.user_id=auth.uid()
      and (p_sku_id is null or r.sku_id=p_sku_id)
      and (p_product_id is null or r.product_id=p_product_id)
    order by sc.captured_at desc
    limit 1
  ) z;

  if scout_row is null and scan_row is null then
    return jsonb_build_object('available',false,'reason','No current Scout or Marketplace Scan card matched the supplied identifiers.');
  end if;

  merged_scout := coalesce(scan_row,'{}'::jsonb) || coalesce(scout_row,'{}'::jsonb);
  card_row := case when scout_row is not null then scout_row else scan_row end;
  v_sku := coalesce(p_sku_id, card_row->>'sku_id');
  v_product := coalesce(p_product_id, card_row->>'product_id');
  v_scry := nullif(coalesce(scout_row->>'scryfall_id',scan_row->>'scryfall_id'),'');
  v_name := coalesce(scout_row->>'product_name',scan_row->>'product_name');
  v_set := coalesce(scout_row->>'set_name',scan_row->>'set_name');
  v_printing := coalesce(scout_row->>'printing',scan_row->>'printing');
  v_condition := coalesce(scout_row->>'condition',scan_row->>'condition');
  v_language := coalesce(scout_row->>'language',scan_row->>'language');

  begin
    with b as (
      select bucket_start_date, market_price, low_sale_price, high_sale_price, quantity_sold, transaction_count, observed_at
      from public.marketplace_sku_sales_buckets
      where user_id=auth.uid() and sku_id=v_sku and bucket_start_date>=current_date-90
      order by bucket_start_date
    ), a as (
      select count(*) buckets,
             coalesce(sum(quantity_sold),0) units,
             coalesce(sum(transaction_count),0) transactions,
             min(bucket_start_date) from_date,
             max(bucket_start_date) to_date,
             min(nullif(low_sale_price,0)) low_sold,
             max(high_sale_price) high_sold,
             min(market_price) market_low,
             max(market_price) market_high,
             max(observed_at) observed_at
      from b
    )
    select jsonb_build_object(
      'scope','exact_sku','sku_id',v_sku,'summary',to_jsonb(a),
      'buckets',coalesce((select jsonb_agg(to_jsonb(b) order by bucket_start_date) from b),'[]'::jsonb)
    ) into sales from a;
  exception when others then
    sales := jsonb_build_object('available',false,'error','sales unavailable');
  end;

  begin
    with h as (
      select sc.captured_at,r.direct_low,r.direct_available,r.direct_listings,r.supply_type,r.sku_market_price
      from public.marketplace_scan_rows r
      join public.marketplace_scans sc on sc.scan_id=r.scan_id and sc.user_id=r.user_id
      where r.user_id=auth.uid() and r.sku_id=v_sku and sc.captured_at>=now()-interval '90 days'
      order by sc.captured_at
      limit 240
    )
    select jsonb_build_object(
      'scope','exact_sku','count',count(*),
      'observations',coalesce(jsonb_agg(to_jsonb(h) order by captured_at),'[]'::jsonb),
      'current',coalesce((select to_jsonb(z) from h z order by captured_at desc limit 1),'{}'::jsonb)
    ) into supply from h;
  exception when others then
    supply := jsonb_build_object('available',false,'error','supply history unavailable','current','{}'::jsonb);
  end;

  begin
    edh := public.ask_collectish_shared_edhrec(v_product,v_scry);
  exception when others then
    edh := jsonb_build_object(
      'available',nullif(merged_scout->>'edhrec_rank','') is not null,
      'edhrec_rank',nullif(merged_scout->>'edhrec_rank','')::int,
      'source','scan_or_scout'
    );
  end;

  begin
    select to_jsonb(r) into roll
    from public.market_intel_entity_rollups_with_edhrec r
    where r.user_id=auth.uid()
      and (r.product_id=v_product or (v_scry is not null and r.scryfall_id::text=v_scry))
    order by r.latest_observed_at desc nulls last
    limit 1;
  exception when others then roll := '{}'::jsonb; end;

  begin
    with ids as (
      select distinct l.intel_id
      from public.market_intel_scout_signal_links l
      where l.user_id=auth.uid() and l.product_id=v_product
    ), c as (
      select i.intel_id,i.source_type,i.source_name,i.source_url,i.title,i.author,i.summary,i.direction,i.signal_stage,i.confidence,i.published_at,i.observed_at
      from public.market_intel_items i join ids on ids.intel_id=i.intel_id
      where i.user_id=auth.uid()
      order by i.observed_at desc nulls last
      limit 12
    )
    select coalesce(jsonb_agg(to_jsonb(c) order by observed_at desc),'[]'::jsonb) into claims from c;
  exception when others then claims := '[]'::jsonb; end;

  return jsonb_build_object(
    'available',true,
    'card',jsonb_build_object(
      'sku_id',v_sku,'product_id',v_product,'product_name',v_name,'set_name',v_set,
      'printing',v_printing,'condition',v_condition,'language',v_language
    ),
    'scout',merged_scout,
    'shared_sales',coalesce(sales,'{}'::jsonb),
    'exact_supply',coalesce(supply,'{}'::jsonb),
    'edhrec_current',coalesce(edh,'{}'::jsonb),
    'edhrec_history',jsonb_build_object(
      'count',case when coalesce((edh->>'available')::boolean,false) then 1 else 0 end,
      'source',edh->>'source',
      'observations',case when coalesce((edh->>'available')::boolean,false)
        then jsonb_build_array(jsonb_build_object('captured_at',edh->>'observed_at','edhrec_rank',nullif(edh->>'edhrec_rank','')::int))
        else '[]'::jsonb end
    ),
    'market_intelligence',jsonb_build_object(
      'rollup',coalesce(roll,'{}'::jsonb),'claims',coalesce(claims,'[]'::jsonb),
      'fresh_claims_7d',coalesce((select count(*) from jsonb_array_elements(coalesce(claims,'[]'::jsonb)) x where nullif(x->>'observed_at','')::timestamptz>=now()-interval '7 days'),0)
    ),
    'investigation_version',case when scout_row is null then 'v3_scan_fallback' else 'v3' end,
    'identity_source',case when scout_row is null then 'marketplace_scan_rows' else 'scout_opportunities_v5' end,
    'snapshot_at',now()
  );
end
$function$;

grant execute on function public.ask_collectish_market_investigation_v3(text,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ask_collectish_market_timeline_v1(p_product_id text DEFAULT NULL::text, p_sku_id text DEFAULT NULL::text, p_days integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  scout_row jsonb := null;
  scan_row jsonb := null;
  base_row jsonb := null;
  ev jsonb := '[]'::jsonb;
  v_sku text;
  v_product text;
  v_name text;
  v_set text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  p_days := greatest(30, least(coalesce(p_days,120),365));

  select to_jsonb(x) into scout_row
  from public.scout_opportunities_v5 x
  where x.user_id=auth.uid()
    and (p_sku_id is null or x.sku_id=p_sku_id)
    and (p_product_id is null or x.product_id=p_product_id)
  order by x.latest_scan_at desc nulls last
  limit 1;

  select to_jsonb(z) into scan_row
  from (
    select r.*, sc.captured_at as latest_scan_at
    from public.marketplace_scan_rows r
    join public.marketplace_scans sc on sc.scan_id=r.scan_id and sc.user_id=r.user_id
    where r.user_id=auth.uid()
      and (p_sku_id is null or r.sku_id=p_sku_id)
      and (p_product_id is null or r.product_id=p_product_id)
    order by sc.captured_at desc
    limit 1
  ) z;

  if scout_row is null and scan_row is null then
    return jsonb_build_object('available',false,'reason','No current Scout or Marketplace Scan card matched the supplied identifiers.');
  end if;

  base_row := case when scout_row is not null then scout_row else scan_row end;
  v_sku := coalesce(p_sku_id,base_row->>'sku_id');
  v_product := coalesce(p_product_id,base_row->>'product_id');
  v_name := coalesce(scout_row->>'product_name',scan_row->>'product_name');
  v_set := coalesce(scout_row->>'set_name',scan_row->>'set_name');

  with official_points as (
    select observed_at, market_price,
      lag(market_price) over(order by observed_at) prev_market
    from public.tcgplayer_official_sku_price_history
    where sku_id=v_sku
      and observed_at >= now() - make_interval(days=>p_days)
    order by observed_at
  ), official_price_events as (
    select observed_at event_at,'price'::text kind,
      'Market repriced'::text title,
      format('Market $%s → $%s (%s%s%%)', round(prev_market,2), round(market_price,2), case when market_price>=prev_market then '+' else '' end, round(((market_price-prev_market)/nullif(prev_market,0))*100,1)) detail,
      abs(((market_price-prev_market)/nullif(prev_market,0))*100)::numeric significance,
      jsonb_build_object('from',prev_market,'to',market_price,'change_pct',round(((market_price-prev_market)/nullif(prev_market,0))*100,1),'source','tcgplayer_official_sku_price_history') data
    from official_points
    where prev_market>0 and market_price>0 and abs((market_price-prev_market)/prev_market)>=0.05
  ), scan_points as (
    select sc.captured_at,r.direct_available,r.direct_listings,r.edhrec_rank,
      lag(r.direct_available) over(order by sc.captured_at) prev_supply,
      lag(r.edhrec_rank) over(order by sc.captured_at) prev_edhrec
    from public.marketplace_scan_rows r
    join public.marketplace_scans sc on sc.scan_id=r.scan_id and sc.user_id=r.user_id
    where r.user_id=auth.uid() and r.sku_id=v_sku
      and sc.captured_at >= now() - make_interval(days=>p_days)
    order by sc.captured_at
  ), supply_events as (
    select captured_at event_at,'supply'::text kind,
      case when direct_available<prev_supply then 'Direct supply contracted' else 'Direct supply expanded' end title,
      format('Direct available %s → %s (%s%s%%)', prev_supply,direct_available,case when direct_available>=prev_supply then '+' else '' end,round(((direct_available-prev_supply)::numeric/nullif(prev_supply,0))*100,1)) detail,
      abs(((direct_available-prev_supply)::numeric/nullif(prev_supply,0))*100)::numeric significance,
      jsonb_build_object('from',prev_supply,'to',direct_available,'change_pct',round(((direct_available-prev_supply)::numeric/nullif(prev_supply,0))*100,1),'listings',direct_listings) data
    from scan_points
    where prev_supply is not null and prev_supply>0 and direct_available is not null
      and abs(direct_available-prev_supply)>=5
      and abs((direct_available-prev_supply)::numeric/prev_supply)>=0.15
  ), edh_events as (
    select captured_at event_at,'edhrec'::text kind,
      case when edhrec_rank<prev_edhrec then 'EDHREC rank improved' else 'EDHREC rank weakened' end title,
      format('EDHREC #%s → #%s (%s%% %s)', prev_edhrec,edhrec_rank,round((abs(edhrec_rank-prev_edhrec)::numeric/nullif(prev_edhrec,0))*100,1),case when edhrec_rank<prev_edhrec then 'improvement' else 'decline' end) detail,
      (abs(edhrec_rank-prev_edhrec)::numeric/nullif(prev_edhrec,0))*100 significance,
      jsonb_build_object('from',prev_edhrec,'to',edhrec_rank,'improvement_pct',round(((prev_edhrec-edhrec_rank)::numeric/nullif(prev_edhrec,0))*100,1)) data
    from scan_points
    where prev_edhrec is not null and prev_edhrec>0 and edhrec_rank is not null and edhrec_rank>0
      and (abs(edhrec_rank-prev_edhrec)>=250 or abs(edhrec_rank-prev_edhrec)::numeric/prev_edhrec>=0.15)
  ), sales_base as (
    select bucket_start_date, quantity_sold, transaction_count, market_price, low_sale_price, high_sale_price,
      avg(quantity_sold) over() avg_qty
    from public.marketplace_sku_sales_buckets
    where user_id=auth.uid() and sku_id=v_sku and bucket_start_date>=current_date-p_days
  ), sales_events as (
    select bucket_start_date::timestamptz event_at,'sales'::text kind,'Sales volume spike'::text title,
      format('%s units / %s transactions; market $%s',quantity_sold,transaction_count,coalesce(round(market_price,2),0)) detail,
      (quantity_sold::numeric/nullif(avg_qty,0))*10 significance,
      jsonb_build_object('units',quantity_sold,'transactions',transaction_count,'market',market_price,'low_sale',low_sale_price,'high_sale',high_sale_price) data
    from sales_base
    where quantity_sold>=greatest(15,ceil(coalesce(avg_qty,0)*1.4))
  ), signal_events as (
    select coalesce(i.published_at,i.observed_at,i.created_at) event_at,'signal'::text kind,
      coalesce(nullif(i.title,''),'Collectish Signal') title,
      concat_ws(' · ',nullif(i.source_name,''),nullif(i.direction,''),nullif(i.signal_stage,'')) detail,
      coalesce(i.confidence,0.5)*20 significance,
      jsonb_build_object('source_name',i.source_name,'source_url',i.source_url,'direction',i.direction,'signal_stage',i.signal_stage,'confidence',i.confidence,'summary',i.summary) data
    from public.market_intel_items i
    join public.market_intel_scout_signal_links l on l.intel_id=i.intel_id and l.user_id=i.user_id and l.product_id=v_product
    where i.user_id=auth.uid()
      and coalesce(i.published_at,i.observed_at,i.created_at)>=now()-make_interval(days=>p_days)
  ), all_events as (
    select * from official_price_events union all select * from supply_events union all select * from edh_events union all select * from sales_events union all select * from signal_events
  ), chosen as (
    select * from all_events order by significance desc nulls last,event_at desc limit 36
  )
  select coalesce(jsonb_agg(jsonb_build_object('event_at',event_at,'kind',kind,'title',title,'detail',detail,'significance',round(significance,1),'data',data) order by event_at),'[]'::jsonb)
  into ev from chosen;

  return jsonb_build_object(
    'available',true,
    'version','v1_official_intraday_scan_fallback',
    'days',p_days,
    'card',jsonb_build_object('product_id',v_product,'sku_id',v_sku,'product_name',v_name,'set_name',v_set),
    'events',coalesce(ev,'[]'::jsonb),
    'event_count',jsonb_array_length(coalesce(ev,'[]'::jsonb)),
    'identity_source',case when scout_row is null then 'marketplace_scan_rows' else 'scout_opportunities_v5' end,
    'generated_at',now()
  );
end
$function$;

revoke all on function public.ask_collectish_market_timeline_v1(text,text,integer) from public;
grant execute on function public.ask_collectish_market_timeline_v1(text,text,integer) to authenticated, service_role;