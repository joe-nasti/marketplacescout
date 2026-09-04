-- Correct PLST/nonfoil commerce identity resolution and distinguish missing Direct observations from confirmed zero inventory.
create or replace function public.ask_sealed_inventory_fit_v1(p_sealed_uuid uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
with selected_user as (
  select coalesce(
    auth.uid(),
    case when current_user = 'service_role' then (
      select c.user_id
      from public.sealed_component_ev_current c
      where c.sealed_uuid = p_sealed_uuid
      group by c.user_id
      order by count(*) desc
      limit 1
    ) end
  ) as user_id
),
base as (
  select
    c.card_uuid,
    c.card_name,
    c.set_code,
    c.collector_number,
    c.finish,
    c.quantity,
    coalesce(c.sku_id, sk.sku_id) as sku_id,
    coalesce(c.product_id, sk.product_id) as product_id,
    coalesce(o.market_price, c.tcg_market) as tcg_market,
    c.direct_available_current,
    c.direct_low_current,
    coalesce(c.syp_eligible, sy.is_currently_eligible, false) as syp_eligible,
    coalesce(c.syp_max_quantity, sy.current_max_quantity, sy.max_quantity) as syp_max_quantity,
    coalesce(f.contribution, c.actionable_unit_value * c.quantity, 0)::numeric as practical_value,
    coalesce(o.market_price, c.tcg_market, 0) * c.quantity as market_value
  from public.sealed_component_ev_current c
  join selected_user u on u.user_id = c.user_id
  left join public.sealed_fixed_practical_components f
    on f.sealed_uuid = c.sealed_uuid
   and f.card_uuid = c.card_uuid
   and f.finish = c.finish
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
  left join public.tcgplayer_official_sku_price_current o
    on o.sku_id = coalesce(c.sku_id, sk.sku_id)
  left join lateral (
    select p.is_currently_eligible, p.current_max_quantity, p.max_quantity
    from public.syp_products p
    where p.user_id = c.user_id
      and p.tcgplayer_id = coalesce(c.product_id, sk.product_id)
    order by p.last_seen desc nulls last
    limit 1
  ) sy on c.syp_eligible is null
  where c.sealed_uuid = p_sealed_uuid
),
valued as (
  select
    b.*,
    sum(b.practical_value) over () as total_practical_value,
    sum(b.practical_value) over (
      order by b.practical_value desc, b.card_name, b.card_uuid
      rows between unbounded preceding and current row
    ) as cumulative_value,
    row_number() over (order by b.practical_value desc, b.card_name, b.card_uuid) as value_rank
  from base b
),
growth as (
  select
    v.*,
    h.market_price as market_90d,
    h.observed_at as market_90d_observed_at,
    case when h.market_price > 0 and v.tcg_market is not null
      then (v.tcg_market - h.market_price) * v.quantity end as growth_dollars,
    case when h.market_price > 0 and v.tcg_market is not null
      then 100 * (v.tcg_market - h.market_price) / h.market_price end as growth_pct
  from valued v
  left join lateral (
    select ph.market_price, ph.observed_at
    from public.tcgplayer_official_sku_price_history ph
    where ph.sku_id = v.sku_id
      and ph.market_price > 0
      and ph.observed_at between now() - interval '120 days' and now() - interval '83 days'
    order by abs(extract(epoch from (ph.observed_at - (now() - interval '90 days'))))
    limit 1
  ) h on v.sku_id is not null and v.market_value >= 2
),
summary as (
  select
    count(*)::int as content_lines,
    coalesce(sum(quantity), 0)::numeric as content_copies,
    count(*) filter (where sku_id is not null)::int as resolved_skus,
    count(*) filter (where sku_id is null)::int as unresolved_skus,
    coalesce(sum(practical_value), 0)::numeric as practical_value,
    coalesce(sum(practical_value) filter (where sku_id is not null), 0)::numeric as resolved_value,
    count(*) filter (where direct_available_current is not null)::int as direct_observed,
    count(*) filter (where direct_available_current > 0)::int as direct_in_stock,
    count(*) filter (where direct_available_current >= 10)::int as direct_depth_10,
    count(*) filter (where direct_available_current >= 25)::int as direct_depth_25,
    coalesce(sum(practical_value) filter (where direct_available_current > 0), 0)::numeric as direct_covered_value,
    count(*) filter (where syp_eligible)::int as syp_listed,
    coalesce(sum(practical_value) filter (where syp_eligible), 0)::numeric as syp_value,
    coalesce(sum(syp_max_quantity) filter (where syp_eligible), 0)::numeric as syp_capacity,
    count(*) filter (where syp_eligible and direct_available_current = 0)::int as syp_no_direct,
    coalesce(sum(practical_value) filter (where syp_eligible and direct_available_current = 0), 0)::numeric as syp_no_direct_value,
    count(*) filter (where syp_eligible and direct_available_current is null)::int as syp_direct_unobserved,
    count(*) filter (where market_value >= 2)::int as cards_2_plus,
    count(*) filter (where market_value >= 5)::int as cards_5_plus,
    count(*) filter (where market_value >= 10)::int as cards_10_plus,
    coalesce(sum(practical_value) filter (where value_rank <= 1), 0)::numeric as top_1_value,
    coalesce(sum(practical_value) filter (where value_rank <= 5), 0)::numeric as top_5_value,
    coalesce(sum(practical_value) filter (where value_rank <= 10), 0)::numeric as top_10_value,
    (min(value_rank) filter (where cumulative_value >= total_practical_value * .5))::int as cards_to_50,
    (min(value_rank) filter (where cumulative_value >= total_practical_value * .8))::int as cards_to_80,
    count(*) filter (where market_value >= 2 and market_90d is not null)::int as growth_history_cards,
    count(*) filter (where market_value >= 2 and growth_dollars > 0)::int as growing_cards,
    coalesce(sum(growth_dollars) filter (where market_value >= 2 and market_90d is not null), 0)::numeric as growth_basket_dollars,
    max(market_90d_observed_at) as history_observed_through
  from growth
),
top_value as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'card_uuid', card_uuid,
    'name', card_name,
    'set_code', set_code,
    'collector_number', collector_number,
    'finish', finish,
    'quantity', quantity,
    'practical_value', round(practical_value, 2),
    'share_pct', round(100 * practical_value / nullif(total_practical_value, 0), 1),
    'direct_available', direct_available_current,
    'syp_eligible', coalesce(syp_eligible, false)
  ) order by value_rank), '[]'::jsonb) as rows
  from growth
  where value_rank <= 10
),
top_growth as (
  select coalesce(jsonb_agg(x.item order by x.growth_dollars desc), '[]'::jsonb) as rows
  from (
    select growth_dollars, jsonb_build_object(
      'card_uuid', card_uuid,
      'name', card_name,
      'set_code', set_code,
      'collector_number', collector_number,
      'finish', finish,
      'quantity', quantity,
      'market_now', round(tcg_market, 2),
      'market_90d', round(market_90d, 2),
      'growth_dollars', round(growth_dollars, 2),
      'growth_pct', round(growth_pct, 1),
      'baseline_at', market_90d_observed_at
    ) as item
    from growth
    where market_value >= 2 and market_90d is not null
    order by growth_dollars desc nulls last
    limit 8
  ) x
),
labels as (
  select array_remove(array[
    case when s.practical_value > 0 and s.direct_covered_value / s.practical_value >= .60 and s.direct_depth_10 >= 5
      then 'DIRECT REPLENISHMENT' end,
    case when s.syp_no_direct > 0 then 'SYP RESTOCK GAPS' end,
    case when s.practical_value > 0 and s.top_10_value / s.practical_value >= .70
      then 'TOP-HEAVY HARVEST' end,
    case when s.practical_value > 0 and s.top_10_value / s.practical_value < .50 and s.cards_2_plus >= 20
      then 'BROAD BINDER VALUE' end,
    case when s.growth_history_cards >= 5 and s.growing_cards::numeric / s.growth_history_cards >= .60
      then 'MOMENTUM BASKET' end
  ], null)::text[] as values
  from summary s
)
select jsonb_build_object(
  'sealed_uuid', p_sealed_uuid,
  'generated_at', now(),
  'classifications', to_jsonb(labels.values),
  'summary', jsonb_build_object(
    'content_lines', s.content_lines,
    'content_copies', s.content_copies,
    'practical_value', round(s.practical_value, 2),
    'resolved_skus', s.resolved_skus,
    'unresolved_skus', s.unresolved_skus,
    'identity_coverage_pct', round(100 * s.resolved_skus::numeric / nullif(s.content_lines, 0), 1),
    'identity_value_coverage_pct', round(100 * s.resolved_value / nullif(s.practical_value, 0), 1),
    'direct_observed', s.direct_observed,
    'direct_observation_coverage_pct', round(100 * s.direct_observed::numeric / nullif(s.content_lines, 0), 1),
    'direct_in_stock', s.direct_in_stock,
    'direct_depth_10', s.direct_depth_10,
    'direct_depth_25', s.direct_depth_25,
    'direct_value_coverage_pct', round(100 * s.direct_covered_value / nullif(s.practical_value, 0), 1),
    'syp_listed', s.syp_listed,
    'syp_value', round(s.syp_value, 2),
    'syp_capacity', s.syp_capacity,
    'syp_no_direct', s.syp_no_direct,
    'syp_no_direct_value', round(s.syp_no_direct_value, 2),
    'syp_direct_unobserved', s.syp_direct_unobserved,
    'cards_2_plus', s.cards_2_plus,
    'cards_5_plus', s.cards_5_plus,
    'cards_10_plus', s.cards_10_plus,
    'top_1_share_pct', round(100 * s.top_1_value / nullif(s.practical_value, 0), 1),
    'top_5_share_pct', round(100 * s.top_5_value / nullif(s.practical_value, 0), 1),
    'top_10_share_pct', round(100 * s.top_10_value / nullif(s.practical_value, 0), 1),
    'cards_to_50_pct', s.cards_to_50,
    'cards_to_80_pct', s.cards_to_80,
    'growth_history_cards', s.growth_history_cards,
    'growing_cards', s.growing_cards,
    'growth_basket_dollars', round(s.growth_basket_dollars, 2),
    'history_observed_through', s.history_observed_through
  ),
  'top_value_cards', tv.rows,
  'top_growth_cards', tg.rows,
  'notes', jsonb_build_array(
    'Direct counts use current exact-SKU inventory.',
    'Growth requires a $2+ current market value and a price observation within 30 days before or 7 days after the 90-day baseline.',
    'SKU identity, Direct observation, and 90-day history coverage are reported separately; missing observations are never treated as zero inventory or zero growth.'
  )
)
from summary s
cross join labels
cross join top_value tv
cross join top_growth tg;
$function$;

revoke all on function public.ask_sealed_inventory_fit_v1(uuid) from public, anon;
grant execute on function public.ask_sealed_inventory_fit_v1(uuid) to authenticated, service_role;

comment on function public.ask_sealed_inventory_fit_v1(uuid) is
  'Fixed-content sealed inventory-fit profile: practical value concentration, exact-SKU Direct depth, SYP gaps, and coverage-aware 90-day growth.';

