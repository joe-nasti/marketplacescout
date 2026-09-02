create or replace view public.sealed_product_child_components
with (security_invoker=true) as
select p.uuid parent_sealed_uuid,p.set_code parent_set_code,p.name parent_product_name,(x->>'uuid')::uuid child_sealed_uuid,x->>'set' child_set_code,x->>'name' child_product_name,coalesce((x->>'count')::numeric,1) quantity,'sealed'::text component_type
from public.mtgjson_sealed_products p
cross join lateral jsonb_array_elements(coalesce(p.contents->'sealed','[]'::jsonb)) x
where x ? 'uuid';

create or replace view public.sealed_product_family_context
with (security_invoker=true) as
with latest_backtest as (
  select distinct on (b.user_id,b.sealed_uuid) b.* from public.sealed_ev_backtests b
  order by b.user_id,b.sealed_uuid,b.valuation_as_of desc,b.created_at desc
), child_counts as (
  select parent_sealed_uuid,count(*)::int child_component_count,sum(quantity)::numeric contained_units from public.sealed_product_child_components group by parent_sealed_uuid
), latest_price as (
  select distinct on (sealed_uuid) * from public.sealed_product_price_current
  order by sealed_uuid,captured_at desc,case when source='tcgplayer_official_product' then 0 else 1 end
)
select p.uuid sealed_uuid,p.set_code,p.name product_name,p.category,p.subtype,p.release_date,p.tcgplayer_product_id,p.contents,
       coalesce(cc.child_component_count,0) child_component_count,coalesce(cc.contained_units,0) contained_units,
       case when p.category='booster_pack' and p.subtype in ('play','collector','topper') then 'probabilistic_pack'
            when p.category in ('booster_box','bundle','limited_aid_tool','box_set') and coalesce(cc.child_component_count,0)>0 then 'composite_crackable'
            when p.category in ('booster_case','bundle_case','limited_aid_case') then 'container'
            when p.category='deck' then 'deterministic_deck'
            when p.category='subset' then 'container' else 'deterministic_or_other' end crack_model_type,
       sp.market_price sealed_market_price,sp.low_price sealed_low_price,sp.low_with_shipping sealed_low_with_shipping,sp.captured_at sealed_price_at,
       lb.backtest_id,lb.model_key,lb.model_version,lb.valuation_as_of backtest_as_of,lb.sealed_reference_price,lb.gross_mean_ev,lb.gross_median_ev,lb.p10_ev,lb.p90_ev,lb.net_mean_ev_after_fees,lb.break_even_probability,
       (lb.results->>'net_break_even_probability')::numeric net_break_even_probability,lb.two_x_probability,lb.five_x_probability,lb.top10_ev_share,lb.assumptions,lb.results,
       case when lb.backtest_id is not null then 'modeled' when p.category in ('booster_case','bundle_case','limited_aid_case','subset') then 'derive_from_children' when p.category='deck' then 'deterministic_pending' when p.category='booster_pack' then 'collation_pending' when coalesce(cc.child_component_count,0)>0 then 'component_model_pending' else 'not_modeled' end model_status
from public.mtgjson_sealed_products p
left join child_counts cc on cc.parent_sealed_uuid=p.uuid
left join latest_price sp on sp.sealed_uuid=p.uuid
left join latest_backtest lb on lb.sealed_uuid=p.uuid;

grant select on public.sealed_product_child_components to authenticated;
grant select on public.sealed_product_family_context to authenticated;
