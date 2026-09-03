-- Keep Discord's public sealed recommendation path bounded to one server-side
-- query. Only service-role callers can read this cross-user shared model.
create or replace function public.ask_delvin_sealed_direct_crack_v1(p_limit integer default 10)
returns table(
  sealed_uuid uuid, product_name text, set_code text, category text,
  coverage_state text, acquisition_price numeric, direct_first_net_ev numeric,
  practical_liquidation_ev numeric, practical_p10_estimate numeric,
  price_coverage_pct numeric, top10_practical_ev_share_pct numeric,
  practical_action text, valuation_as_of timestamptz,
  direct_roi_pct numeric, practical_roi_pct numeric
)
language sql stable security invoker set search_path=public as $$
  select c.sealed_uuid,c.product_name,c.set_code,c.category,c.coverage_state,
    coalesce(c.sealed_low_price,c.sealed_market_price)::numeric acquisition_price,
    e.direct_first_net_ev,e.practical_liquidation_ev,e.practical_p10_estimate,
    e.price_coverage_pct,e.top10_practical_ev_share_pct,e.practical_action,e.valuation_as_of,
    round((e.direct_first_net_ev/coalesce(c.sealed_low_price,c.sealed_market_price)-1)*100,1),
    round((e.practical_liquidation_ev/coalesce(c.sealed_low_price,c.sealed_market_price)-1)*100,1)
  from public.sealed_product_model_coverage c
  join public.sealed_product_executable_ev_cache e on e.sealed_uuid=c.sealed_uuid
  where c.recommendation_eligible
    and coalesce(c.sealed_low_price,c.sealed_market_price)>0
    and e.price_coverage_pct>=90
    and e.direct_first_net_ev>coalesce(c.sealed_low_price,c.sealed_market_price)
  order by case when e.practical_action='BUY & CRACK' then 0
                when e.practical_liquidation_ev>coalesce(c.sealed_low_price,c.sealed_market_price) then 1
                else 2 end,
    (e.practical_liquidation_ev/coalesce(c.sealed_low_price,c.sealed_market_price)) desc,
    (e.direct_first_net_ev/coalesce(c.sealed_low_price,c.sealed_market_price)) desc
  limit greatest(1,least(coalesce(p_limit,10),20))
$$;

revoke all on function public.ask_delvin_sealed_direct_crack_v1(integer) from public,anon,authenticated;
grant execute on function public.ask_delvin_sealed_direct_crack_v1(integer) to service_role;
notify pgrst,'reload schema';
