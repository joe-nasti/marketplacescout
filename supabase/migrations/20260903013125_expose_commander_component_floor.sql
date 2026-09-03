-- Preserve useful exact-card value without treating an unmodeled sample pack as complete.
-- Component-only products expose a conservative known-card practical floor, but
-- receive no score, grade, spread distribution, or crack recommendation.

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
        when fcp.practical_liquidation_ev is not null then fcp.practical_liquidation_ev+coalesce(ownfp.practical_liquidation_ev,0)
        when cp.parent_sealed_uuid is not null then cp.child_practical_ev+coalesce(ownfp.practical_liquidation_ev,0)
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

notify pgrst,'reload schema';
