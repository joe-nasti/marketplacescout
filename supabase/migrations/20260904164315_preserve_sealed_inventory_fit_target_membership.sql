-- A SKU can occur in more than one sealed product. Preserve each product's
-- membership so a product-scoped refresh never loses shared staples.
create or replace view public.sealed_inventory_fit_component_targets
with (security_invoker = true)
as
with resolved as (
  select
    c.user_id,
    c.sealed_uuid,
    coalesce(c.sku_id, sk.sku_id) as sku_id,
    coalesce(c.product_id, sk.product_id) as product_id,
    c.card_name,
    c.set_code,
    c.collector_number,
    c.finish,
    c.tcg_market,
    c.syp_eligible
  from public.sealed_component_ev_current c
  left join lateral (
    select s.sku_id, s.product_id
    from public.mtgjson_tcgplayer_skus s
    where s.uuid = c.card_uuid
      and lower(coalesce(s.condition, '')) in ('near mint', 'near_mint', 'nm')
      and lower(coalesce(s.language, '')) in ('english', 'en')
      and (
        (lower(coalesce(c.finish, '')) = 'foil'
          and lower(coalesce(s.printing, s.finish, '')) = 'foil')
        or
        (lower(coalesce(c.finish, '')) in ('normal', 'nonfoil', 'non-foil')
          and lower(coalesce(s.printing, s.finish, '')) in ('normal', 'non foil', 'non-foil'))
        or lower(coalesce(s.finish, '')) = lower(coalesce(c.finish, ''))
      )
    order by
      case when lower(coalesce(s.finish, '')) = lower(coalesce(c.finish, '')) then 0 else 1 end,
      s.source_updated_at desc nulls last,
      s.sku_id
    limit 1
  ) sk on c.sku_id is null
)
select distinct on (user_id, sealed_uuid, sku_id)
  user_id, sealed_uuid, sku_id, product_id, card_name, set_code,
  collector_number, finish, tcg_market, syp_eligible
from resolved
where sku_id is not null and product_id is not null
order by user_id, sealed_uuid, sku_id;

revoke all on public.sealed_inventory_fit_component_targets from public, anon, authenticated;
grant select on public.sealed_inventory_fit_component_targets to service_role;
