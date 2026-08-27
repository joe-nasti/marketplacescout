-- MarketplaceScout quick-turn liquidity lens.
-- Exact Scout SKU/printing velocity is authoritative. TCGplayer Best Selling
-- sales_rank is set-level context only and may never promote an unmeasured SKU
-- into the LIQUID tier.
-- SECURITY INVOKER and authenticated-only execution.
create or replace function public.liquid_scout_opportunities(p_limit integer default 100)
returns table(
  card_name text,
  product_id text,
  sku_id text,
  set_name text,
  printing text,
  base_scout_score integer,
  liquidity_score integer,
  liquidity_label text,
  liquidity_bonus integer,
  adjusted_scout_score integer,
  target_roi_pct numeric,
  direct_roi_pct numeric,
  margin_cushion_pct numeric,
  cheapest_buy numeric,
  direct_net_est numeric,
  direct_net_profit numeric,
  direct_low numeric,
  market_price numeric,
  direct_available integer,
  sales_rank integer,
  avg_daily_qty_sold numeric,
  quick_turn_class text
)
language sql
security invoker
set search_path=public
as $$
with base as (
  select c.*,
    case
      when c.avg_daily_qty_sold is not null then
        case
          when c.avg_daily_qty_sold>=9 then 100
          when c.avg_daily_qty_sold>=3 then 86
          when c.avg_daily_qty_sold>=1 then 72
          when c.avg_daily_qty_sold>=0.5 then 58
          else 42
        end
      else least(54,
        case
          when c.sales_rank<=30 then 54
          when c.sales_rank<=80 then 50
          when c.sales_rank<=180 then 46
          when c.sales_rank<=300 then 42
          when c.sales_rank<=500 then 36
          else 25
        end)
    end::integer as liq,
    case
      when c.avg_daily_qty_sold is not null and c.avg_daily_qty_sold>=9 then 15
      when c.avg_daily_qty_sold is not null and c.avg_daily_qty_sold>=1 then 18
      when c.avg_daily_qty_sold is not null and c.avg_daily_qty_sold>=0.5 then 22
      else 25
    end::numeric as target_roi,
    case
      when c.cheapest_buy>0 and c.direct_net_profit is not null then round((c.direct_net_profit/c.cheapest_buy*100)::numeric,1)
    end as direct_roi
  from public.scout_opportunities_v5_cache c
  where c.user_id=auth.uid()
    and c.cheapest_buy>=1
    and c.direct_net_profit is not null
    and c.direct_net_profit>=1
    and c.sku_market_price>0
    and c.direct_low>0
    and c.direct_low < c.sku_market_price*3
), scored as (
  select b.*,
    case when liq>=85 then 8 when liq>=70 then 5 when liq>=55 then 2 else 0 end::integer as bonus,
    case when liq>=85 then 'VERY LIQUID' when liq>=70 then 'LIQUID' when liq>=55 then 'NORMAL+' when liq>=40 then 'NORMAL' else 'SLOW' end as liq_label
  from base b
), final as (
  select s.*,
    least(100,coalesce(s.promoted_score,0)+s.bonus)::integer as adjusted,
    round((s.direct_roi-s.target_roi)::numeric,1) as cushion
  from scored s
  where s.direct_roi>=s.target_roi
    and s.liq>=70
)
select product_name,product_id,sku_id,set_name,printing,
       promoted_score,liq,liq_label,bonus,adjusted,target_roi,direct_roi,cushion,
       cheapest_buy,direct_net_est,direct_net_profit,direct_low,sku_market_price,direct_available,
       sales_rank,avg_daily_qty_sold,
       case when adjusted>=80 and cushion>=15 then 'priority_quick_turn'
            when adjusted>=70 then 'quick_turn'
            else 'liquid_value' end
from final
order by
  case when adjusted>=80 and cushion>=15 then 0 when adjusted>=70 then 1 else 2 end,
  adjusted desc,
  cushion desc,
  liq desc
limit greatest(1,least(coalesce(p_limit,100),250));
$$;
revoke all on function public.liquid_scout_opportunities(integer) from public, anon;
grant execute on function public.liquid_scout_opportunities(integer) to authenticated;
