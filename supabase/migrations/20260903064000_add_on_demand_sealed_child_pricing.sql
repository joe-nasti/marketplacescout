-- Value unmodeled booster children through a current sealed-sale route after
-- the exact parent detail view requests an official TCGplayer price. This is
-- deliberately not crack EV and never uses TCG Market.
create or replace view public.sealed_child_resale_fallback_current
with (security_invoker=true) as
with users as (
  select distinct user_id from public.sealed_set_profiles where enabled
), children as (
  select distinct child_sealed_uuid from public.sealed_product_child_components
), ranked_prices as (
  select sp.*,
    row_number() over(partition by sp.sealed_uuid order by sp.captured_at desc,
      case when sp.source='tcgplayer_public' and coalesce(sp.total_listings,0)>0 then 0
           when sp.source='tcgplayer_official_product' then 1 else 2 end) price_rank
  from public.sealed_product_price_current sp
  where sp.source in ('tcgplayer_public','tcgplayer_official_product')
    and coalesce(sp.low_with_shipping,sp.low_price)>0
), priced as (
  select u.user_id,p.uuid sealed_uuid,p.name product_name,
    coalesce(sp.low_with_shipping,sp.low_price)::numeric sealed_tcg_low,
    sp.total_listings,sp.captured_at,sp.source
  from users u cross join children c
  join public.mtgjson_sealed_products p on p.uuid=c.child_sealed_uuid
  join ranked_prices sp on sp.sealed_uuid=p.uuid and sp.price_rank=1
  left join public.sealed_product_executable_ev_cache ce
    on ce.user_id=u.user_id and ce.sealed_uuid=p.uuid
  where ce.valuation_basis is null
    and ((p.category='box_set' and p.subtype like 'secret_lair%') or p.category='booster_pack')
    and (sp.source='tcgplayer_official_product' or coalesce(sp.total_listings,0)>0)
)
select user_id,sealed_uuid,product_name,sealed_tcg_low tcg_low_ev,
  public.collectish_tcg_regular_net(sealed_tcg_low) practical_liquidation_ev,
  'sealed_resale_current_only'::text valuation_basis,
  total_listings,captured_at valuation_as_of,
  'TCG Low sealed resale after regular marketplace fees; TCG Market and crack EV excluded'::text valuation_policy
from priced where public.collectish_tcg_regular_net(sealed_tcg_low)>0;

grant select on public.sealed_child_resale_fallback_current to authenticated,service_role;
revoke all on public.sealed_child_resale_fallback_current from anon;

create or replace view public.sealed_child_price_gap_current
with (security_invoker=true) as
select distinct c.parent_sealed_uuid,c.child_sealed_uuid,c.child_product_name,
  p.category,p.subtype,p.tcgplayer_product_id,sp.captured_at last_official_price_at,
  case when p.tcgplayer_product_id is null then 'missing_product_id'
       when sp.captured_at is null then 'refreshable_missing_price'
       when sp.captured_at<now()-interval '12 hours' then 'refreshable_stale_price'
       else 'current' end price_status
from public.sealed_product_child_components c
join public.mtgjson_sealed_products p on p.uuid=c.child_sealed_uuid
left join public.sealed_product_price_current sp
  on sp.sealed_uuid=p.uuid and sp.source='tcgplayer_official_product'
where p.category='booster_pack';

grant select on public.sealed_child_price_gap_current to authenticated,service_role;
revoke all on public.sealed_child_price_gap_current from anon;
notify pgrst,'reload schema';
