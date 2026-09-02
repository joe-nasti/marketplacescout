-- Canonical fast comparison cache used by Scout Singles and Sealed Source Compare.
-- This intentionally precomputes the sealed -> expected single relationship so
-- interactive card/sealed details never invoke the expensive recursive model.

alter table public.sealed_single_source_compare_current
  add column if not exists card_uuid uuid,
  add column if not exists sku_id text,
  add column if not exists expected_market_contribution numeric,
  add column if not exists ev_allocated_acquisition_per_copy numeric,
  add column if not exists direct_buy_price numeric,
  add column if not exists best_modeled_exit_net numeric,
  add column if not exists crack_advantage_vs_direct_pct numeric,
  add column if not exists crack_allocated_profit_per_copy numeric,
  add column if not exists product_expected_exit_total numeric;

create index if not exists sealed_single_source_compare_identity_idx
  on public.sealed_single_source_compare_current(user_id,card_set_code,collector_number,finish,card_name);
create index if not exists sealed_single_source_compare_sku_idx
  on public.sealed_single_source_compare_current(user_id,sku_id);

create or replace function public.refresh_sealed_single_source_compare_current(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path='public'
as $function$
declare n integer;
begin
  delete from sealed_single_source_compare_current where user_id=p_user_id;
  with latest_b as (
    select distinct on (sealed_uuid) sealed_uuid,backtest_id,coalesce(booster_count,1)::numeric booster_count
    from sealed_ev_backtests where user_id=p_user_id order by sealed_uuid,valuation_as_of desc,created_at desc
  ), pool_sizes as (
    select i.backtest_id,i.pool_key,i.finish,count(*)::numeric n
    from sealed_ev_backtest_pool_items i join latest_b b on b.backtest_id=i.backtest_id group by 1,2,3
  ), pulls as (
    select s.backtest_id,s.pool_key,s.finish,sum(s.draws_per_booster*s.probability)::numeric pulls_per_booster
    from sealed_ev_backtest_slots s join latest_b b on b.backtest_id=s.backtest_id group by 1,2,3
  ), direct_rows as (
    select b.sealed_uuid,i.card_name,i.set_code card_set_code,i.collector_number,i.finish,i.tcgplayer_product_id,
           sum(b.booster_count*p.pulls_per_booster/nullif(ps.n,0)) expected_copies,
           max(i.market_value) buy_direct_reference,'probabilistic'::text source_kind
    from latest_b b
    join sealed_ev_backtest_pool_items i on i.backtest_id=b.backtest_id
    join pool_sizes ps on ps.backtest_id=i.backtest_id and ps.pool_key=i.pool_key and ps.finish=i.finish
    join pulls p on p.backtest_id=i.backtest_id and p.pool_key=i.pool_key and p.finish=i.finish
    group by b.sealed_uuid,i.card_name,i.set_code,i.collector_number,i.finish,i.tcgplayer_product_id
  ), child_rows as (
    select c.parent_sealed_uuid sealed_uuid,d.card_name,d.card_set_code,d.collector_number,d.finish,d.tcgplayer_product_id,
           sum(c.quantity*d.expected_copies) expected_copies,max(d.buy_direct_reference) buy_direct_reference,'child_sealed'::text source_kind
    from sealed_product_child_components c
    join direct_rows d on d.sealed_uuid=c.child_sealed_uuid
    left join latest_b pb on pb.sealed_uuid=c.parent_sealed_uuid
    where pb.backtest_id is null
    group by c.parent_sealed_uuid,d.card_name,d.card_set_code,d.collector_number,d.finish,d.tcgplayer_product_id
  ), all_rows as (
    select * from direct_rows union all select * from child_rows
  ), agg as (
    select sealed_uuid,card_name,card_set_code,collector_number,finish,tcgplayer_product_id,
           sum(expected_copies) expected_copies,max(buy_direct_reference) buy_direct_reference,
           string_agg(distinct source_kind,',' order by source_kind) source_kind
    from all_rows group by 1,2,3,4,5,6
  )
  insert into sealed_single_source_compare_current(
    user_id,sealed_uuid,product_name,card_name,card_set_code,collector_number,finish,tcgplayer_product_id,
    expected_copies,probability_basis,buy_direct_reference,sealed_market_price,
    naive_sealed_spend_per_expected_copy,market_exit_net_reference,expected_exit_contribution,
    source_kind,refreshed_at,expected_market_contribution
  )
  select p_user_id,a.sealed_uuid,sp.name,a.card_name,a.card_set_code,a.collector_number,a.finish,a.tcgplayer_product_id,a.expected_copies,
         'official slot probabilities; uniform within modeled pool'::text,a.buy_direct_reference,price.market_price,
         case when a.expected_copies>0 then price.market_price/a.expected_copies end,
         a.buy_direct_reference*.75,a.expected_copies*a.buy_direct_reference*.75,a.source_kind,now(),a.expected_copies*a.buy_direct_reference
  from agg a join mtgjson_sealed_products sp on sp.uuid=a.sealed_uuid
  left join lateral(
    select market_price from sealed_product_price_current x where x.sealed_uuid=a.sealed_uuid order by captured_at desc limit 1
  ) price on true;

  with totals as (
    select user_id,sealed_uuid,sum(expected_exit_contribution) total_exit
    from sealed_single_source_compare_current where user_id=p_user_id group by user_id,sealed_uuid
  )
  update sealed_single_source_compare_current c
     set product_expected_exit_total=t.total_exit,
         ev_allocated_acquisition_per_copy=case when c.expected_copies>0 and t.total_exit>0 then c.sealed_market_price*(c.expected_exit_contribution/t.total_exit)/c.expected_copies end,
         crack_advantage_vs_direct_pct=case when c.buy_direct_reference>0 and c.expected_copies>0 and t.total_exit>0 then 100*(c.buy_direct_reference-c.sealed_market_price*(c.expected_exit_contribution/t.total_exit)/c.expected_copies)/c.buy_direct_reference end,
         crack_allocated_profit_per_copy=case when c.expected_copies>0 and t.total_exit>0 then c.market_exit_net_reference-c.sealed_market_price*(c.expected_exit_contribution/t.total_exit)/c.expected_copies end,
         best_modeled_exit_net=c.market_exit_net_reference,
         direct_buy_price=c.buy_direct_reference
  from totals t where c.user_id=t.user_id and c.sealed_uuid=t.sealed_uuid;

  get diagnostics n=row_count;
  return n;
end
$function$;

revoke all on function public.refresh_sealed_single_source_compare_current(uuid) from public, anon, authenticated;
grant execute on function public.refresh_sealed_single_source_compare_current(uuid) to service_role;
