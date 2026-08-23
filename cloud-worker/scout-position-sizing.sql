create or replace function public.scout_position_sizing(p_limit integer default 100)
returns table(
  card_name text, product_id text, sku_id text, set_name text, printing text,
  base_scout_score integer, adjusted_scout_score integer,
  liquidity_score integer, liquidity_label text,
  target_roi_pct numeric, direct_roi_pct numeric, margin_cushion_pct numeric,
  cheapest_buy numeric, direct_net_est numeric, direct_net_profit numeric,
  direct_low numeric, market_price numeric, direct_available integer,
  sales_rank integer, avg_daily_qty_sold numeric,
  existing_qty numeric, estimated_capture_per_day numeric,
  target_days integer, target_total_qty integer, suggested_additional_qty integer,
  suggested_capital numeric, expected_days_to_exit numeric,
  sizing_class text, sizing_reason text,
  action_class text, primary_signal text, actionability_score integer
)
language sql
security invoker
set search_path=public
as $function$
with liquid as (
  select * from public.liquid_scout_opportunities(250)
), action as (
  select distinct on (sku_id)
         sku_id,action_class,primary_signal,actionability_score
  from public.actionable_emerging_opportunities(200)
  order by sku_id,actionability_score desc
), inv as (
  select sku_id,product_id,sum(coalesce(quantity,0))::numeric existing_qty
  from public.collectish_inventory_positions
  where user_id=auth.uid()
  group by sku_id,product_id
), base as (
  select l.*,coalesce(i.existing_qty,0)::numeric existing_qty,
         a.action_class,a.primary_signal,a.actionability_score,
         case
           when coalesce(l.avg_daily_qty_sold,0)>0 then round(greatest(0.15,l.avg_daily_qty_sold*0.12)::numeric,2)
           when l.sales_rank<=30 then 0.60::numeric
           when l.sales_rank<=80 then 0.40::numeric
           when l.sales_rank<=180 then 0.25::numeric
           when l.sales_rank<=300 then 0.15::numeric
           else 0.10::numeric
         end capture_per_day,
         case when l.liquidity_score>=85 then 9 else 7 end::integer days_cover,
         case
           when l.margin_cushion_pct>=100 then 1.30
           when l.margin_cushion_pct>=50 then 1.15
           when l.margin_cushion_pct>=25 then 1.00
           when l.margin_cushion_pct>=10 then 0.80
           else 0.65 end::numeric margin_mult,
         case
           when a.action_class='action_now' then 1.20
           when a.action_class='emerging_quick_turn' then 1.08
           else 1.00 end::numeric signal_mult,
         case
           when l.direct_available is null then 1.00
           when l.direct_available<=5 then 1.08
           when l.direct_available<=20 then 1.04
           when l.direct_available>=150 then 0.78
           when l.direct_available>=75 then 0.90
           else 1.00 end::numeric supply_mult,
         case
           when a.action_class='action_now' then 400
           when a.action_class='emerging_quick_turn' then 300
           else 200 end::numeric capital_cap,
         case
           when a.action_class='action_now' and l.margin_cushion_pct>=50 then 16
           when a.action_class in ('action_now','emerging_quick_turn') then 12
           else 10 end::integer copy_cap
  from liquid l
  left join action a on a.sku_id=l.sku_id
  left join inv i on (i.sku_id=l.sku_id) or (i.sku_id is null and i.product_id=l.product_id)
), sized as (
  select b.*,
         greatest(1,least(copy_cap,
           floor(capital_cap/nullif(cheapest_buy,0))::integer,
           ceil(capture_per_day*days_cover*margin_mult*signal_mult*supply_mult)::integer
         ))::integer target_qty
  from base b
  where cheapest_buy>0
), final as (
  select s.*,
         greatest(0,target_qty-ceil(existing_qty))::integer add_qty,
         round((greatest(0,target_qty-ceil(existing_qty))*cheapest_buy)::numeric,2) capital,
         round((target_qty/nullif(capture_per_day,0))::numeric,1) exit_days
  from sized s
)
select card_name,product_id,sku_id,set_name,printing,
       base_scout_score,adjusted_scout_score,liquidity_score,liquidity_label,
       target_roi_pct,direct_roi_pct,margin_cushion_pct,
       cheapest_buy,direct_net_est,direct_net_profit,direct_low,market_price,direct_available,
       sales_rank,avg_daily_qty_sold,existing_qty,capture_per_day,
       days_cover,target_qty,add_qty,capital,exit_days,
       case
         when add_qty=0 then 'HOLD / ALREADY SIZED'
         when add_qty>=8 then 'DEEP BUY'
         when add_qty>=5 then 'BUY 5–7'
         when add_qty>=3 then 'BUY 3–4'
         else 'STARTER BUY' end,
       case
         when add_qty=0 then 'Current inventory already meets or exceeds the liquidity-adjusted target exposure.'
         when action_class='action_now' then 'Strong emerging signal plus liquid execution supports a larger position, capped by seller-capture and per-SKU capital limits.'
         when action_class='emerging_quick_turn' then 'Emerging demand and acceptable quick-turn economics support moderate incremental exposure.'
         when margin_cushion_pct>=50 then 'Large ROI cushion and strong liquidity support a moderate quick-turn position without requiring a new catalyst.'
         else 'Liquid card clears its margin hurdle; keep the position conservative because catalyst strength or margin cushion is lower.' end,
       action_class,primary_signal,actionability_score
from final
where add_qty>0 or existing_qty>0
order by
  case when action_class='action_now' then 0 when action_class='emerging_quick_turn' then 1 else 2 end,
  adjusted_scout_score desc,
  margin_cushion_pct desc,
  add_qty desc
limit greatest(1,least(coalesce(p_limit,100),250));
$function$;

revoke all on function public.scout_position_sizing(integer) from public,anon;
grant execute on function public.scout_position_sizing(integer) to authenticated;
