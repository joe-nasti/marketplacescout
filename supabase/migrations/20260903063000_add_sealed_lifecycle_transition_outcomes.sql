create or replace view public.sealed_lifecycle_transition_outcomes_current
with (security_invoker=true) as
select e.transition_key,e.user_id,e.sealed_uuid,p.name product_name,p.set_code,
  e.from_state,e.to_state,e.trajectory_action,e.pattern_score,e.evidence,e.observed_at,
  base.observed_on baseline_price_date,base.market_price baseline_market_price,
  p30.observed_on outcome_30d_date,p30.market_price outcome_30d_market_price,
  p90.observed_on outcome_90d_date,p90.market_price outcome_90d_market_price,
  round(100*(p30.market_price/nullif(base.market_price,0)-1),2) return_30d_pct,
  round(100*(p90.market_price/nullif(base.market_price,0)-1),2) return_90d_pct,
  case when e.to_state in ('BREAKOUT','SUPPLY SQUEEZE','ACCUMULATION') then 'UP'
       when e.to_state='REVERSAL' then 'DOWN' else 'NEUTRAL' end expected_direction,
  case when p30.market_price is null then null
       when e.to_state in ('BREAKOUT','SUPPLY SQUEEZE','ACCUMULATION')
         then p30.market_price>=base.market_price
       when e.to_state='REVERSAL' then p30.market_price<=base.market_price
       else abs(100*(p30.market_price/nullif(base.market_price,0)-1))<=5 end direction_correct_30d,
  case when p90.market_price is null then null
       when e.to_state in ('BREAKOUT','SUPPLY SQUEEZE','ACCUMULATION')
         then p90.market_price>=base.market_price
       when e.to_state='REVERSAL' then p90.market_price<=base.market_price
       else abs(100*(p90.market_price/nullif(base.market_price,0)-1))<=10 end direction_correct_90d,
  case when p90.market_price is not null then '90D MATURE'
       when p30.market_price is not null then '30D MATURE'
       else 'MATURING' end outcome_status,
  'Observed transition outcome only. TCG Market measures trajectory and is never liquidation EV.'::text caveat
from public.sealed_product_lifecycle_events e
join public.mtgjson_sealed_products p on p.uuid=e.sealed_uuid
left join lateral (
  select h.observed_on,h.market_price
  from public.sealed_product_market_history h
  where p.tcgplayer_product_id~'^[0-9]+$'
    and h.product_id=p.tcgplayer_product_id::bigint and h.sub_type_name='Normal'
    and h.market_price>0
    and h.observed_on between e.observed_at::date-3 and e.observed_at::date+3
  order by abs(h.observed_on-e.observed_at::date),h.observed_on limit 1
) base on true
left join lateral (
  select h.observed_on,h.market_price
  from public.sealed_product_market_history h
  where p.tcgplayer_product_id~'^[0-9]+$'
    and h.product_id=p.tcgplayer_product_id::bigint and h.sub_type_name='Normal'
    and h.market_price>0 and current_date>=e.observed_at::date+30
    and h.observed_on between e.observed_at::date+25 and e.observed_at::date+40
  order by abs(h.observed_on-(e.observed_at::date+30)),h.observed_on limit 1
) p30 on true
left join lateral (
  select h.observed_on,h.market_price
  from public.sealed_product_market_history h
  where p.tcgplayer_product_id~'^[0-9]+$'
    and h.product_id=p.tcgplayer_product_id::bigint and h.sub_type_name='Normal'
    and h.market_price>0 and current_date>=e.observed_at::date+90
    and h.observed_on between e.observed_at::date+75 and e.observed_at::date+105
  order by abs(h.observed_on-(e.observed_at::date+90)),h.observed_on limit 1
) p90 on true;

grant select on public.sealed_lifecycle_transition_outcomes_current to authenticated,service_role;

create or replace view public.sealed_lifecycle_transition_calibration_current
with (security_invoker=true) as
select user_id,from_state,to_state,expected_direction,
  count(*)::integer transition_count,
  count(*) filter(where direction_correct_30d is not null)::integer mature_30d,
  count(*) filter(where direction_correct_90d is not null)::integer mature_90d,
  round(100*avg(direction_correct_30d::integer) filter(where direction_correct_30d is not null),1) direction_accuracy_30d_pct,
  round(100*avg(direction_correct_90d::integer) filter(where direction_correct_90d is not null),1) direction_accuracy_90d_pct,
  round(percentile_cont(.5) within group(order by return_30d_pct)
    filter(where return_30d_pct is not null)::numeric,1) median_return_30d_pct,
  round(percentile_cont(.5) within group(order by return_90d_pct)
    filter(where return_90d_pct is not null)::numeric,1) median_return_90d_pct,
  case when count(*) filter(where direction_correct_90d is not null)>=30 then 'MEDIUM'
       else 'LOW' end calibration_confidence,
  'Transition calibration stays observational; HIGH requires a separately validated promotion rule.'::text caveat
from public.sealed_lifecycle_transition_outcomes_current
group by user_id,from_state,to_state,expected_direction;

grant select on public.sealed_lifecycle_transition_calibration_current to authenticated,service_role;
