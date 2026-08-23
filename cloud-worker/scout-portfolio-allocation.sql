create or replace function public.scout_portfolio_allocation(
  p_budget numeric default 1000,
  p_limit integer default 30
)
returns table(
  allocation_rank integer, card_name text, product_id text, sku_id text, set_name text, printing text,
  action_class text, primary_signal text, base_scout_score integer, adjusted_scout_score integer,
  liquidity_score integer, liquidity_label text, direct_roi_pct numeric, target_roi_pct numeric,
  margin_cushion_pct numeric, expected_days_to_exit numeric, suggested_additional_qty integer,
  existing_qty numeric, cheapest_buy numeric, per_sku_cap numeric, allocated_qty integer,
  allocated_capital numeric, expected_net_profit numeric, budget_after numeric, allocation_score integer
)
language sql
security invoker
set search_path=public
as $function$
with recursive
params as (
  select greatest(100::numeric, least(coalesce(p_budget,1000),100000::numeric)) as budget
), src as (
  select s.*,
         case when s.action_class='action_now' then 0 when s.action_class='emerging_quick_turn' then 1 else 2 end as action_rank,
         least(100, greatest(0, round(
           coalesce(s.adjusted_scout_score,0)*0.45 + coalesce(s.liquidity_score,0)*0.20
           + least(20, greatest(0,coalesce(s.margin_cushion_pct,0))/5.0)
           + case when s.action_class='action_now' then 12 when s.action_class='emerging_quick_turn' then 7 else 0 end
           + case when coalesce(s.expected_days_to_exit,99)<=7 then 8 when coalesce(s.expected_days_to_exit,99)<=12 then 5 when coalesce(s.expected_days_to_exit,99)<=18 then 2 else 0 end
         )))::integer as alloc_score
  from public.scout_position_sizing(250) s
  where coalesce(s.suggested_additional_qty,0)>0 and coalesce(s.cheapest_buy,0)>0
), ranked as (
  select s.*, row_number() over(order by s.action_rank,s.alloc_score desc,s.margin_cushion_pct desc,s.expected_days_to_exit asc,s.adjusted_scout_score desc)::integer rn
  from src s
), capped as (
  select r.*,p.budget,
         case when r.action_class='action_now' then least(r.suggested_capital,p.budget*0.20)
              when r.action_class='emerging_quick_turn' then least(r.suggested_capital,p.budget*0.15)
              else least(r.suggested_capital,p.budget*0.10) end::numeric sku_cap
  from ranked r cross join params p
), rec as (
  select c.rn,c.card_name,c.product_id,c.sku_id,c.set_name,c.printing,c.action_class,c.primary_signal,
         c.base_scout_score,c.adjusted_scout_score,c.liquidity_score,c.liquidity_label,c.direct_roi_pct,c.target_roi_pct,
         c.margin_cushion_pct,c.expected_days_to_exit,c.suggested_additional_qty,c.existing_qty,c.cheapest_buy,c.direct_net_profit,
         c.sku_cap,c.alloc_score,
         greatest(0,least(c.suggested_additional_qty,floor(c.sku_cap/nullif(c.cheapest_buy,0))::integer,floor(c.budget/nullif(c.cheapest_buy,0))::integer))::integer qty,
         c.budget::numeric budget_before
  from capped c where c.rn=1
  union all
  select c.rn,c.card_name,c.product_id,c.sku_id,c.set_name,c.printing,c.action_class,c.primary_signal,
         c.base_scout_score,c.adjusted_scout_score,c.liquidity_score,c.liquidity_label,c.direct_roi_pct,c.target_roi_pct,
         c.margin_cushion_pct,c.expected_days_to_exit,c.suggested_additional_qty,c.existing_qty,c.cheapest_buy,c.direct_net_profit,
         c.sku_cap,c.alloc_score,
         greatest(0,least(c.suggested_additional_qty,floor(c.sku_cap/nullif(c.cheapest_buy,0))::integer,
           floor(greatest(0,r.budget_before-r.qty*r.cheapest_buy)/nullif(c.cheapest_buy,0))::integer))::integer qty,
         greatest(0,r.budget_before-r.qty*r.cheapest_buy)::numeric budget_before
  from rec r join capped c on c.rn=r.rn+1
  where r.rn<greatest(1,least(coalesce(p_limit,30),100))
), final as (
  select r.*,round((r.qty*r.cheapest_buy)::numeric,2) spend,
         greatest(0,round((r.budget_before-r.qty*r.cheapest_buy)::numeric,2)) budget_remaining
  from rec r where r.qty>0
)
select row_number() over(order by rn)::integer,card_name,product_id,sku_id,set_name,printing,action_class,primary_signal,
       base_scout_score,adjusted_scout_score,liquidity_score,liquidity_label,direct_roi_pct,target_roi_pct,margin_cushion_pct,
       expected_days_to_exit,suggested_additional_qty,existing_qty,cheapest_buy,sku_cap,qty,spend,
       round((qty*coalesce(direct_net_profit,0))::numeric,2),budget_remaining,alloc_score
from final order by rn;
$function$;

revoke all on function public.scout_portfolio_allocation(numeric,integer) from public,anon;
grant execute on function public.scout_portfolio_allocation(numeric,integer) to authenticated;
