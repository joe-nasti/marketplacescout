create or replace function public.ask_delvin_treatment_growth_v1(
  p_set_codes text[],
  p_treatment text,
  p_days integer default 7
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_days integer := greatest(1,least(coalesce(p_days,7),90));
  v_treatment text := trim(coalesce(p_treatment,''));
  v_rows jsonb;
  v_coverage_start timestamptz;
  v_coverage_end timestamptz;
begin
  if coalesce(array_length(p_set_codes,1),0)=0 or v_treatment='' then
    return jsonb_build_object('ok',false,'error','At least one set code and a treatment are required.');
  end if;
  with current_rows as (
    select distinct on (c.sku_id)
      upper(c.set_code) set_code,c.set_name,c.sku_id,c.product_name,c.collector_number,
      c.sku_market_price market_price,c.direct_low,c.direct_available,c.avg_daily_qty_sold sales_day,c.promoted_score scout_score,
      public.delvin_treatment_label_v1(c.product_name,c.set_code,c.collector_number,c.printing) treatment
    from public.scout_opportunities_v5_cache c
    where upper(c.set_code)=any(select upper(x) from unnest(p_set_codes) x)
      and lower(coalesce(c.condition,'')) in ('near mint','nm')
      and lower(coalesce(c.language,''))='english'
      and public.delvin_treatment_label_v1(c.product_name,c.set_code,c.collector_number,c.printing)=v_treatment
    order by c.sku_id,c.promoted_score desc nulls last
  ), hist as (
    select h.sku_id,h.observed_hour,h.market_price,
      first_value(h.market_price) over(partition by h.sku_id order by h.observed_hour rows between unbounded preceding and unbounded following) first_market,
      first_value(h.market_price) over(partition by h.sku_id order by h.observed_hour desc rows between unbounded preceding and unbounded following) last_market,
      min(h.observed_hour) over(partition by h.sku_id) first_at,
      max(h.observed_hour) over(partition by h.sku_id) last_at,
      row_number() over(partition by h.sku_id order by h.observed_hour desc) rn
    from public.tcgplayer_official_sku_price_history h
    join current_rows c using(sku_id)
    where h.observed_hour >= now()-make_interval(days=>v_days) and h.market_price is not null
  ), per_sku as (
    select c.*,h.first_market,h.last_market,h.first_at,h.last_at,
      case when h.first_market>0 and h.last_market is not null then round(((h.last_market-h.first_market)/h.first_market*100)::numeric,2) end market_change_pct
    from current_rows c left join hist h on h.sku_id=c.sku_id and h.rn=1
  ), agg as (
    select set_code,max(set_name) set_name,count(*) printing_count,
      round(sum(coalesce(market_price,0)),2) current_market_value_sum,
      round(avg(market_price) filter(where market_price is not null),2) avg_market,
      round(percentile_cont(0.5) within group(order by market_price) filter(where market_price is not null)::numeric,2) median_market,
      round(sum(coalesce(sales_day,0)),2) sales_day,
      round(avg(coalesce(sales_day,0)),3) avg_sales_per_printing,
      sum(coalesce(direct_available,0)) direct_available_sum,
      count(*) filter(where sales_day>0 and direct_available is not null and direct_available/sales_day<2) tight_direct_count,
      count(*) filter(where market_price>=100) cards_100_plus,
      count(*) filter(where market_change_pct is not null) history_tracked_count,
      round(avg(market_change_pct) filter(where market_change_pct is not null),2) avg_market_change_pct,
      round(percentile_cont(0.5) within group(order by market_change_pct) filter(where market_change_pct is not null)::numeric,2) median_market_change_pct,
      count(*) filter(where market_change_pct>=3) rising_count,
      count(*) filter(where market_change_pct<=-3) falling_count,
      min(first_at) history_start,max(last_at) history_end
    from per_sku group by set_code
  ), assessed as (
    select *,
      case
        when history_tracked_count=0 then 'insufficient_history'
        when median_market_change_pct>=3 and tight_direct_count>=greatest(1,ceil(printing_count*0.15)::int) then 'near_term_momentum_and_scarcity'
        when median_market_change_pct>=1 then 'near_term_momentum_selective'
        when median_market_change_pct<=-3 then 'cooling_near_term'
        when rising_count>falling_count then 'mixed_with_positive_skew'
        else 'mixed_or_plateauing'
      end momentum_state,
      case
        when history_tracked_count=0 then 'No stored cohort history yet; current value/liquidity only.'
        when median_market_change_pct>=3 and tight_direct_count>=greatest(1,ceil(printing_count*0.15)::int) then 'Near-term price momentum is still positive and some Direct supply is tight; this supports selective upside, not a blanket cohort forecast.'
        when median_market_change_pct>=1 then 'Near-term cohort pricing is still advancing, but evidence supports being selective by card rather than assuming the whole treatment keeps rising.'
        when median_market_change_pct<=-3 then 'The recent cohort median is cooling; further upside needs renewed demand or supply tightening.'
        when rising_count>falling_count then 'The cohort is mixed, with more risers than decliners; upside appears card-specific rather than broad.'
        else 'Recent pricing looks mixed or plateauing; current scarcity/liquidity matters more than simple momentum.'
      end assessment
    from agg
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'set_code',set_code,'set_name',set_name,'treatment',v_treatment,'printing_count',printing_count,
    'current_market_value_sum',current_market_value_sum,'avg_market',avg_market,'median_market',median_market,'sales_day',sales_day,
    'avg_sales_per_printing',avg_sales_per_printing,'direct_available_sum',direct_available_sum,'tight_direct_count',tight_direct_count,
    'cards_100_plus',cards_100_plus,'history_tracked_count',history_tracked_count,'avg_market_change_pct',avg_market_change_pct,
    'median_market_change_pct',median_market_change_pct,'rising_count',rising_count,'falling_count',falling_count,
    'history_start',history_start,'history_end',history_end,'momentum_state',momentum_state,'assessment',assessment
  ) order by coalesce(median_market_change_pct,-999) desc,current_market_value_sum desc),'[]'::jsonb),min(history_start),max(history_end)
  into v_rows,v_coverage_start,v_coverage_end from assessed;
  return jsonb_build_object('ok',true,'treatment',v_treatment,'requested_days',v_days,'rows',v_rows,'row_count',jsonb_array_length(v_rows),
    'history_coverage_start',v_coverage_start,'history_coverage_end',v_coverage_end,
    'forecast_note','This is a near-term evidence assessment from stored TCGplayer price history, current Scout liquidity and Direct scarcity. It is not a long-term price forecast.','generated_at',now());
end;
$$;
grant execute on function public.ask_delvin_treatment_growth_v1(text[],text,integer) to authenticated,service_role;
