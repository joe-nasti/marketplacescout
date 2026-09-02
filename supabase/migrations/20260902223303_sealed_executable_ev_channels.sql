-- Sealed EV must use executable prices. TCG Market remains reference-only.
-- Randomized products intentionally exclude SYP and last-known Direct prices.

create or replace function public.collectish_direct_net(p_price numeric)
returns numeric language sql immutable parallel safe set search_path='' as $$
  select case
    when p_price is null or p_price < .40 then null
    when p_price <= 2.49 then round(p_price * .50, 4)
    else round(greatest(0, p_price - 1.12 - p_price * .1145), 4)
  end
$$;

create or replace function public.collectish_tcg_regular_net(p_price numeric)
returns numeric language sql immutable parallel safe set search_path='' as $$
  -- Conservative one-card order allocation: 10.75% commission, 2.5%
  -- transaction fee, and the fixed $0.30 transaction fee.
  select case when p_price is null or p_price <= 0 then null
    else round(greatest(0, p_price * .8675 - .30), 4) end
$$;

revoke all on function public.collectish_direct_net(numeric) from public;
revoke all on function public.collectish_tcg_regular_net(numeric) from public;
grant execute on function public.collectish_direct_net(numeric) to authenticated,service_role;
grant execute on function public.collectish_tcg_regular_net(numeric) to authenticated,service_role;

create index if not exists tcgplayer_preferred_cache_product_finish_date_idx
  on public.tcgplayer_preferred_price_current_cache(product_id,finish,observed_on desc);
create index if not exists mtgjson_cards_tcg_product_identity_idx
  on public.mtgjson_cards(tcgplayer_product_id,set_code,collector_number);

-- The original HOB loader stored exact published primary slot rows but omitted
-- the explicitly modeled sub-1% residual buckets. Persist them so all channel
-- valuations use the same full collation as the Monte Carlo runner.
insert into public.sealed_ev_backtest_slots
  (backtest_id,user_id,slot_group,draws_per_booster,pool_key,probability,finish,notes,metadata)
select b.backtest_id,b.user_id,x.slot_group,1,x.pool_key,x.probability,x.finish,
       'Rounded <1% residual used by HOB official runner',
       jsonb_build_object('source','hobbit-play-v1-rounded-official')
from public.sealed_ev_backtests b
cross join (values
 ('wildcard','scene_common',.000932::numeric,'normal'),
 ('wildcard','scene_uncommon',.001864,'normal'),
 ('wildcard','scene_rare',.004194,'normal'),
 ('wildcard','dragon_uncommon',.002796,'normal'),
 ('wildcard','dragon_rare',.005126,'normal'),
 ('wildcard','dragon_mythic',.003728,'normal'),
 ('wildcard','book_rare',.001864,'normal'),
 ('wildcard','book_mythic',.002796,'normal'),
 ('rare_mythic','scene_rare',.018,'normal'),
 ('rare_mythic','dragon_rare',.023,'normal'),
 ('rare_mythic','dragon_mythic',.008444,'normal'),
 ('rare_mythic','book_rare',.004222,'normal'),
 ('rare_mythic','book_mythic',.006334,'normal'),
 ('foil','scene_common',.00112,'foil'),
 ('foil','scene_uncommon',.00224,'foil'),
 ('foil','scene_rare',.00504,'foil'),
 ('foil','dragon_uncommon',.00336,'foil'),
 ('foil','dragon_rare',.00616,'foil'),
 ('foil','dragon_mythic',.00448,'foil'),
 ('foil','book_rare',.00224,'foil'),
 ('foil','book_mythic',.00336,'foil')
) x(slot_group,pool_key,probability,finish)
where b.model_key='hobbit-play-booster'
and not exists (
  select 1 from public.sealed_ev_backtest_slots s
  where s.backtest_id=b.backtest_id and s.slot_group=x.slot_group
    and s.pool_key=x.pool_key and s.finish=x.finish
);

create or replace view public.sealed_ev_pool_executable_values
with (security_invoker=true) as
select i.backtest_id,i.user_id,i.pool_item_id,i.pool_key,i.finish,
       coalesce(p.low_price,0)::numeric tcg_low,
       public.collectish_direct_net(p.direct_low_price) direct_net,
       public.collectish_tcg_regular_net(p.low_price) tcg_regular_net,
       coalesce(v.cardkingdom_buylist,0)::numeric ck_cash,
       case when v.manapool_retail is null then null
            else round(v.manapool_retail*.975,4) end manapool_net,
       greatest(
         coalesce(public.collectish_direct_net(p.direct_low_price),0),
         coalesce(public.collectish_tcg_regular_net(p.low_price),0),
         coalesce(v.cardkingdom_buylist,0),
         coalesce(v.manapool_retail*.975,0)
       )::numeric collectish_live_out,
       case
         when public.collectish_direct_net(p.direct_low_price) is not null then 'TCG Direct'
         when public.collectish_tcg_regular_net(p.low_price) is not null then 'TCG Regular'
         else null
       end direct_first_channel,
       case greatest(
         coalesce(public.collectish_direct_net(p.direct_low_price),0),
         coalesce(public.collectish_tcg_regular_net(p.low_price),0),
         coalesce(v.cardkingdom_buylist,0),coalesce(v.manapool_retail*.975,0))
         when coalesce(public.collectish_direct_net(p.direct_low_price),0) then 'TCG Direct'
         when coalesce(public.collectish_tcg_regular_net(p.low_price),0) then 'TCG Regular'
         when coalesce(v.cardkingdom_buylist,0) then 'Card Kingdom'
         else 'ManaPool'
       end collectish_live_channel,
       p.observed_on price_observed_on
from public.sealed_ev_backtest_pool_items i
left join lateral (
  select x.low_price,x.direct_low_price,x.observed_on
  from public.tcgplayer_preferred_price_current_cache x
  where i.tcgplayer_product_id ~ '^[0-9]+$'
    and x.product_id=i.tcgplayer_product_id::bigint and x.finish=i.finish
  order by x.observed_on desc limit 1
) p on true
left join lateral (
  select c.uuid from public.mtgjson_cards c
  where c.tcgplayer_product_id=i.tcgplayer_product_id
    and upper(c.set_code)=upper(i.set_code)
    and c.collector_number=i.collector_number
  order by c.uuid limit 1
) c on true
left join public.scout_vendor_price_current_cache v
  on v.mtgjson_uuid=c.uuid and v.finish=i.finish;

create or replace view public.sealed_ev_channel_current
with (security_invoker=true) as
with latest as (
  select distinct on (b.user_id,b.sealed_uuid) b.*
  from public.sealed_ev_backtests b
  order by b.user_id,b.sealed_uuid,b.valuation_as_of desc,b.created_at desc
), pool as (
  select v.backtest_id,v.pool_key,v.finish,
         avg(v.tcg_low) tcg_low,
         avg(coalesce(v.direct_net,v.tcg_regular_net,0)) direct_first_net,
         avg(v.collectish_live_out) collectish_live_out,
         count(*) filter(where v.tcg_low>0)::numeric/nullif(count(*),0) price_coverage
  from public.sealed_ev_pool_executable_values v group by 1,2,3
), pack as (
  select l.user_id,l.sealed_uuid,l.backtest_id,l.model_key,l.model_version,l.valuation_as_of,
         sum(s.draws_per_booster*s.probability*coalesce(p.tcg_low,0)) tcg_low_per_pack,
         sum(s.draws_per_booster*s.probability*coalesce(p.direct_first_net,0)) direct_first_net_per_pack,
         sum(s.draws_per_booster*s.probability*coalesce(p.collectish_live_out,0)) collectish_live_out_per_pack,
         sum(s.draws_per_booster*s.probability*coalesce(p.price_coverage,0)) /
           nullif(sum(s.draws_per_booster*s.probability),0) price_coverage
  from latest l join public.sealed_ev_backtest_slots s on s.backtest_id=l.backtest_id
  left join pool p on p.backtest_id=s.backtest_id and p.pool_key=s.pool_key and p.finish=s.finish
  group by l.user_id,l.sealed_uuid,l.backtest_id,l.model_key,l.model_version,l.valuation_as_of
)
select p.*,
       round(p.tcg_low_per_pack*coalesce(l.booster_count,1),4) tcg_low_ev,
       round(p.direct_first_net_per_pack*coalesce(l.booster_count,1),4) direct_first_net_ev,
       round(p.collectish_live_out_per_pack*coalesce(l.booster_count,1),4) collectish_live_out_ev,
       round(p.price_coverage*100,2) price_coverage_pct,
       'current_only_no_syp'::text randomized_route_policy
from pack p join latest l using(user_id,sealed_uuid,backtest_id);

create or replace view public.sealed_fixed_executable_ev
with (security_invoker=true) as
with valued as (
 select fc.sealed_uuid,fc.quantity,
        coalesce(p.low_price,0)::numeric tcg_low,
        coalesce(public.collectish_direct_net(p.direct_low_price),public.collectish_tcg_regular_net(p.low_price),0) direct_first_net,
        greatest(coalesce(public.collectish_direct_net(p.direct_low_price),0),
          coalesce(public.collectish_tcg_regular_net(p.low_price),0),
          coalesce(v.cardkingdom_buylist,0),coalesce(v.manapool_retail*.975,0))::numeric collectish_live_out
 from public.sealed_product_fixed_card_components fc
 left join lateral (
   select x.low_price,x.direct_low_price from public.tcgplayer_preferred_price_current_cache x
   where x.uuid=fc.card_uuid and x.finish=fc.finish order by x.observed_on desc limit 1
 ) p on true
 left join public.scout_vendor_price_current_cache v on v.mtgjson_uuid=fc.card_uuid and v.finish=fc.finish
)
select sealed_uuid,sum(quantity*tcg_low) fixed_tcg_low_ev,
       sum(quantity*direct_first_net) fixed_direct_first_net_ev,
       sum(quantity*collectish_live_out) fixed_collectish_live_out_ev
from valued group by sealed_uuid;

create or replace view public.sealed_product_executable_ev_current
with (security_invoker=true) as
with users as (select distinct user_id from public.sealed_set_profiles where enabled),
children as (
 select u.user_id,c.parent_sealed_uuid,
   sum(c.quantity*e.tcg_low_ev) child_tcg_low_ev,
   sum(c.quantity*e.direct_first_net_ev) child_direct_first_net_ev,
   sum(c.quantity*e.collectish_live_out_ev) child_collectish_live_out_ev,
   sum(c.quantity) filter(where e.sealed_uuid is not null) modeled_child_units
 from users u cross join public.sealed_product_child_components c
 left join public.sealed_ev_channel_current e on e.user_id=u.user_id and e.sealed_uuid=c.child_sealed_uuid
 group by u.user_id,c.parent_sealed_uuid
), keys as (
 select user_id,sealed_uuid from public.sealed_ev_channel_current
 union
 select user_id,parent_sealed_uuid from children
 union
 select u.user_id,f.sealed_uuid from users u cross join public.sealed_fixed_executable_ev f
)
select k.user_id,k.sealed_uuid,
 coalesce(e.tcg_low_ev,ch.child_tcg_low_ev,0)+case when e.sealed_uuid is null then coalesce(f.fixed_tcg_low_ev,0) else 0 end tcg_low_ev,
 coalesce(e.direct_first_net_ev,ch.child_direct_first_net_ev,0)+case when e.sealed_uuid is null then coalesce(f.fixed_direct_first_net_ev,0) else 0 end direct_first_net_ev,
 coalesce(e.collectish_live_out_ev,ch.child_collectish_live_out_ev,0)+case when e.sealed_uuid is null then coalesce(f.fixed_collectish_live_out_ev,0) else 0 end collectish_live_out_ev,
 coalesce(f.fixed_tcg_low_ev,0) fixed_tcg_low_ev,
 coalesce(f.fixed_collectish_live_out_ev,0) fixed_collectish_live_out_ev,
 coalesce(ch.modeled_child_units,0) modeled_child_units,
 coalesce(e.price_coverage_pct,100) price_coverage_pct,
 case when e.sealed_uuid is not null then 'randomized_current_only'
      when ch.parent_sealed_uuid is not null then 'children_plus_fixed_current_only'
      else 'fixed_current_only' end valuation_basis,
 e.model_key,e.model_version,e.valuation_as_of
from keys k
left join public.sealed_ev_channel_current e on e.user_id=k.user_id and e.sealed_uuid=k.sealed_uuid
left join children ch on ch.user_id=k.user_id and ch.parent_sealed_uuid=k.sealed_uuid
left join public.sealed_fixed_executable_ev f on f.sealed_uuid=k.sealed_uuid;

grant select on public.sealed_ev_pool_executable_values,public.sealed_ev_channel_current,
 public.sealed_fixed_executable_ev,public.sealed_product_executable_ev_current
to authenticated,service_role;

notify pgrst,'reload schema';
