-- Calendar span alone is not forecast evidence. Require several independent
-- Play Booster release cohorts with observations near release and at 60+ days.

create or replace view public.modeled_booster_card_history_health
with (security_invoker=true) as
with play_sets as (
  select distinct upper(p.set_code) set_code,coalesce(p.release_date,s.released_at) release_date
  from public.mtgjson_sealed_products p
  left join public.magic_set_catalog s on upper(s.code)=upper(p.set_code)
  where p.category='booster_pack' and p.subtype='play'
), set_products as (
  select ps.set_code,ps.release_date,c.tcgplayer_product_id::bigint product_id
  from play_sets ps join public.mtgjson_cards c on upper(c.set_code)=ps.set_code
  where c.tcgplayer_product_id~'^[0-9]+$'
), set_coverage as (
  select sp.set_code,sp.release_date,count(distinct h.product_id) covered_products,
    min(h.observed_on) first_observation,max(h.observed_on) last_observation,
    count(distinct h.observed_on) observation_days
  from set_products sp join public.modeled_booster_card_price_history h using(product_id)
  group by sp.set_code,sp.release_date
), summary as (
  select count(*)::integer covered_play_sets,
    count(*) filter(where first_observation<=release_date+14 and last_observation>=release_date+60)::integer mature_release_cohorts
  from set_coverage
)
select count(*)::bigint observation_count,count(distinct product_id)::integer product_count,
  min(observed_on) history_start,max(observed_on) history_end,
  count(distinct observed_on)::integer observation_days,
  case when count(distinct observed_on)>=12 and max(observed_on)-min(observed_on)>=75
      and s.covered_play_sets>=4 and s.mature_release_cohorts>=3
    then 'CALIBRATION_READY' else 'BUILDING_HISTORY' end calibration_status,
  'Readiness requires at least four Play Booster sets and three independent 60-day release cohorts. TCGCSV Market history is calibration evidence only and is never used as executable EV.'::text policy,
  s.covered_play_sets,s.mature_release_cohorts
from public.modeled_booster_card_price_history h cross join summary s
group by s.covered_play_sets,s.mature_release_cohorts;

revoke all on public.modeled_booster_card_history_health from public,anon,authenticated;
grant select on public.modeled_booster_card_history_health to service_role;

notify pgrst,'reload schema';
