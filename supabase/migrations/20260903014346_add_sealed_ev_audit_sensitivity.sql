-- Correct native weighted-sheet valuation and expose auditable sealed EV sensitivity modes.
-- TCG Market, SYP, and last-known Direct remain excluded from every mode.

create or replace view public.sealed_ev_channel_current
with (security_invoker=true) as
with latest as (
  select distinct on (b.user_id,b.sealed_uuid) b.*
  from public.sealed_ev_backtests b
  order by b.user_id,b.sealed_uuid,b.valuation_as_of desc,b.created_at desc
), weighted_pool_items as (
  select v.*,
    case when coalesce(i.metadata->>'native_weight','') ~ '^[0-9]+([.][0-9]+)?$'
      then greatest((i.metadata->>'native_weight')::numeric,0) else 1::numeric end native_weight
  from public.sealed_ev_pool_executable_values v
  join public.sealed_ev_backtest_pool_items i on i.pool_item_id=v.pool_item_id
), pool as (
  select v.backtest_id,v.pool_key,v.finish,
    sum(v.tcg_low*v.native_weight)/nullif(sum(v.native_weight),0) tcg_low,
    sum(coalesce(v.direct_net,v.tcg_regular_net,0)*v.native_weight)/nullif(sum(v.native_weight),0) direct_first_net,
    sum(v.collectish_live_out*v.native_weight)/nullif(sum(v.native_weight),0) collectish_live_out,
    sum(v.native_weight) filter(where v.tcg_low>0)/nullif(sum(v.native_weight),0) price_coverage
  from weighted_pool_items v group by 1,2,3
), pack as (
  select l.user_id,l.sealed_uuid,l.backtest_id,l.model_key,l.model_version,l.valuation_as_of,
    sum(s.draws_per_booster*s.probability*coalesce(p.tcg_low,0)) tcg_low_per_pack,
    sum(s.draws_per_booster*s.probability*coalesce(p.direct_first_net,0)) direct_first_net_per_pack,
    sum(s.draws_per_booster*s.probability*coalesce(p.collectish_live_out,0)) collectish_live_out_per_pack,
    sum(s.draws_per_booster*s.probability*coalesce(p.price_coverage,0))/
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

create or replace view public.sealed_ev_practical_channel_current
with (security_invoker=true) as
with latest as (
  select distinct on (b.user_id,b.sealed_uuid) b.*
  from public.sealed_ev_backtests b
  order by b.user_id,b.sealed_uuid,b.valuation_as_of desc,b.created_at desc
), pv as materialized (
  select v.*,
    case when coalesce(i.metadata->>'native_weight','') ~ '^[0-9]+([.][0-9]+)?$'
      then greatest((i.metadata->>'native_weight')::numeric,0) else 1::numeric end native_weight
  from public.sealed_ev_pool_practical_values v
  join public.sealed_ev_backtest_pool_items i on i.pool_item_id=v.pool_item_id
), pool as (
  select v.backtest_id,v.pool_key,v.finish,
    sum(v.practical_liquidation*v.native_weight)/nullif(sum(v.native_weight),0) practical_liquidation,
    sum(v.native_weight) total_weight
  from pv v group by 1,2,3
), base as (
  select l.user_id,l.sealed_uuid,l.backtest_id,
    sum(s.draws_per_booster*s.probability*coalesce(p.practical_liquidation,0))
      *coalesce(l.booster_count,1) practical_liquidation_ev
  from latest l
  join public.sealed_ev_backtest_slots s on s.backtest_id=l.backtest_id
  left join pool p on p.backtest_id=s.backtest_id and p.pool_key=s.pool_key and p.finish=s.finish
  group by l.user_id,l.sealed_uuid,l.backtest_id,l.booster_count
), item_contribution as (
  select l.user_id,l.sealed_uuid,v.pool_item_id,
    sum(s.draws_per_booster*s.probability*v.native_weight/nullif(p.total_weight,0))
      *max(v.practical_liquidation)*coalesce(l.booster_count,1) contribution
  from latest l
  join public.sealed_ev_backtest_slots s on s.backtest_id=l.backtest_id
  join pool p on p.backtest_id=s.backtest_id and p.pool_key=s.pool_key and p.finish=s.finish
  join pv v on v.backtest_id=p.backtest_id and v.pool_key=p.pool_key and v.finish=p.finish
  group by l.user_id,l.sealed_uuid,v.pool_item_id,l.booster_count
), ranked as (
  select x.*,row_number() over(partition by user_id,sealed_uuid order by contribution desc) rn
  from item_contribution x
), concentration as (
  select user_id,sealed_uuid,sum(contribution) total_contribution,
    sum(contribution) filter(where rn<=10) top10_contribution,max(contribution) top1_contribution
  from ranked group by 1,2
)
select b.user_id,b.sealed_uuid,round(b.practical_liquidation_ev,4) practical_liquidation_ev,
  round(100*c.top10_contribution/nullif(c.total_contribution,0),2) top10_practical_ev_share_pct,
  round(100*c.top1_contribution/nullif(c.total_contribution,0),2) top1_practical_ev_share_pct
from base b left join concentration c using(user_id,sealed_uuid);

-- Prefer complete child economics over a fixed-card-only child subtotal.
create or replace view public.sealed_product_practical_ev_current
with (security_invoker=true) as
with exec as materialized (select * from public.sealed_product_executable_ev_current),
practical as materialized (select * from public.sealed_ev_practical_channel_current),
fixed_practical as materialized (select * from public.sealed_fixed_practical_ev),
fixed_child_practical as materialized (select * from public.sealed_fixed_child_practical_ev),
latest_bt as materialized (
 select distinct on (b.user_id,b.sealed_uuid) b.* from public.sealed_ev_backtests b
 order by b.user_id,b.sealed_uuid,b.valuation_as_of desc,b.created_at desc
), child_practical as (
 select e.user_id,c.parent_sealed_uuid,
   sum(c.quantity*coalesce(p.practical_liquidation_ev,fp.practical_liquidation_ev,ce.collectish_live_out_ev)) child_practical_ev,
   sum(c.quantity*case when p.practical_liquidation_ev is not null and bt.gross_mean_ev>0
     then bt.gross_median_ev/bt.gross_mean_ev*p.practical_liquidation_ev
     else coalesce(fp.practical_liquidation_ev,ce.collectish_live_out_ev) end) child_median_estimate,
   sum(c.quantity*case when p.practical_liquidation_ev is not null and bt.gross_mean_ev>0
     then bt.p10_ev/bt.gross_mean_ev*p.practical_liquidation_ev
     else coalesce(fp.practical_liquidation_ev,ce.collectish_live_out_ev) end) child_p10_estimate,
   max(coalesce(p.top10_practical_ev_share_pct,fp.top10_practical_ev_share_pct)) child_top10_share_pct,
   max(coalesce(p.top1_practical_ev_share_pct,fp.top1_practical_ev_share_pct)) child_top1_share_pct
 from exec e
 join public.sealed_product_child_components c on c.parent_sealed_uuid=e.sealed_uuid
 left join exec ce on ce.user_id=e.user_id and ce.sealed_uuid=c.child_sealed_uuid
 left join practical p on p.user_id=e.user_id and p.sealed_uuid=c.child_sealed_uuid
 left join fixed_practical fp on fp.sealed_uuid=c.child_sealed_uuid
 left join latest_bt bt on bt.user_id=e.user_id and bt.sealed_uuid=c.child_sealed_uuid
 group by e.user_id,c.parent_sealed_uuid
), base as (
 select e.*,
   case when coalesce(bind.profile_status,'') in ('partial','component_only','unmodeled')
          and ownfp.practical_liquidation_ev is not null then ownfp.practical_liquidation_ev
        when p.practical_liquidation_ev is not null then p.practical_liquidation_ev
        when cp.parent_sealed_uuid is not null then cp.child_practical_ev+coalesce(ownfp.practical_liquidation_ev,0)
        when fcp.practical_liquidation_ev is not null then fcp.practical_liquidation_ev+coalesce(ownfp.practical_liquidation_ev,0)
        when fp.practical_liquidation_ev is not null then fp.practical_liquidation_ev
        else e.collectish_live_out_ev end randomized_practical_ev,
   coalesce(p.top10_practical_ev_share_pct,fcp.top10_practical_ev_share_pct,cp.child_top10_share_pct,fp.top10_practical_ev_share_pct) top10_practical_ev_share_pct,
   coalesce(p.top1_practical_ev_share_pct,fcp.top1_practical_ev_share_pct,cp.child_top1_share_pct,fp.top1_practical_ev_share_pct) top1_practical_ev_share_pct,
   s.sealed_acquisition_price sealed_low_price,
   (coalesce(bind.profile_status,'') in ('full','deterministic')) recommendation_eligible,
   case when bind.profile_status='full' then 'FULL MODEL' when bind.profile_status='deterministic' then 'DETERMINISTIC' else 'UNMODELED' end coverage_state,
   coalesce(bt.gross_mean_ev,e.tcg_low_ev) crack_gross_mean_ev,
   coalesce(bt.gross_median_ev,case when cp.parent_sealed_uuid is not null then cp.child_median_estimate+coalesce(ownfp.practical_liquidation_ev,0) when fp.sealed_uuid is not null then e.tcg_low_ev end) crack_gross_median_ev,
   coalesce(bt.p10_ev,case when cp.parent_sealed_uuid is not null then cp.child_p10_estimate+coalesce(ownfp.practical_liquidation_ev,0) when fp.sealed_uuid is not null then e.tcg_low_ev end) crack_p10_ev
 from exec e
 left join practical p on p.user_id=e.user_id and p.sealed_uuid=e.sealed_uuid
 left join fixed_practical fp on fp.sealed_uuid=e.sealed_uuid
 left join fixed_child_practical fcp on fcp.parent_sealed_uuid=e.sealed_uuid
 left join child_practical cp on cp.user_id=e.user_id and cp.parent_sealed_uuid=e.sealed_uuid
 left join fixed_practical ownfp on ownfp.sealed_uuid=e.sealed_uuid
 left join public.sealed_ev_current s on s.user_id=e.user_id and s.sealed_uuid=e.sealed_uuid
 left join latest_bt bt on bt.user_id=e.user_id and bt.sealed_uuid=e.sealed_uuid
 left join public.sealed_collation_binding_resolved bind on bind.sealed_uuid=e.sealed_uuid
), calculated as (
 select b.*,
   case when not b.recommendation_eligible then null
        when b.coverage_state='DETERMINISTIC' then round(b.randomized_practical_ev,4)
        when b.crack_gross_mean_ev>0 then round(b.crack_gross_median_ev/b.crack_gross_mean_ev*b.randomized_practical_ev,4) end practical_median_estimate,
   case when not b.recommendation_eligible then null
        when b.coverage_state='DETERMINISTIC' then round(b.randomized_practical_ev,4)
        when b.crack_gross_mean_ev>0 then round(b.crack_p10_ev/b.crack_gross_mean_ev*b.randomized_practical_ev,4) end practical_p10_estimate
 from base b
), scored as (
 select c.*,case when not c.recommendation_eligible then null else round(greatest(0,least(100,50
   +greatest(-30,least(30,100*(c.randomized_practical_ev/nullif(c.sealed_low_price,0)-1)))
   -case when c.price_coverage_pct>=98 then 0 when c.price_coverage_pct>=90 then 8 else 25 end
   -case when coalesce(c.top10_practical_ev_share_pct,0)<=45 then 0 when c.top10_practical_ev_share_pct<=65 then 8 else 18 end
   -case when c.practical_median_estimate is not null and c.sealed_low_price>0 and c.practical_median_estimate<c.sealed_low_price*.60 then 10 else 0 end
 )),1) end practical_scout_score from calculated c
)
select s.*,
 case when not coalesce(s.recommendation_eligible,false) then 'MODEL PENDING'
      when s.price_coverage_pct<90 then 'PRICE COVERAGE LOW'
      when coalesce(s.top10_practical_ev_share_pct,0)>70 and s.coverage_state='DETERMINISTIC' then 'VALUE CONCENTRATED'
      when coalesce(s.top10_practical_ev_share_pct,0)>70 then 'CHASE DEPENDENT'
      when s.randomized_practical_ev>=s.sealed_low_price*1.15 and coalesce(s.practical_median_estimate,s.randomized_practical_ev)>=s.sealed_low_price*.75 then 'BUY & CRACK'
      when s.randomized_practical_ev>=s.sealed_low_price then 'MARGINAL CRACK'
      else 'KEEP SEALED' end practical_action,
 case when not s.recommendation_eligible then null
      when s.practical_scout_score>=90 then 'A' when s.practical_scout_score>=80 then 'B'
      when s.practical_scout_score>=70 then 'C' when s.practical_scout_score>=60 then 'D' else 'F' end practical_scout_grade,
 'channel_liquidity_and_labor_v1'::text practical_model_version,
 'Deterministic contents use exact executable card values; randomized products preserve simulated distribution shape.'::text distribution_estimate_basis
from scored s;

grant select on public.sealed_product_practical_ev_current to authenticated,service_role;


create or replace view public.sealed_product_ev_audit_current
with (security_invoker=true) as
with recursive latest as (
  select distinct on (b.user_id,b.sealed_uuid) b.*
  from public.sealed_ev_backtests b
  order by b.user_id,b.sealed_uuid,b.valuation_as_of desc,b.created_at desc
), random_pool_items as (
  select i.backtest_id,i.pool_item_id,i.pool_key,i.finish,
    case when coalesce(i.metadata->>'native_weight','') ~ '^[0-9]+([.][0-9]+)?$'
      then greatest((i.metadata->>'native_weight')::numeric,0) else 1::numeric end native_weight,
    x.tcg_low,x.direct_net,x.tcg_regular_net,x.ck_cash,x.manapool_net,
    p.direct_low_price direct_gross,p.low_price regular_gross,
    case when x.manapool_net is null then null else x.manapool_net/.975 end manapool_gross,
    x.price_observed_on,v.observed_on vendor_observed_on
  from public.sealed_ev_backtest_pool_items i
  join public.sealed_ev_pool_executable_values x on x.pool_item_id=i.pool_item_id
  left join lateral (
    select pc.direct_low_price,pc.low_price
    from public.tcgplayer_preferred_price_current_cache pc
    where i.tcgplayer_product_id ~ '^[0-9]+$'
      and pc.product_id=i.tcgplayer_product_id::bigint and pc.finish=i.finish
    order by pc.observed_on desc limit 1
  ) p on true
  left join lateral (
    select c.uuid from public.mtgjson_cards c
    where c.tcgplayer_product_id=i.tcgplayer_product_id
      and upper(c.set_code)=upper(i.set_code) and c.collector_number=i.collector_number
    order by c.uuid limit 1
  ) mc on true
  left join public.scout_vendor_price_current_cache v
    on v.mtgjson_uuid=mc.uuid and v.finish=i.finish
), random_pool_totals as (
  select backtest_id,pool_key,finish,sum(native_weight) pool_weight
  from random_pool_items
  group by backtest_id,pool_key,finish
), random_items as (
  select l.user_id,l.sealed_uuid source_uuid,i.pool_item_id,
    s.draws_per_booster*s.probability*coalesce(l.booster_count,1)
      *i.native_weight/nullif(t.pool_weight,0) expected_quantity,
    i.tcg_low,i.direct_gross,i.direct_net,i.regular_gross,i.tcg_regular_net,
    i.ck_cash,i.manapool_gross,i.manapool_net,i.price_observed_on,i.vendor_observed_on
  from latest l
  join public.sealed_ev_backtest_slots s on s.backtest_id=l.backtest_id
  join random_pool_items i
    on i.backtest_id=s.backtest_id and i.pool_key=s.pool_key and i.finish=s.finish
  join random_pool_totals t
    on t.backtest_id=s.backtest_id and t.pool_key=s.pool_key and t.finish=s.finish
), fixed_items as (
  select u.user_id,fc.sealed_uuid source_uuid,fc.component_id::text atomic_key,
    fc.quantity::numeric expected_quantity,
    coalesce(p.low_price,0)::numeric tcg_low,p.direct_low_price direct_gross,
    public.collectish_direct_net(p.direct_low_price) direct_net,p.low_price regular_gross,
    public.collectish_tcg_regular_net(p.low_price) tcg_regular_net,
    coalesce(v.cardkingdom_buylist,0)::numeric ck_cash,v.manapool_retail manapool_gross,
    case when v.manapool_retail is null then null else v.manapool_retail*.975 end manapool_net,
    p.observed_on price_observed_on,v.observed_on vendor_observed_on
  from (select distinct user_id from public.sealed_set_profiles where enabled) u
  cross join public.sealed_product_fixed_card_components fc
  left join lateral (
    select x.low_price,x.direct_low_price,x.observed_on
    from public.tcgplayer_preferred_price_current_cache x
    where x.uuid=fc.card_uuid and x.finish=fc.finish
    order by x.observed_on desc limit 1
  ) p on true
  left join public.scout_vendor_price_current_cache v
    on v.mtgjson_uuid=fc.card_uuid and v.finish=fc.finish
  where not exists (
    select 1 from latest l where l.user_id=u.user_id and l.sealed_uuid=fc.sealed_uuid
  )
), raw_atomic as (
  select r.user_id,r.source_uuid,r.pool_item_id::text atomic_key,
    r.expected_quantity,
    r.tcg_low,r.direct_gross,r.direct_net,r.regular_gross,r.tcg_regular_net,
    r.ck_cash,r.manapool_gross,r.manapool_net,r.price_observed_on,r.vendor_observed_on
  from random_items r
  union all
  select * from fixed_items
), candidates as (
  select a.*,
    case when coalesce(a.direct_net,0)*.85>=.50 then a.direct_net*.85 else 0 end practical_direct,
    case when coalesce(a.tcg_regular_net,0)*.75>=.50 then a.tcg_regular_net*.75 else 0 end practical_regular,
    case when coalesce(a.manapool_net,0)*.65>=1 then a.manapool_net*.65 else 0 end practical_manapool
  from raw_atomic a
), routed as (
  select c.*,
    greatest(coalesce(c.ck_cash,0),coalesce(c.direct_net,0),coalesce(c.tcg_regular_net,0),coalesce(c.manapool_net,0)) optimistic_unit,
    greatest(coalesce(c.ck_cash,0),c.practical_direct,c.practical_regular,c.practical_manapool) practical_unit,
    case greatest(coalesce(c.ck_cash,0),c.practical_direct,c.practical_regular,c.practical_manapool)
      when coalesce(c.ck_cash,0) then case when coalesce(c.ck_cash,0)>0 then 'Card Kingdom' else 'Excluded / $0' end
      when c.practical_direct then 'TCG Direct'
      when c.practical_regular then 'TCG Regular'
      else 'ManaPool' end practical_channel
  from candidates c
), atomic as (
  select r.*,
    case r.practical_channel when 'TCG Direct' then r.direct_gross
      when 'TCG Regular' then r.regular_gross when 'Card Kingdom' then r.ck_cash
      when 'ManaPool' then r.manapool_gross else 0 end practical_route_gross,
    case r.practical_channel when 'TCG Direct' then r.direct_net
      when 'TCG Regular' then r.tcg_regular_net when 'Card Kingdom' then r.ck_cash
      when 'ManaPool' then r.manapool_net else 0 end practical_route_net,
    case when r.practical_channel in ('Card Kingdom','ManaPool') then r.vendor_observed_on
      else r.price_observed_on end route_observed_on
  from routed r
), ancestry(user_id,source_uuid,target_uuid,factor,depth,path) as (
  select distinct a.user_id,a.source_uuid,a.source_uuid,1::numeric,0,array[a.source_uuid]::uuid[]
  from atomic a
  union all
  select x.user_id,x.source_uuid,c.parent_sealed_uuid,x.factor*c.quantity,x.depth+1,
    x.path||c.parent_sealed_uuid
  from ancestry x
  join public.sealed_product_child_components c on c.child_sealed_uuid=x.target_uuid
  where x.depth<5 and not c.parent_sealed_uuid=any(x.path)
    and (x.target_uuid=x.source_uuid or not exists (
      select 1 from latest modeled_ancestor
      where modeled_ancestor.user_id=x.user_id
        and modeled_ancestor.sealed_uuid=x.target_uuid
    ))
), expanded as (
  select n.target_uuid sealed_uuid,a.*,a.expected_quantity*n.factor product_quantity
  from ancestry n join atomic a on a.user_id=n.user_id and a.source_uuid=n.source_uuid
), scoped as (
  select e.* from expanded e
  left join public.sealed_collation_binding_resolved b on b.sealed_uuid=e.sealed_uuid
  left join latest target_model
    on target_model.user_id=e.user_id and target_model.sealed_uuid=e.sealed_uuid
  where (target_model.backtest_id is not null and e.source_uuid=e.sealed_uuid)
     or (target_model.backtest_id is null and (
       coalesce(b.profile_status,'') in ('full','deterministic') or e.source_uuid=e.sealed_uuid
     ))
), route_counts as (
  select user_id,sealed_uuid,practical_channel,round(sum(product_quantity),2) route_units
  from scoped group by user_id,sealed_uuid,practical_channel
), route_json as (
  select user_id,sealed_uuid,jsonb_object_agg(practical_channel,route_units) practical_route_units
  from route_counts group by user_id,sealed_uuid
), summary as (
  select e.user_id,e.sealed_uuid,
    round(sum(e.product_quantity*coalesce(e.ck_cash,0)),4) cash_floor_ev,
    round(sum(e.product_quantity*e.practical_unit),4) practical_ev,
    round(sum(e.product_quantity*e.optimistic_unit),4) optimistic_ev,
    round(sum(e.product_quantity),2) expected_card_units,
    round(sum(e.product_quantity) filter(where e.tcg_low>0),2) tcg_priced_units,
    round(coalesce(sum(e.product_quantity) filter(where e.practical_unit=0),0),2) excluded_zero_value_units,
    round(coalesce(sum(e.product_quantity) filter(where e.route_observed_on is null or e.route_observed_on<current_date-3),0),2) stale_route_units,
    round(sum(e.product_quantity*greatest(coalesce(e.practical_route_gross,0)-coalesce(e.practical_route_net,0),0)),4) marketplace_fee_deduction,
    round(sum(e.product_quantity*greatest(coalesce(e.practical_route_net,0)-e.practical_unit,0)),4) liquidity_labor_deduction
  from scoped e
  group by e.user_id,e.sealed_uuid
)
select s.user_id,s.sealed_uuid,s.cash_floor_ev,s.practical_ev,s.optimistic_ev,
  jsonb_build_object(
    'version','sealed-ev-audit-v1',
    'cash_floor_policy','Card Kingdom cash buylist only; unavailable cards count as $0',
    'practical_policy','Best current executable channel after fees, liquidity and labor haircuts',
    'optimistic_policy','Best current executable channel after marketplace fees, before liquidity/labor haircuts',
    'expected_card_units',s.expected_card_units,
    'tcg_priced_units',s.tcg_priced_units,
    'tcg_price_coverage_pct',round(100*s.tcg_priced_units/nullif(s.expected_card_units,0),2),
    'excluded_zero_value_units',s.excluded_zero_value_units,
    'stale_route_units',s.stale_route_units,
    'stale_after_days',3,
    'practical_route_units',coalesce(r.practical_route_units,'{}'::jsonb),
    'marketplace_fee_deduction',s.marketplace_fee_deduction,
    'liquidity_labor_deduction',s.liquidity_labor_deduction,
    'optimistic_to_practical_deduction',round(s.optimistic_ev-s.practical_ev,4),
    'market_price_used',false,
    'syp_or_last_known_direct_used',false
  ) ev_audit
from summary s left join route_json r using(user_id,sealed_uuid);

grant select on public.sealed_product_ev_audit_current to authenticated,service_role;

alter table public.sealed_product_executable_ev_cache
  add column if not exists cash_floor_ev numeric,
  add column if not exists optimistic_ev numeric,
  add column if not exists ev_audit jsonb;

create or replace function public.refresh_sealed_product_executable_ev_cache()
returns integer language plpgsql security definer set search_path=public set statement_timeout='180s' as $$
declare n integer;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'service_role required';
  end if;
  truncate table public.sealed_product_executable_ev_cache;
  insert into public.sealed_product_executable_ev_cache(
    user_id,sealed_uuid,tcg_low_ev,direct_first_net_ev,collectish_live_out_ev,
    fixed_tcg_low_ev,fixed_collectish_live_out_ev,modeled_child_units,
    price_coverage_pct,valuation_basis,model_key,model_version,valuation_as_of,
    practical_liquidation_ev,practical_median_estimate,practical_p10_estimate,
    top10_practical_ev_share_pct,top1_practical_ev_share_pct,practical_scout_score,
    practical_scout_grade,practical_action,practical_model_version,distribution_estimate_basis,
    cash_floor_ev,optimistic_ev,ev_audit,refreshed_at)
  select p.user_id,p.sealed_uuid,p.tcg_low_ev,p.direct_first_net_ev,p.collectish_live_out_ev,
    p.fixed_tcg_low_ev,p.fixed_collectish_live_out_ev,p.modeled_child_units,
    p.price_coverage_pct,p.valuation_basis,p.model_key,p.model_version,p.valuation_as_of,
    v.practical_ev,v.median_ev,v.p10_ev,
    p.top10_practical_ev_share_pct,p.top1_practical_ev_share_pct,s.scout_score,
    case when s.scout_score>=90 then 'A' when s.scout_score>=80 then 'B'
      when s.scout_score>=70 then 'C' when s.scout_score>=60 then 'D'
      when s.scout_score is not null then 'F' end,
    case when not coalesce(p.recommendation_eligible,false) then 'MODEL PENDING'
      when p.price_coverage_pct<90 then 'PRICE COVERAGE LOW'
      when coalesce(p.top10_practical_ev_share_pct,0)>70 and p.coverage_state='DETERMINISTIC' then 'VALUE CONCENTRATED'
      when coalesce(p.top10_practical_ev_share_pct,0)>70 then 'CHASE DEPENDENT'
      when v.practical_ev>=p.sealed_low_price*1.15 and coalesce(v.median_ev,v.practical_ev)>=p.sealed_low_price*.75 then 'BUY & CRACK'
      when v.practical_ev>=p.sealed_low_price then 'MARGINAL CRACK'
      else 'KEEP SEALED' end,
    p.practical_model_version,p.distribution_estimate_basis,
    a.cash_floor_ev,a.optimistic_ev,a.ev_audit,now()
  from public.sealed_product_practical_ev_current p
  left join public.sealed_product_ev_audit_current a
    on a.user_id=p.user_id and a.sealed_uuid=p.sealed_uuid
  cross join lateral (
    select coalesce(a.practical_ev,p.randomized_practical_ev) practical_ev,
      case when p.coverage_state='DETERMINISTIC' then coalesce(a.practical_ev,p.practical_median_estimate)
        when p.randomized_practical_ev>0 then p.practical_median_estimate*a.practical_ev/p.randomized_practical_ev
        else p.practical_median_estimate end median_ev,
      case when p.coverage_state='DETERMINISTIC' then coalesce(a.practical_ev,p.practical_p10_estimate)
        when p.randomized_practical_ev>0 then p.practical_p10_estimate*a.practical_ev/p.randomized_practical_ev
        else p.practical_p10_estimate end p10_ev
  ) v
  cross join lateral (
    select case when not coalesce(p.recommendation_eligible,false) then null else round(greatest(0,least(100,50
      +greatest(-30,least(30,100*(v.practical_ev/nullif(p.sealed_low_price,0)-1)))
      -case when p.price_coverage_pct>=98 then 0 when p.price_coverage_pct>=90 then 8 else 25 end
      -case when coalesce(p.top10_practical_ev_share_pct,0)<=45 then 0 when p.top10_practical_ev_share_pct<=65 then 8 else 18 end
      -case when v.median_ev is not null and p.sealed_low_price>0 and v.median_ev<p.sealed_low_price*.60 then 10 else 0 end
    )),1) end scout_score
  ) s;
  get diagnostics n=row_count;
  analyze public.sealed_product_executable_ev_cache;
  return n;
end $$;

revoke all on function public.refresh_sealed_product_executable_ev_cache() from public,anon,authenticated;
grant execute on function public.refresh_sealed_product_executable_ev_cache() to service_role;

notify pgrst,'reload schema';
