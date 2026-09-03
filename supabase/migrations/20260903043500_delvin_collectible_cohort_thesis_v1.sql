create or replace function public.ask_delvin_collectible_cohort_thesis_v1(
  p_treatment text,
  p_set_codes text[] default null,
  p_days integer default 365
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_treatment text := trim(coalesce(p_treatment,''));
  v_sets text[] := case when p_set_codes is null or cardinality(p_set_codes)=0 then null else array(select upper(x) from unnest(p_set_codes) x) end;
  v_days integer := greatest(7,least(coalesce(p_days,365),1460));
  v_series jsonb; v_cards jsonb; v_summary jsonb;
  v_start date; v_end date; v_count integer; v_start_value numeric; v_end_value numeric; v_change numeric; v_median_change numeric;
  v_up integer; v_down integer; v_flat integer; v_sales numeric; v_direct integer; v_tight integer; v_assessment text;
begin
  if v_treatment='' then return jsonb_build_object('ok',false,'error','Treatment is required.'); end if;
  with cohort as (
    select distinct c.product_id::bigint product_id,c.sku_id::text sku_id,upper(c.set_code) set_code,c.set_name,c.product_name,c.collector_number,c.sku_market_price,c.avg_daily_qty_sold,c.direct_available,
      case when coalesce(c.avg_daily_qty_sold,0)>0 and c.direct_available is not null then c.direct_available/c.avg_daily_qty_sold end direct_cover_days
    from public.scout_opportunities_v5_cache c
    where lower(coalesce(c.condition,'')) in ('near mint','nm') and lower(coalesce(c.language,''))='english'
      and public.delvin_treatment_label_v1(c.product_name,c.set_code,c.collector_number,c.printing)=v_treatment
      and (v_sets is null or upper(c.set_code)=any(v_sets))
  ), hist as (
    select p.product_id::bigint product_id,p.observed_on::date d,p.market_price::numeric market from public.tcgcsv_tcgplayer_prices p join cohort c on c.product_id=p.product_id
      where lower(coalesce(p.sub_type_name,''))='foil' and p.market_price is not null and p.observed_on>=current_date-v_days
    union all
    select h.product_id::bigint,h.observed_hour::date d,h.market_price::numeric market from public.tcgplayer_official_sku_price_history h join cohort c on c.sku_id=h.sku_id
      where h.market_price is not null and h.observed_hour::date>=current_date-v_days
  ), daily as (select product_id,d,avg(market) market from hist group by product_id,d), bounds as (select product_id,min(d) first_d,max(d) last_d from daily group by product_id), card_calc as (
    select c.*,b.first_d,b.last_d,(select d.market from daily d where d.product_id=c.product_id and d.d=b.first_d limit 1) first_market,
      (select d.market from daily d where d.product_id=c.product_id and d.d=b.last_d limit 1) last_market
    from cohort c left join bounds b on b.product_id=c.product_id
  ), moves as (select *,case when first_market>0 and last_market is not null then round((last_market/first_market-1)*100,2) end change_pct from card_calc)
  select min(first_d),max(last_d),count(*),round(sum(first_market) filter(where first_market is not null),2),round(sum(last_market) filter(where last_market is not null),2),
    round(percentile_cont(0.5) within group(order by change_pct) filter(where change_pct is not null)::numeric,2),count(*) filter(where change_pct>=3),count(*) filter(where change_pct<=-3),
    count(*) filter(where change_pct>-3 and change_pct<3),round(sum(coalesce(avg_daily_qty_sold,0)),2),sum(coalesce(direct_available,0))::int,
    count(*) filter(where direct_cover_days is not null and direct_cover_days<2)
  into v_start,v_end,v_count,v_start_value,v_end_value,v_median_change,v_up,v_down,v_flat,v_sales,v_direct,v_tight from moves;
  v_change:=case when v_start_value>0 and v_end_value is not null then round((v_end_value/v_start_value-1)*100,2) end;
  if v_count=0 then return jsonb_build_object('ok',false,'error','No matching collectible cohort is present in current Scout data.'); end if;
  if coalesce(v_change,0)>=15 and v_up>=greatest(2,ceil(v_count*0.5)) then v_assessment:='The cumulative collection is appreciating with broad participation; the treatment thesis is currently supported, though slower liquidity still matters.';
  elsif coalesce(v_change,0)>=5 and v_up>v_down then v_assessment:='The cumulative collection is appreciating modestly with positive breadth. There may be runway left, but gains are not yet uniformly distributed.';
  elsif coalesce(v_change,0)>-5 and v_up>=v_down then v_assessment:='The cumulative collection is holding value with mildly positive breadth. The long-term collectible thesis remains plausible, but current history is too shallow to call a mature uptrend.';
  elsif v_down>v_up then v_assessment:='The cumulative collection is weakening across more printings than are rising; current evidence does not support broad treatment-level growth.';
  else v_assessment:='The cumulative collection is mixed. Current evidence is better interpreted card-by-card until more history accumulates.'; end if;
  with cohort as (
    select distinct c.product_id::bigint product_id,c.sku_id::text sku_id from public.scout_opportunities_v5_cache c
    where lower(coalesce(c.condition,'')) in ('near mint','nm') and lower(coalesce(c.language,''))='english'
      and public.delvin_treatment_label_v1(c.product_name,c.set_code,c.collector_number,c.printing)=v_treatment and (v_sets is null or upper(c.set_code)=any(v_sets))
  ), hist as (
    select p.product_id::bigint product_id,p.observed_on::date d,p.market_price::numeric market from public.tcgcsv_tcgplayer_prices p join cohort c on c.product_id=p.product_id where lower(coalesce(p.sub_type_name,''))='foil' and p.market_price is not null and p.observed_on>=current_date-v_days
    union all select h.product_id::bigint,h.observed_hour::date d,h.market_price::numeric market from public.tcgplayer_official_sku_price_history h join cohort c on c.sku_id=h.sku_id where h.market_price is not null and h.observed_hour::date>=current_date-v_days
  ), daily as (select product_id,d,avg(market) market from hist group by product_id,d), dates as (select distinct d from daily), basket as (
    select dt.d,round(sum((select d2.market from daily d2 where d2.product_id=c.product_id and d2.d<=dt.d order by d2.d desc limit 1)),2) basket_market_value,
      count(*) filter(where exists(select 1 from daily d3 where d3.product_id=c.product_id and d3.d<=dt.d)) tracked_printings from dates dt cross join cohort c group by dt.d
  ) select coalesce(jsonb_agg(jsonb_build_object('date',d,'basket_market_value',basket_market_value,'tracked_printings',tracked_printings) order by d),'[]'::jsonb) into v_series from basket;
  with cohort as (
    select distinct c.product_id::bigint product_id,c.sku_id::text sku_id,upper(c.set_code) set_code,c.product_name,c.collector_number,c.sku_market_price,c.avg_daily_qty_sold,c.direct_available
    from public.scout_opportunities_v5_cache c where lower(coalesce(c.condition,'')) in ('near mint','nm') and lower(coalesce(c.language,''))='english'
      and public.delvin_treatment_label_v1(c.product_name,c.set_code,c.collector_number,c.printing)=v_treatment and (v_sets is null or upper(c.set_code)=any(v_sets))
  ), hist as (
    select p.product_id::bigint product_id,p.observed_on::date d,p.market_price::numeric market from public.tcgcsv_tcgplayer_prices p join cohort c on c.product_id=p.product_id where lower(coalesce(p.sub_type_name,''))='foil' and p.market_price is not null and p.observed_on>=current_date-v_days
    union all select h.product_id::bigint,h.observed_hour::date d,h.market_price::numeric market from public.tcgplayer_official_sku_price_history h join cohort c on c.sku_id=h.sku_id where h.market_price is not null and h.observed_hour::date>=current_date-v_days
  ), daily as (select product_id,d,avg(market) market from hist group by product_id,d), cc as (
    select c.*,(select market from daily d where d.product_id=c.product_id order by d.d limit 1) first_market,(select market from daily d where d.product_id=c.product_id order by d.d desc limit 1) last_market from cohort c
  ) select coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'sku_id',sku_id,'set_code',set_code,'card_name',product_name,'collector_number',collector_number,'current_market',sku_market_price,'first_market',first_market,'last_market',last_market,'change_pct',case when first_market>0 then round((last_market/first_market-1)*100,2) end,'sales_day',avg_daily_qty_sold,'direct_available',direct_available) order by case when first_market>0 then (last_market/first_market-1) end desc nulls last),'[]'::jsonb) into v_cards from cc;
  v_summary:=jsonb_build_object('printing_count',v_count,'history_start',v_start,'history_end',v_end,'basket_start_value',v_start_value,'basket_current_value',v_end_value,'basket_change_pct',v_change,'median_printing_change_pct',v_median_change,'rising_count',v_up,'falling_count',v_down,'flat_count',v_flat,'sales_day',v_sales,'direct_available_sum',v_direct,'tight_direct_count',v_tight,'breadth_up_pct',round(v_up*100.0/greatest(v_count,1),1));
  return jsonb_build_object('ok',true,'treatment',v_treatment,'set_codes',v_sets,'summary',v_summary,'assessment',v_assessment,'series',v_series,'cards',v_cards,'generated_at',now(),'history_sources',jsonb_build_array('tcgcsv_tcgplayer_prices','tcgplayer_official_sku_price_history'),'history_note','Uses all stored TCGCSV daily product history plus Collectish exact-SKU hourly history. Current TCGCSV retention in Collectish is still shallow; the model will automatically deepen as older archive history is ingested.','forecast_note','This is a cumulative collectible-cohort thesis, not a comparison between sets and not a guaranteed price forecast.');
end;
$$;
revoke all on function public.ask_delvin_collectible_cohort_thesis_v1(text,text[],integer) from public,anon;
grant execute on function public.ask_delvin_collectible_cohort_thesis_v1(text,text[],integer) to authenticated,service_role;
