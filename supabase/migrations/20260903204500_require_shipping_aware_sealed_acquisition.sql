-- Recommendation economics must use an executable delivered acquisition cost.
-- A newer official price row may omit shipping; retain the newest observed
-- TCG Low + shipping quote instead of silently falling back to raw TCG Low.
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
  with shipping_price as (
    select distinct on (p.sealed_uuid)
      p.sealed_uuid,
      p.low_with_shipping::numeric acquisition_price
    from public.sealed_product_price_current p
    where p.source in ('tcgplayer_public','tcgplayer_official_product')
      and p.low_with_shipping>0
    order by p.sealed_uuid,p.captured_at desc
  )
  select c.sealed_uuid,c.product_name,c.set_code,c.category,c.coverage_state,
    p.acquisition_price,
    e.direct_first_net_ev,e.practical_liquidation_ev,e.practical_p10_estimate,
    e.price_coverage_pct,e.top10_practical_ev_share_pct,e.practical_action,e.valuation_as_of,
    round((e.direct_first_net_ev/p.acquisition_price-1)*100,1),
    round((e.practical_liquidation_ev/p.acquisition_price-1)*100,1)
  from public.sealed_product_model_coverage c
  join public.sealed_product_executable_ev_cache e on e.sealed_uuid=c.sealed_uuid
  join shipping_price p on p.sealed_uuid=c.sealed_uuid
  where c.recommendation_eligible
    and e.price_coverage_pct>=90
    and e.direct_first_net_ev>p.acquisition_price
  order by case
      when e.practical_action='BUY & CRACK'
        and e.practical_liquidation_ev>=p.acquisition_price*1.15 then 0
      when e.practical_liquidation_ev>p.acquisition_price then 1
      else 2
    end,
    (e.practical_liquidation_ev/p.acquisition_price) desc,
    (e.direct_first_net_ev/p.acquisition_price) desc
  limit greatest(1,least(coalesce(p_limit,10),20))
$$;

revoke all on function public.ask_delvin_sealed_direct_crack_v1(integer) from public,anon,authenticated;
grant execute on function public.ask_delvin_sealed_direct_crack_v1(integer) to service_role;
notify pgrst,'reload schema';
