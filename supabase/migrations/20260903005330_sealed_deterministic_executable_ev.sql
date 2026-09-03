-- Hydrate exact MTGJSON decklists into the executable sealed-card pipeline.
-- TCG Market remains reference-only; practical value uses executable exits.

insert into public.sealed_product_fixed_card_components
  (sealed_uuid,card_uuid,finish,quantity,component_type,provenance,notes)
select p.uuid,dc.card_uuid,dc.finish,dc.quantity,'deck_card',
       'mtgjson-deck-v1','Exact published SOC Commander deck contents'
from public.mtgjson_sealed_products p
join public.mtgjson_decks d
  on coalesce(d.sealed_product_uuids,'[]'::jsonb) ? p.uuid::text
join public.mtgjson_deck_cards dc on dc.deck_key=d.deck_key
where upper(p.set_code)='SOC' and d.deck_type<>'Bundle Land Pack'
on conflict(sealed_uuid,card_uuid,finish,component_type)
do update set quantity=excluded.quantity,provenance=excluded.provenance,notes=excluded.notes;

create or replace view public.sealed_fixed_practical_ev
with (security_invoker=true) as
with valued as (
 select fc.sealed_uuid,fc.card_uuid,fc.finish,fc.quantity,
   greatest(
     coalesce(v.cardkingdom_buylist,0),
     case when coalesce(public.collectish_direct_net(p.direct_low_price),0)*.85>=.50
       then public.collectish_direct_net(p.direct_low_price)*.85 else 0 end,
     case when coalesce(public.collectish_tcg_regular_net(p.low_price),0)*.75>=.50
       then public.collectish_tcg_regular_net(p.low_price)*.75 else 0 end,
     case when coalesce(v.manapool_retail,0)*.975*.65>=1
       then v.manapool_retail*.975*.65 else 0 end
   )::numeric*fc.quantity contribution
 from public.sealed_product_fixed_card_components fc
 left join lateral (
   select x.low_price,x.direct_low_price
   from public.tcgplayer_preferred_price_current_cache x
   where x.uuid=fc.card_uuid and x.finish=fc.finish
   order by x.observed_on desc limit 1
 ) p on true
 left join public.scout_vendor_price_current_cache v
   on v.mtgjson_uuid=fc.card_uuid and v.finish=fc.finish
), ranked as (
 select x.*,row_number() over(partition by sealed_uuid order by contribution desc) rn
 from valued x
)
select sealed_uuid,round(sum(contribution),4) practical_liquidation_ev,
 round(100*sum(contribution) filter(where rn<=10)/nullif(sum(contribution),0),2)
   top10_practical_ev_share_pct,
 round(100*max(contribution)/nullif(sum(contribution),0),2)
   top1_practical_ev_share_pct
from ranked group by sealed_uuid;

create or replace view public.sealed_product_executable_ev_current
with (security_invoker=true) as
with users as (select distinct user_id from public.sealed_set_profiles where enabled),
base_keys as (
 select user_id,sealed_uuid from public.sealed_ev_channel_current
 union select u.user_id,f.sealed_uuid from users u cross join public.sealed_fixed_executable_ev f
), base as (
 select k.user_id,k.sealed_uuid,
   coalesce(e.tcg_low_ev,0)+case when e.sealed_uuid is null then coalesce(f.fixed_tcg_low_ev,0) else 0 end tcg_low_ev,
   coalesce(e.direct_first_net_ev,0)+case when e.sealed_uuid is null then coalesce(f.fixed_direct_first_net_ev,0) else 0 end direct_first_net_ev,
   coalesce(e.collectish_live_out_ev,0)+case when e.sealed_uuid is null then coalesce(f.fixed_collectish_live_out_ev,0) else 0 end collectish_live_out_ev,
   coalesce(f.fixed_tcg_low_ev,0) fixed_tcg_low_ev,
   coalesce(f.fixed_collectish_live_out_ev,0) fixed_collectish_live_out_ev,
   coalesce(e.price_coverage_pct,100) price_coverage_pct,
   e.model_key,e.model_version,e.valuation_as_of,
   case when e.sealed_uuid is not null then 'randomized_current_only'
        else 'fixed_current_only' end valuation_basis
 from base_keys k
 left join public.sealed_ev_channel_current e
   on e.user_id=k.user_id and e.sealed_uuid=k.sealed_uuid
 left join public.sealed_fixed_executable_ev f on f.sealed_uuid=k.sealed_uuid
), children as (
 select u.user_id,c.parent_sealed_uuid,
   sum(c.quantity*b.tcg_low_ev) child_tcg_low_ev,
   sum(c.quantity*b.direct_first_net_ev) child_direct_first_net_ev,
   sum(c.quantity*b.collectish_live_out_ev) child_collectish_live_out_ev,
   sum(c.quantity) filter(where b.sealed_uuid is not null) modeled_child_units,
   min(b.price_coverage_pct) child_price_coverage_pct
 from users u cross join public.sealed_product_child_components c
 left join base b on b.user_id=u.user_id and b.sealed_uuid=c.child_sealed_uuid
 group by u.user_id,c.parent_sealed_uuid
), keys as (
 select user_id,sealed_uuid from base
 union select user_id,parent_sealed_uuid from children
)
select k.user_id,k.sealed_uuid,
 coalesce(b.tcg_low_ev,0)+coalesce(ch.child_tcg_low_ev,0) tcg_low_ev,
 coalesce(b.direct_first_net_ev,0)+coalesce(ch.child_direct_first_net_ev,0) direct_first_net_ev,
 coalesce(b.collectish_live_out_ev,0)+coalesce(ch.child_collectish_live_out_ev,0) collectish_live_out_ev,
 coalesce(b.fixed_tcg_low_ev,0) fixed_tcg_low_ev,
 coalesce(b.fixed_collectish_live_out_ev,0) fixed_collectish_live_out_ev,
 coalesce(ch.modeled_child_units,0) modeled_child_units,
 least(coalesce(b.price_coverage_pct,100),coalesce(ch.child_price_coverage_pct,100)) price_coverage_pct,
 case when ch.parent_sealed_uuid is not null and b.sealed_uuid is not null then 'children_plus_fixed_current_only'
      when ch.parent_sealed_uuid is not null then 'children_current_only'
      else b.valuation_basis end valuation_basis,
 b.model_key,b.model_version,b.valuation_as_of
from keys k
left join base b on b.user_id=k.user_id and b.sealed_uuid=k.sealed_uuid
left join children ch on ch.user_id=k.user_id and ch.parent_sealed_uuid=k.sealed_uuid;

create or replace view public.sealed_product_practical_ev_current
with (security_invoker=true) as
with exec as materialized (select * from public.sealed_product_executable_ev_current),
practical as materialized (select * from public.sealed_ev_practical_channel_current),
fixed_practical as materialized (select * from public.sealed_fixed_practical_ev),
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
   case when p.practical_liquidation_ev is not null then p.practical_liquidation_ev
        when cp.parent_sealed_uuid is not null then cp.child_practical_ev+coalesce(ownfp.practical_liquidation_ev,0)
        when fp.practical_liquidation_ev is not null then fp.practical_liquidation_ev
        else e.collectish_live_out_ev end randomized_practical_ev,
   coalesce(p.top10_practical_ev_share_pct,cp.child_top10_share_pct,fp.top10_practical_ev_share_pct) top10_practical_ev_share_pct,
   coalesce(p.top1_practical_ev_share_pct,cp.child_top1_share_pct,fp.top1_practical_ev_share_pct) top1_practical_ev_share_pct,
   s.sealed_acquisition_price sealed_low_price,
   (coalesce(bind.profile_status,'') in ('full','deterministic')) recommendation_eligible,
   case when bind.profile_status='full' then 'FULL MODEL' when bind.profile_status='deterministic' then 'DETERMINISTIC' else 'UNMODELED' end coverage_state,
   coalesce(bt.gross_mean_ev,e.tcg_low_ev) crack_gross_mean_ev,
   coalesce(bt.gross_median_ev,case when cp.parent_sealed_uuid is not null then cp.child_median_estimate+coalesce(ownfp.practical_liquidation_ev,0) when fp.sealed_uuid is not null then e.tcg_low_ev end) crack_gross_median_ev,
   coalesce(bt.p10_ev,case when cp.parent_sealed_uuid is not null then cp.child_p10_estimate+coalesce(ownfp.practical_liquidation_ev,0) when fp.sealed_uuid is not null then e.tcg_low_ev end) crack_p10_ev
 from exec e
 left join practical p on p.user_id=e.user_id and p.sealed_uuid=e.sealed_uuid
 left join fixed_practical fp on fp.sealed_uuid=e.sealed_uuid
 left join child_practical cp on cp.user_id=e.user_id and cp.parent_sealed_uuid=e.sealed_uuid
 left join fixed_practical ownfp on ownfp.sealed_uuid=e.sealed_uuid
 left join public.sealed_ev_current s on s.user_id=e.user_id and s.sealed_uuid=e.sealed_uuid
 left join latest_bt bt on bt.user_id=e.user_id and bt.sealed_uuid=e.sealed_uuid
 left join public.sealed_collation_binding_resolved bind on bind.sealed_uuid=e.sealed_uuid
), calculated as (
 select b.*,
   case when b.crack_gross_mean_ev>0 then round(b.crack_gross_median_ev/b.crack_gross_mean_ev*b.randomized_practical_ev,4) end practical_median_estimate,
   case when b.crack_gross_mean_ev>0 then round(b.crack_p10_ev/b.crack_gross_mean_ev*b.randomized_practical_ev,4) end practical_p10_estimate
 from base b
), scored as (
 select c.*,round(greatest(0,least(100,50
   +greatest(-30,least(30,100*(c.randomized_practical_ev/nullif(c.sealed_low_price,0)-1)))
   -case when c.price_coverage_pct>=98 then 0 when c.price_coverage_pct>=90 then 8 else 25 end
   -case when coalesce(c.top10_practical_ev_share_pct,0)<=45 then 0 when c.top10_practical_ev_share_pct<=65 then 8 else 18 end
   -case when c.practical_median_estimate is not null and c.sealed_low_price>0 and c.practical_median_estimate<c.sealed_low_price*.60 then 10 else 0 end
 )),1) practical_scout_score from calculated c
)
select s.*,
 case when not coalesce(s.recommendation_eligible,false) then 'MODEL PENDING'
      when s.price_coverage_pct<90 then 'PRICE COVERAGE LOW'
      when coalesce(s.top10_practical_ev_share_pct,0)>70 and s.coverage_state='DETERMINISTIC' then 'VALUE CONCENTRATED'
      when coalesce(s.top10_practical_ev_share_pct,0)>70 then 'CHASE DEPENDENT'
      when s.randomized_practical_ev>=s.sealed_low_price*1.15 and coalesce(s.practical_median_estimate,s.randomized_practical_ev)>=s.sealed_low_price*.75 then 'BUY & CRACK'
      when s.randomized_practical_ev>=s.sealed_low_price then 'MARGINAL CRACK'
      else 'KEEP SEALED' end practical_action,
 case when s.practical_scout_score>=90 then 'A' when s.practical_scout_score>=80 then 'B'
      when s.practical_scout_score>=70 then 'C' when s.practical_scout_score>=60 then 'D' else 'F' end practical_scout_grade,
 'channel_liquidity_and_labor_v1'::text practical_model_version,
 'Deterministic contents use exact executable card values; randomized products preserve simulated distribution shape.'::text distribution_estimate_basis
from scored s;

insert into public.sealed_collation_profile_bindings
 (set_code,sealed_uuid,adapter_key,model_version,profile_status,source_type,source_ref,assumptions,priority,enabled)
select 'SOC',p.uuid,'sealed_container_rollup_v1','mtgjson-deck-container-v1','deterministic','mtgjson',
 'SOC exact five-deck container',jsonb_build_object('exact_child_decks',5),500,true
from public.mtgjson_sealed_products p
where upper(p.set_code)='SOC' and p.name='Secrets of Strixhaven Commander Deck Set of 5'
and not exists(select 1 from public.sealed_collation_profile_bindings b where b.sealed_uuid=p.uuid and b.priority=500);

grant select on public.sealed_fixed_practical_ev to authenticated,service_role;
notify pgrst,'reload schema';
