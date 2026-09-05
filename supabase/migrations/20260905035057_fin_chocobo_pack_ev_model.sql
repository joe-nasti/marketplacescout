-- Official FIN Chocobo Booster Pack model.
-- The product contains two equal-rate Chocobo cards from a 20-card pool and
-- two copies of each of five Chocobo track foil basic lands. Wizards does not
-- publish duplicate protection, so the distribution uses independent draws.

insert into public.sealed_native_booster_verifications
  (set_code,booster_code,config_fingerprint,verification_status,
   official_source_url,verified_at,verification_notes)
values (
  'FIN','chocobo-bundle',
  md5('FIN|chocobo-bundle|2-of-20-equal-rate|2-each-FIC-478-482'),
  'verified',
  'https://magic.wizards.com/en/news/feature/collecting-final-fantasy',
  now(),
  '{"product":"Final Fantasy Chocobo Booster Pack","official_slots_checked":true,"checks":["2 of 20 Chocobo track foil borderless cards","20 cards appear at equal rates","10 Chocobo track foil basic lands: two of each basic land type"],"duplicate_protection":"not published"}'::jsonb
)
on conflict(set_code,booster_code) do update set
  config_fingerprint=excluded.config_fingerprint,
  verification_status=excluded.verification_status,
  official_source_url=excluded.official_source_url,
  verified_at=excluded.verified_at,
  verification_notes=excluded.verification_notes,
  updated_at=now();

insert into public.sealed_collation_profile_bindings
  (set_code,sealed_uuid,adapter_key,model_version,profile_status,source_type,
   source_ref,assumptions,priority)
select
  'FIN','b0f9c6de-4eda-5e43-a143-ff916cfac0b5',
  'special_randomized_product_v1','fin-chocobo-pack-v1','full',
  'wizards_official',
  'https://magic.wizards.com/en/news/feature/collecting-final-fantasy',
  '{"random_cards":"2 independent equal-rate draws from 20","random_pool":"FIN 564-571 + FIC 466-477","fixed_lands":"2 each FIC 478-482","duplicate_protection":"not published","noncard_extras_excluded":true}'::jsonb,
  5
where not exists (
  select 1 from public.sealed_collation_profile_bindings b
  where b.sealed_uuid='b0f9c6de-4eda-5e43-a143-ff916cfac0b5'
    and b.model_version='fin-chocobo-pack-v1'
);

create or replace function public.refresh_fin_chocobo_pack_ev_model(p_force boolean default false)
returns uuid
language plpgsql
security invoker
set search_path=''
set statement_timeout='90s'
as $$
declare
  v_sealed_uuid constant uuid := 'b0f9c6de-4eda-5e43-a143-ff916cfac0b5';
  v_model_version constant text := 'fin-chocobo-pack-v1';
  v_official_url constant text := 'https://magic.wizards.com/en/news/feature/collecting-final-fantasy';
  v_latest_id uuid;
  v_latest_at timestamptz;
  v_user_id uuid;
  v_backtest_id uuid;
  v_return_id uuid;
  v_random_count integer;
  v_land_count integer;
  v_priced_count integer;
  v_reference numeric;
  v_reference_at timestamptz;
  v_mean numeric;
  v_median numeric;
  v_p10 numeric;
  v_p90 numeric;
  v_net_mean numeric;
  v_gross_be numeric;
  v_net_be numeric;
  v_two_x numeric;
  v_five_x numeric;
  v_top10_share numeric;
begin
  select b.backtest_id,b.valuation_as_of
    into v_latest_id,v_latest_at
  from public.sealed_ev_backtests b
  where b.sealed_uuid=v_sealed_uuid and b.model_version=v_model_version
  order by b.valuation_as_of desc,b.created_at desc
  limit 1;

  if not p_force and v_latest_at >= now()-interval '20 hours' then
    return v_latest_id;
  end if;

  with targets as (
    select c.uuid,c.set_code,c.collector_number
    from public.mtgjson_cards c
    where c.language='English' and (
      (c.set_code='FIN' and c.collector_number in ('564','565','566','567','568','569','570','571'))
      or (c.set_code='FIC' and c.collector_number in
        ('466','467','468','469','470','471','472','473','474','475','476','477','478','479','480','481','482'))
    )
  ), valued as (
    select t.*,(p.low_price>0) priced
    from targets t
    left join lateral (
      select x.low_price
      from public.tcgplayer_preferred_price_current_cache x
      where x.uuid=t.uuid and x.finish='foil'
      order by x.observed_on desc limit 1
    ) p on true
  )
  select
    count(*) filter(where (set_code='FIN' and collector_number between '564' and '571')
      or (set_code='FIC' and collector_number between '466' and '477')),
    count(*) filter(where set_code='FIC' and collector_number between '478' and '482'),
    count(*) filter(where priced)
  into v_random_count,v_land_count,v_priced_count
  from valued;

  if v_random_count <> 20 or v_land_count <> 5 then
    raise exception 'FIN Chocobo model identity mismatch: % random cards, % lands',
      v_random_count,v_land_count;
  end if;
  if v_priced_count <> 25 then
    raise exception 'FIN Chocobo model requires 25/25 current TCG Low prices; found %',v_priced_count;
  end if;

  select coalesce(p.low_with_shipping,p.low_price,p.market_price),p.captured_at
    into v_reference,v_reference_at
  from public.sealed_product_price_current p
  where p.sealed_uuid=v_sealed_uuid and p.source='tcgplayer_official_product'
  order by p.captured_at desc limit 1;

  with card_values as materialized (
    select c.set_code,c.collector_number,
      p.low_price::numeric low_value,
      coalesce(
        public.collectish_direct_net(nullif(p.direct_low_price,0)),
        public.collectish_tcg_regular_net(p.low_price),0
      )::numeric net_value
    from public.mtgjson_cards c
    join lateral (
      select x.low_price,x.direct_low_price
      from public.tcgplayer_preferred_price_current_cache x
      where x.uuid=c.uuid and x.finish='foil'
      order by x.observed_on desc limit 1
    ) p on true
    where c.language='English' and (
      (c.set_code='FIN' and c.collector_number in ('564','565','566','567','568','569','570','571'))
      or (c.set_code='FIC' and c.collector_number in
        ('466','467','468','469','470','471','472','473','474','475','476','477','478','479','480','481','482'))
    )
  ), random_cards as (
    select * from card_values where
      (set_code='FIN' and collector_number between '564' and '571')
      or (set_code='FIC' and collector_number between '466' and '477')
  ), fixed as (
    select 2*sum(low_value) fixed_low,2*sum(net_value) fixed_net
    from card_values where set_code='FIC' and collector_number between '478' and '482'
  ), outcomes as (
    select f.fixed_low+a.low_value+b.low_value gross,
      f.fixed_net+a.net_value+b.net_value net
    from random_cards a cross join random_cards b cross join fixed f
  ), contributions as (
    select low_value*.1 contribution from random_cards
    union all
    select low_value*2 from card_values
      where set_code='FIC' and collector_number between '478' and '482'
  ), ranked_contributions as (
    select contribution,row_number() over(order by contribution desc) rn
    from contributions
  ), concentration as (
    select sum(contribution) filter(where rn<=10)/nullif(sum(contribution),0) share
    from ranked_contributions
  )
  select avg(o.gross),
    percentile_disc(.5) within group(order by o.gross),
    percentile_disc(.1) within group(order by o.gross),
    percentile_disc(.9) within group(order by o.gross),
    avg(o.net),
    case when v_reference is null then null else avg((o.gross>=v_reference)::int) end,
    case when v_reference is null then null else avg((o.net>=v_reference)::int) end,
    case when v_reference is null then null else avg((o.gross>=2*v_reference)::int) end,
    case when v_reference is null then null else avg((o.gross>=5*v_reference)::int) end,
    c.share
  into v_mean,v_median,v_p10,v_p90,v_net_mean,v_gross_be,v_net_be,
    v_two_x,v_five_x,v_top10_share
  from outcomes o cross join concentration c
  group by c.share;

  for v_user_id in
    select distinct p.user_id from public.sealed_set_profiles p where p.enabled
  loop
    insert into public.sealed_ev_backtests (
      user_id,sealed_uuid,set_code,product_name,model_key,model_version,
      valuation_as_of,sealed_reference_price,reference_price_source,sample_count,
      booster_count,booster_mean_ev,topper_mean_ev,gross_mean_ev,gross_median_ev,
      p10_ev,p90_ev,net_mean_ev_after_fees,break_even_probability,
      two_x_probability,five_x_probability,top10_ev_share,excluded_jackpot,
      assumptions,results
    ) values (
      v_user_id,v_sealed_uuid,'FIN','Final Fantasy Chocobo Booster Pack',
      'fin_chocobo_bundle_pack',v_model_version,now(),v_reference,
      'sealed_product_price_current',400,1,v_mean,0,v_mean,v_median,v_p10,v_p90,
      v_net_mean,v_gross_be,v_two_x,v_five_x,v_top10_share,'{}'::jsonb,
      jsonb_build_object(
        'official_source_url',v_official_url,
        'official_slots','2 of 20 equal-rate Chocobo cards + 2 each of 5 lands',
        'random_draws',2,'random_pool_size',20,'fixed_land_count',10,
        'duplicate_protection','not published; independent equal-rate draws modeled',
        'distribution_method','exact enumeration of 400 ordered outcomes',
        'pricing_basis','current TCG Low; TCG Market excluded',
        'sealed_price_captured_at',v_reference_at
      ),
      jsonb_build_object(
        'net_break_even_probability',v_net_be,
        'distribution_basis','Exact equal-rate enumeration plus deterministic lands',
        'analytical_expected_gross_ev',round(v_mean,4)
      )
    ) returning backtest_id into v_backtest_id;

    insert into public.sealed_ev_backtest_pool_items (
      backtest_id,user_id,pool_key,set_code,collector_number,card_name,rarity,
      finish,tcgplayer_product_id,market_value,value_source,metadata
    )
    select v_backtest_id,v_user_id,
      case when c.set_code='FIC' and c.collector_number between '478' and '482'
        then 'chocobo_track_lands' else 'chocobo_borderless' end,
      c.set_code,c.collector_number,c.name,c.rarity,'foil',c.tcgplayer_product_id,
      p.low_price,'TCG Low',
      jsonb_build_object(
        'native_weight',1,
        'role',case when c.set_code='FIC' and c.collector_number between '478' and '482'
          then 'fixed_land_pool' else 'equal_rate_random_pool' end,
        'card_uuid',c.uuid
      )
    from public.mtgjson_cards c
    join lateral (
      select x.low_price
      from public.tcgplayer_preferred_price_current_cache x
      where x.uuid=c.uuid and x.finish='foil'
      order by x.observed_on desc limit 1
    ) p on true
    where c.language='English' and (
      (c.set_code='FIN' and c.collector_number in ('564','565','566','567','568','569','570','571'))
      or (c.set_code='FIC' and c.collector_number in
        ('466','467','468','469','470','471','472','473','474','475','476','477','478','479','480','481','482'))
    );

    insert into public.sealed_ev_backtest_slots (
      backtest_id,user_id,slot_group,draws_per_booster,pool_key,probability,
      finish,notes,metadata
    ) values
      (v_backtest_id,v_user_id,'borderless_chocobo_cards',2,'chocobo_borderless',1,
       'foil','Two equal-rate draws; duplicate protection is not published',
       '{"official":true,"draw_model":"independent_equal_rate"}'::jsonb),
      (v_backtest_id,v_user_id,'chocobo_track_basic_lands',10,'chocobo_track_lands',1,
       'foil','Two copies of each of five basic-land printings',
       '{"official":true,"fixed_quantities_represented_as_equal_pool":true}'::jsonb);

    v_return_id := v_backtest_id;
  end loop;

  return v_return_id;
end $$;

revoke all on function public.refresh_fin_chocobo_pack_ev_model(boolean)
  from public,anon,authenticated;
grant execute on function public.refresh_fin_chocobo_pack_ev_model(boolean)
  to service_role;

select public.refresh_fin_chocobo_pack_ev_model(true);

notify pgrst,'reload schema';
