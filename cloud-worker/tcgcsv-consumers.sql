-- Consumers of public.tcgplayer_preferred_prices.
-- Production migrations applied 2026-08-25.

create or replace function public.refresh_scout_vendor_price_current_cache()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '180s'
as $function$
declare n integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role' then raise exception 'service_role required'; end if;
  truncate table public.scout_vendor_price_current_cache;

  with latest_provider as materialized (
    select uuid,provider,price_type,finish,price,observed_on
    from public.mtgjson_latest_vendor_prices
    where provider in ('cardkingdom','manapool','cardmarket')
  ),
  latest_day as (
    select uuid,finish,max(observed_on) observed_on
    from latest_provider
    group by uuid,finish
  ),
  vendor_rollup as (
    select p.uuid,p.finish,d.observed_on,
      max(p.price) filter(where p.provider='cardkingdom' and p.price_type='retail') cardkingdom_retail,
      max(p.price) filter(where p.provider='cardkingdom' and p.price_type='buylist') cardkingdom_buylist,
      max(p.price) filter(where p.provider='manapool' and p.price_type='retail') manapool_retail,
      max(p.price) filter(where p.provider='cardmarket' and p.price_type='retail') cardmarket_retail
    from latest_provider p
    join latest_day d on d.uuid=p.uuid and d.finish=p.finish and d.observed_on=p.observed_on
    group by p.uuid,p.finish,d.observed_on
  ),
  keys as (
    select uuid,finish from vendor_rollup
    union
    select uuid,finish from public.tcgplayer_preferred_prices
  )
  insert into public.scout_vendor_price_current_cache (
    mtgjson_uuid,finish,observed_on,tcgplayer_retail,cardkingdom_retail,cardkingdom_buylist,manapool_retail,cardmarket_retail,refreshed_at
  )
  select k.uuid,k.finish,
    greatest(coalesce(t.observed_on,'1900-01-01'::date),coalesce(v.observed_on,'1900-01-01'::date)),
    t.market_price,
    v.cardkingdom_retail,
    v.cardkingdom_buylist,
    v.manapool_retail,
    v.cardmarket_retail,
    now()
  from keys k
  left join public.tcgplayer_preferred_prices t on t.uuid=k.uuid and t.finish=k.finish
  left join vendor_rollup v on v.uuid=k.uuid and v.finish=k.finish;

  get diagnostics n=row_count;
  analyze public.scout_vendor_price_current_cache;
  return n;
end;
$function$;

create or replace function public.refresh_precon_ev_deck(p_user_id uuid, p_deck_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n integer; deck_total integer;
begin
  delete from public.precon_card_ev_current where user_id=p_user_id and deck_key=p_deck_key;

  with dc as (
    select d.deck_key,d.code,d.name deck_name,d.deck_type,d.release_date,
           x.card_uuid,lower(x.finish) finish,sum(x.quantity)::integer quantity,
           max(c.name) card_name,max(c.set_code) set_code,max(c.collector_number) collector_number
    from public.mtgjson_decks d
    join public.mtgjson_deck_cards x on x.deck_key=d.deck_key
    join public.mtgjson_cards c on c.uuid=x.card_uuid
    where d.deck_key=p_deck_key
    group by d.deck_key,d.code,d.name,d.deck_type,d.release_date,x.card_uuid,lower(x.finish)
  ), skus as (
    select dc.*,sk.sku_id,sk.product_id
    from dc
    left join lateral (
      select s.sku_id,s.product_id
      from public.mtgjson_tcgplayer_skus s
      where s.uuid=dc.card_uuid
        and lower(coalesce(s.condition,''))='near mint'
        and lower(coalesce(s.language,''))='english'
        and ((dc.finish='normal' and lower(coalesce(s.printing,''))='non foil')
          or (dc.finish='foil' and lower(coalesce(s.printing,''))='foil' and s.finish is null))
      order by s.sku_id limit 1
    ) sk on true
  ), obs as (
    select s.*,
      lr.sku_market_price observed_market,lr.tcg_low observed_tcg_low,lr.direct_low last_direct_low,
      lr.direct_available last_direct_available,lr.captured_at last_observed_at,
      case when lr.captured_at>=now()-interval '30 hours' and coalesce(lr.direct_available,0)>0 then lr.direct_low end direct_low_current,
      case when lr.captured_at>=now()-interval '30 hours' and coalesce(lr.direct_available,0)>0 then lr.direct_available end direct_available_current,
      sy.is_currently_eligible syp_eligible,sy.current_max_quantity syp_max_quantity,sy.last_seen syp_last_seen
    from skus s
    left join lateral (
      select r.sku_market_price,r.tcg_low,r.direct_low,r.direct_available,sc.captured_at
      from public.marketplace_scan_rows r
      join public.marketplace_scans sc on sc.user_id=r.user_id and sc.scan_id=r.scan_id
      where r.user_id=p_user_id and r.sku_id=s.sku_id
      order by sc.captured_at desc,r.id desc limit 1
    ) lr on true
    left join public.syp_products sy on sy.user_id=p_user_id and sy.tcgplayer_id=s.sku_id
  ), priced as (
    select o.*,
      tp.market_price tcg_market,
      coalesce(tp.low_price,o.observed_tcg_low) tcg_low,
      vp.ck_retail, vp.ck_buylist, vp.manapool_retail, vp.cardmarket_retail,
      greatest(coalesce(tp.observed_on,'1900-01-01'::date),coalesce(vp.observed_on,'1900-01-01'::date)) vendor_observed_on
    from obs o
    left join public.tcgplayer_preferred_prices tp
      on tp.uuid=o.card_uuid and tp.finish=o.finish
    left join lateral (
      select
        max(p.price) filter(where p.provider='cardkingdom' and p.price_type='retail') ck_retail,
        max(p.price) filter(where p.provider='cardkingdom' and p.price_type='buylist') ck_buylist,
        max(p.price) filter(where p.provider='manapool' and p.price_type='retail') manapool_retail,
        max(p.price) filter(where p.provider='cardmarket' and p.price_type='retail') cardmarket_retail,
        max(p.observed_on) observed_on
      from public.mtgjson_vendor_prices p
      where p.uuid=o.card_uuid and lower(p.finish)=o.finish
        and p.provider in ('cardkingdom','manapool','cardmarket')
        and p.observed_on=(select max(p2.observed_on) from public.mtgjson_vendor_prices p2 where p2.uuid=o.card_uuid and lower(p2.finish)=o.finish and p2.provider in ('cardkingdom','manapool','cardmarket'))
    ) vp on true
  ), ins as (
    insert into public.precon_card_ev_current(
      user_id,deck_key,card_uuid,finish,quantity,card_name,set_code,collector_number,sku_id,product_id,
      tcg_market,tcg_low,direct_low_current,direct_available_current,direct_observed_at,
      direct_low_last_observed,direct_last_observed_at,syp_eligible,syp_max_quantity,syp_last_seen,
      cardkingdom_retail,cardkingdom_buylist,manapool_retail,cardmarket_retail,vendor_observed_on,
      direct_net_current,direct_net_syp_potential,direct_status,refreshed_at)
    select p_user_id,deck_key,card_uuid,finish,quantity,card_name,set_code,collector_number,sku_id,product_id,
      coalesce(tcg_market,observed_market),tcg_low,direct_low_current,direct_available_current,
      case when direct_low_current is not null then last_observed_at end,
      last_direct_low,last_observed_at,coalesce(syp_eligible,false),syp_max_quantity,syp_last_seen,
      ck_retail,ck_buylist,manapool_retail,cardmarket_retail,vendor_observed_on,
      case when direct_low_current is not null then round(direct_low_current*.8,2) end,
      case when direct_low_current is null and coalesce(syp_eligible,false) and last_direct_low is not null then round(last_direct_low*.8,2) end,
      case when direct_low_current is not null then 'direct_live'
           when coalesce(syp_eligible,false) and last_direct_low is not null then 'syp_potential'
           when coalesce(syp_eligible,false) then 'syp_no_direct_history'
           else 'direct_unobserved' end,
      now()
    from priced
    returning 1
  ) select count(*) into n from ins;

  select coalesce(sum(quantity),0) into deck_total from public.precon_card_ev_current where user_id=p_user_id and deck_key=p_deck_key;

  insert into public.precon_ev_current as e(
    user_id,deck_key,code,deck_name,deck_type,release_date,total_cards,distinct_printings,mapped_cards,
    tcg_market_ev,tcg_low_ev,direct_live_net_ev,syp_adjusted_direct_net_ev,syp_direct_upside,
    direct_live_cards,syp_eligible_cards,syp_potential_cards,syp_requested_quantity,
    cardkingdom_retail_ev,cardkingdom_buylist_ev,manapool_retail_ev,cardmarket_retail_ev,
    market_coverage_pct,direct_live_coverage_pct,syp_adjusted_coverage_pct,buylist_coverage_pct,refreshed_at)
  select p_user_id,p_deck_key,d.code,d.name,d.deck_type,d.release_date,
    sum(c.quantity),count(*),sum(case when c.sku_id is not null then c.quantity else 0 end),
    round(sum(c.quantity*coalesce(c.tcg_market,0)),2),round(sum(c.quantity*coalesce(c.tcg_low,0)),2),
    round(sum(c.quantity*coalesce(c.direct_net_current,0)),2),
    round(sum(c.quantity*(coalesce(c.direct_net_current,0)+coalesce(c.direct_net_syp_potential,0))),2),
    round(sum(c.quantity*coalesce(c.direct_net_syp_potential,0)),2),
    sum(case when c.direct_status='direct_live' then c.quantity else 0 end),
    sum(case when c.syp_eligible then c.quantity else 0 end),
    sum(case when c.direct_status='syp_potential' then c.quantity else 0 end),
    sum(case when c.syp_eligible then coalesce(c.syp_max_quantity,0) else 0 end),
    round(sum(c.quantity*coalesce(c.cardkingdom_retail,0)),2),round(sum(c.quantity*coalesce(c.cardkingdom_buylist,0)),2),
    round(sum(c.quantity*coalesce(c.manapool_retail,0)),2),round(sum(c.quantity*coalesce(c.cardmarket_retail,0)),2),
    round(100.0*sum(case when c.tcg_market is not null then c.quantity else 0 end)/nullif(sum(c.quantity),0),1),
    round(100.0*sum(case when c.direct_status='direct_live' then c.quantity else 0 end)/nullif(sum(c.quantity),0),1),
    round(100.0*sum(case when c.direct_status in ('direct_live','syp_potential') then c.quantity else 0 end)/nullif(sum(c.quantity),0),1),
    round(100.0*sum(case when c.cardkingdom_buylist is not null then c.quantity else 0 end)/nullif(sum(c.quantity),0),1),now()
  from public.precon_card_ev_current c join public.mtgjson_decks d on d.deck_key=c.deck_key
  where c.user_id=p_user_id and c.deck_key=p_deck_key
  group by d.code,d.name,d.deck_type,d.release_date
  on conflict(user_id,deck_key) do update set
    code=excluded.code,deck_name=excluded.deck_name,deck_type=excluded.deck_type,release_date=excluded.release_date,
    total_cards=excluded.total_cards,distinct_printings=excluded.distinct_printings,mapped_cards=excluded.mapped_cards,
    tcg_market_ev=excluded.tcg_market_ev,tcg_low_ev=excluded.tcg_low_ev,direct_live_net_ev=excluded.direct_live_net_ev,
    syp_adjusted_direct_net_ev=excluded.syp_adjusted_direct_net_ev,syp_direct_upside=excluded.syp_direct_upside,
    direct_live_cards=excluded.direct_live_cards,syp_eligible_cards=excluded.syp_eligible_cards,syp_potential_cards=excluded.syp_potential_cards,
    syp_requested_quantity=excluded.syp_requested_quantity,cardkingdom_retail_ev=excluded.cardkingdom_retail_ev,
    cardkingdom_buylist_ev=excluded.cardkingdom_buylist_ev,manapool_retail_ev=excluded.manapool_retail_ev,
    cardmarket_retail_ev=excluded.cardmarket_retail_ev,market_coverage_pct=excluded.market_coverage_pct,
    direct_live_coverage_pct=excluded.direct_live_coverage_pct,syp_adjusted_coverage_pct=excluded.syp_adjusted_coverage_pct,
    buylist_coverage_pct=excluded.buylist_coverage_pct,refreshed_at=excluded.refreshed_at;

  return jsonb_build_object('deck_key',p_deck_key,'cards',n);
end;
$function$;
