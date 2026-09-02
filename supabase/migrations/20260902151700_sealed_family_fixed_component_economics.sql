create or replace view public.sealed_product_deterministic_deck_ev as
with deck_links as (
 select p.uuid sealed_uuid,d.deck_key,d.name deck_name,d.deck_type
 from public.mtgjson_sealed_products p join public.mtgjson_decks d on coalesce(d.sealed_product_uuids,'[]'::jsonb) ? p.uuid::text
 where d.deck_type <> 'Bundle Land Pack'
), deck_values as (
 select dl.sealed_uuid,dl.deck_key,dl.deck_name,dl.deck_type,
 sum(dc.quantity*coalesce(v.mtgjson_tcgplayer_retail,0))::numeric tcg_market_ev,
 sum(dc.quantity*coalesce(v.cardkingdom_buylist,0))::numeric ck_buylist_ev,
 count(*)::int component_rows,count(*) filter(where v.mtgjson_tcgplayer_retail is not null)::int tcg_priced_rows,sum(dc.quantity)::numeric total_cards
 from deck_links dl join public.mtgjson_deck_cards dc on dc.deck_key=dl.deck_key
 left join public.mtgjson_vendor_price_pivot_current v on v.mtgjson_uuid=dc.card_uuid and v.finish=dc.finish
 group by dl.sealed_uuid,dl.deck_key,dl.deck_name,dl.deck_type
) select * from deck_values;
create or replace view public.sealed_product_deterministic_rollup as
select sealed_uuid,count(*)::int deterministic_deck_components,sum(tcg_market_ev)::numeric deterministic_tcg_market_ev,sum(ck_buylist_ev)::numeric deterministic_ck_buylist_ev,sum(total_cards)::numeric deterministic_cards,sum(component_rows)::int deterministic_rows,sum(tcg_priced_rows)::int deterministic_priced_rows from public.sealed_product_deterministic_deck_ev group by sealed_uuid;
grant select on public.sealed_product_deterministic_deck_ev,public.sealed_product_deterministic_rollup to authenticated;

drop view if exists public.sealed_product_family_economics;
create view public.sealed_product_family_economics as
with latest_backtest as (
 select distinct on (user_id,sealed_uuid) user_id,sealed_uuid,backtest_id,model_key,model_version,valuation_as_of,sealed_reference_price,gross_mean_ev,gross_median_ev,p10_ev,p90_ev,net_mean_ev_after_fees,break_even_probability,(results->>'net_break_even_probability')::numeric net_break_even_probability,two_x_probability,five_x_probability,top10_ev_share,assumptions,results
 from public.sealed_ev_backtests order by user_id,sealed_uuid,valuation_as_of desc,created_at desc
), users as (select distinct user_id from public.sealed_set_profiles where enabled),
child_rollup as (
 select u.user_id,c.parent_sealed_uuid,count(*)::int child_components,count(*) filter(where b.backtest_id is not null)::int modeled_child_components,count(*) filter(where b.backtest_id is null)::int unmodeled_child_components,sum(c.quantity) filter(where b.backtest_id is not null) modeled_child_units,sum(c.quantity*b.gross_mean_ev) filter(where b.backtest_id is not null) child_gross_mean_ev,sum(c.quantity*b.net_mean_ev_after_fees) filter(where b.backtest_id is not null) child_net_mean_ev
 from users u cross join public.sealed_product_child_components c left join latest_backtest b on b.user_id=u.user_id and b.sealed_uuid=c.child_sealed_uuid group by u.user_id,c.parent_sealed_uuid
), fixed_flags as (
 select sealed_uuid,bool_or(component_type='bundle_promo') has_bundle_promo,bool_or(component_type='scene_card') has_scene_cards from public.sealed_product_fixed_card_components group by sealed_uuid
), extras as (
 select p.uuid sealed_uuid,
 greatest(0,coalesce(jsonb_array_length(p.contents->'pack'),0)-case when coalesce(ff.has_bundle_promo,false) then 1 else 0 end)::int unresolved_pack_components,
 case when p.name in ('The Hobbit Bundle','The Hobbit Gift Bundle','The Hobbit Prerelease Pack') then 0 when p.name like 'The Hobbit Scene Box %' and coalesce(ff.has_scene_cards,false) then 0 when p.name='The Hobbit Draft Night' then 1 else coalesce(jsonb_array_length(p.contents->'other'),0) end::int unresolved_gamecard_other_components,
 coalesce(jsonb_array_length(p.contents->'deck'),0)::int declared_deck_components,
 coalesce(jsonb_array_length(p.contents->'other'),0)::int noncard_or_other_components
 from public.mtgjson_sealed_products p left join fixed_flags ff on ff.sealed_uuid=p.uuid
)
select u.user_id,f.sealed_uuid,f.set_code,f.product_name,f.category,f.subtype,f.release_date,f.tcgplayer_product_id,f.contents,f.child_component_count,f.contained_units,f.crack_model_type,f.sealed_market_price,f.sealed_low_price,f.sealed_low_with_shipping,f.sealed_price_at,f.backtest_id,f.model_key,f.model_version,f.backtest_as_of,f.sealed_reference_price,f.gross_mean_ev,f.gross_median_ev,f.p10_ev,f.p90_ev,f.net_mean_ev_after_fees,f.break_even_probability,f.net_break_even_probability,f.two_x_probability,f.five_x_probability,f.top10_ev_share,f.assumptions,f.results,f.model_status,
 case when b.backtest_id is not null then b.gross_mean_ev else coalesce(cr.child_gross_mean_ev,0)+coalesce(dr.deterministic_tcg_market_ev,0)+coalesce(fc.fixed_tcg_market_ev,0) end crack_gross_mean_ev,
 b.gross_median_ev crack_gross_median_ev,b.p10_ev crack_p10_ev,b.p90_ev crack_p90_ev,
 case when b.backtest_id is not null then b.net_mean_ev_after_fees else coalesce(cr.child_net_mean_ev,0)+(coalesce(dr.deterministic_tcg_market_ev,0)+coalesce(fc.fixed_tcg_market_ev,0))*0.75 end crack_net_mean_ev,
 b.break_even_probability crack_break_even_probability,b.net_break_even_probability crack_net_break_even_probability,cr.child_components,cr.modeled_child_components,cr.unmodeled_child_components,cr.modeled_child_units,
 case when b.backtest_id is not null then 'direct_backtest' when coalesce(cr.modeled_child_components,0)>0 or coalesce(dr.deterministic_deck_components,0)>0 or coalesce(fc.fixed_component_rows,0)>0 then 'modeled_components' else 'not_modeled' end crack_value_basis,
 case when b.backtest_id is not null then true when (coalesce(cr.modeled_child_components,0)>0 or coalesce(dr.deterministic_deck_components,0)>0 or coalesce(fc.fixed_component_rows,0)>0) and coalesce(cr.unmodeled_child_components,0)=0 and greatest(0,coalesce(e.declared_deck_components,0)-case when coalesce(fc.fixed_component_rows,0)>0 and f.product_name in ('The Hobbit Bundle','The Hobbit Gift Bundle') then 1 else coalesce(dr.deterministic_deck_components,0) end)=0 and coalesce(e.unresolved_pack_components,0)=0 and coalesce(e.unresolved_gamecard_other_components,0)=0 then true else false end crack_value_complete,
 (case when b.backtest_id is not null then b.gross_mean_ev else coalesce(cr.child_gross_mean_ev,0)+coalesce(dr.deterministic_tcg_market_ev,0)+coalesce(fc.fixed_tcg_market_ev,0) end)-f.sealed_market_price gross_crack_spread,
 (case when b.backtest_id is not null then b.net_mean_ev_after_fees else coalesce(cr.child_net_mean_ev,0)+(coalesce(dr.deterministic_tcg_market_ev,0)+coalesce(fc.fixed_tcg_market_ev,0))*0.75 end)-f.sealed_market_price net_crack_spread,
 coalesce(dr.deterministic_deck_components,0) deterministic_deck_components,dr.deterministic_tcg_market_ev,dr.deterministic_ck_buylist_ev,dr.deterministic_cards,
 greatest(0,coalesce(e.declared_deck_components,0)-case when coalesce(fc.fixed_component_rows,0)>0 and f.product_name in ('The Hobbit Bundle','The Hobbit Gift Bundle') then 1 else coalesce(dr.deterministic_deck_components,0) end)::int unresolved_deck_components,
 e.unresolved_pack_components,e.unresolved_gamecard_other_components unresolved_other_components,
 coalesce(fc.fixed_component_rows,0) fixed_component_rows,fc.fixed_card_count,fc.fixed_tcg_market_ev,fc.fixed_ck_buylist_ev,fc.fixed_priced_rows,e.noncard_or_other_components,case when e.noncard_or_other_components>e.unresolved_gamecard_other_components then true else false end noncard_extras_excluded
from users u join public.sealed_product_family_context f on true left join latest_backtest b on b.user_id=u.user_id and b.sealed_uuid=f.sealed_uuid left join child_rollup cr on cr.user_id=u.user_id and cr.parent_sealed_uuid=f.sealed_uuid left join public.sealed_product_deterministic_rollup dr on dr.sealed_uuid=f.sealed_uuid left join public.sealed_product_fixed_card_ev fc on fc.sealed_uuid=f.sealed_uuid left join extras e on e.sealed_uuid=f.sealed_uuid;
grant select on public.sealed_product_family_economics to authenticated;
