create or replace function public.get_sealed_family_economics_fast(p_sealed_uuids uuid[])
returns table (
  sealed_uuid uuid,
  crack_gross_mean_ev numeric,
  crack_net_mean_ev numeric,
  crack_value_complete boolean,
  fixed_tcg_market_ev numeric,
  modeled_child_units numeric,
  model_key text,
  model_version text
)
language sql
stable
security invoker
set search_path = ''
as $$
with requested as (
  select distinct x.sealed_uuid
  from unnest(coalesce(p_sealed_uuids, array[]::uuid[])) as x(sealed_uuid)
),
parent_backtest as (
  select r.sealed_uuid,
         b.gross_mean_ev,
         b.net_mean_ev_after_fees,
         b.model_key,
         b.model_version
  from requested r
  left join lateral (
    select eb.gross_mean_ev,
           eb.net_mean_ev_after_fees,
           eb.model_key,
           eb.model_version
    from public.sealed_ev_backtests eb
    where eb.user_id = (select auth.uid())
      and eb.sealed_uuid = r.sealed_uuid
    order by eb.valuation_as_of desc, eb.created_at desc
    limit 1
  ) b on true
),
child_rollup as (
  select r.sealed_uuid,
         count(c.child_sealed_uuid)::integer as child_components,
         count(cb.gross_mean_ev)::integer as modeled_child_components,
         sum(c.quantity) filter (where cb.gross_mean_ev is not null) as modeled_child_units,
         sum(c.quantity * cb.gross_mean_ev) filter (where cb.gross_mean_ev is not null) as child_gross_ev,
         sum(c.quantity * cb.net_mean_ev_after_fees) filter (where cb.net_mean_ev_after_fees is not null) as child_net_ev
  from requested r
  left join public.sealed_product_child_components c
    on c.parent_sealed_uuid = r.sealed_uuid
  left join lateral (
    select eb.gross_mean_ev, eb.net_mean_ev_after_fees
    from public.sealed_ev_backtests eb
    where eb.user_id = (select auth.uid())
      and eb.sealed_uuid = c.child_sealed_uuid
    order by eb.valuation_as_of desc, eb.created_at desc
    limit 1
  ) cb on c.child_sealed_uuid is not null
  group by r.sealed_uuid
),
fixed_rollup as (
  select r.sealed_uuid,
         count(fc.card_uuid)::integer as fixed_component_rows,
         sum(fc.quantity * coalesce(v.price, 0)) filter (where fc.card_uuid is not null) as fixed_tcg_market_ev
  from requested r
  left join public.sealed_product_fixed_card_components fc
    on fc.sealed_uuid = r.sealed_uuid
  left join lateral (
    select vp.price
    from public.mtgjson_vendor_prices vp
    where vp.uuid = fc.card_uuid
      and vp.finish = fc.finish
      and vp.provider = 'tcgplayer'
      and vp.price_type = 'retail'
    order by vp.observed_on desc, vp.source_updated_at desc
    limit 1
  ) v on fc.card_uuid is not null
  group by r.sealed_uuid
)
select r.sealed_uuid,
       case when pb.gross_mean_ev is not null then pb.gross_mean_ev
            else coalesce(cr.child_gross_ev, 0) + coalesce(fr.fixed_tcg_market_ev, 0) end,
       case when pb.net_mean_ev_after_fees is not null then pb.net_mean_ev_after_fees
            else coalesce(cr.child_net_ev, 0) + coalesce(fr.fixed_tcg_market_ev, 0) * 0.75 end,
       (pb.gross_mean_ev is not null
        or ((coalesce(cr.child_components, 0) > 0 or coalesce(fr.fixed_component_rows, 0) > 0)
            and coalesce(cr.modeled_child_components, 0) = coalesce(cr.child_components, 0))),
       coalesce(fr.fixed_tcg_market_ev, 0),
       coalesce(cr.modeled_child_units, 0),
       pb.model_key,
       pb.model_version
from requested r
left join parent_backtest pb on pb.sealed_uuid = r.sealed_uuid
left join child_rollup cr on cr.sealed_uuid = r.sealed_uuid
left join fixed_rollup fr on fr.sealed_uuid = r.sealed_uuid;
$$;

revoke all on function public.get_sealed_family_economics_fast(uuid[]) from public;
grant execute on function public.get_sealed_family_economics_fast(uuid[]) to authenticated;

notify pgrst, 'reload schema';
