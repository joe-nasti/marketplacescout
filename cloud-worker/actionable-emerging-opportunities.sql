create or replace function public.actionable_emerging_opportunities(p_limit integer default 80)
returns table(
  card_name text, product_id text, sku_id text, set_name text, printing text,
  base_scout_score integer, adjusted_scout_score integer,
  liquidity_score integer, liquidity_label text,
  target_roi_pct numeric, direct_roi_pct numeric, margin_cushion_pct numeric,
  cheapest_buy numeric, direct_net_est numeric, direct_net_profit numeric,
  direct_low numeric, market_price numeric, direct_available integer,
  signal_families integer, signal_count integer, signal_labels text,
  primary_signal text, signal_strength integer,
  actionability_score integer, action_class text, action_reason text
)
language sql
security invoker
set search_path=public
as $function$
with liquid as (
  select l.*,c.edhrec_rank,c.product_name
  from public.liquid_scout_opportunities(250) l
  join public.scout_opportunities_v5_cache c
    on c.user_id=auth.uid() and c.sku_id=l.sku_id
), comp as (
  select lower(card_name) k, product_id, sku_id,
         '60-card competitive'::text family,
         case watch_class when 'adoption_breakout' then 'Competitive breakout'
                          when 'standard_watch' then 'Standard watch'
                          else 'Recent competitive card' end label,
         case watch_class when 'adoption_breakout' then 100 when 'standard_watch' then 86 else 72 end::int strength,
         watch_reason reason
  from public.competitive_financial_opportunities(null)
  where watch_class in ('adoption_breakout','standard_watch','recent_card')
), cedh as (
  select lower(card_name) k, product_id, sku_id,
         'cEDH'::text family,
         case watch_class when 'cedh_breakout' then 'cEDH breakout' else 'New / recent cEDH card' end label,
         case watch_class when 'cedh_breakout' then 96 else 76 end::int strength,
         case watch_class when 'cedh_breakout' then 'cEDH card adoption is increasing across imported structured tournament lists.'
                          else 'A relatively new card is already seeing meaningful cEDH tournament adoption.' end reason
  from public.cedh_card_opportunities(90)
  where watch_class in ('cedh_breakout','cedh_recent_card')
), edh as (
  select lower(l.card_name) k,l.product_id,l.sku_id,
         'EDHREC'::text family,'EDH breakout'::text label,
         least(100,greatest(0,70+round(((b.edhrec_rank-l.edhrec_rank)::numeric/nullif(b.edhrec_rank,0)*100)/4.0)))::int strength,
         'EDHREC rank improved materially across the available history while this liquid Scout printing remains actionable.'::text reason
  from liquid l
  join lateral (
    select r.edhrec_rank,r.edhrec_observed_at
    from public.marketplace_scan_rows r
    where r.user_id=auth.uid()
      and r.product_name=l.product_name
      and r.edhrec_observed_at is not null
      and r.edhrec_rank is not null
      and r.edhrec_observed_at>=now()-interval '8 days'
    order by r.edhrec_observed_at asc,r.id asc
    limit 1
  ) b on true
  where l.edhrec_rank is not null and l.edhrec_rank<=10000
    and b.edhrec_rank>0
    and b.edhrec_observed_at<=now()-interval '3 days'
    and ((b.edhrec_rank-l.edhrec_rank)::numeric/b.edhrec_rank*100)>=20
), intel as (
  select lower(e.entity_name) k,e.product_id,null::text sku_id,
         'articles/social'::text family,
         case max(case i.signal_stage when 'leading' then 3 when 'confirming' then 2 else 0 end)
           when 3 then 'Leading article/social signal' else 'Confirming article/social signal' end label,
         least(100,greatest(0,round(55+max(coalesce(i.confidence,0.5))*35+
           case max(case i.signal_stage when 'leading' then 3 when 'confirming' then 2 else 0 end) when 3 then 10 else 0 end)))::int strength,
         'Recent bullish article/social intelligence is attached to this card.'::text reason
  from public.market_intel_entities e
  join public.market_intel_items i on i.intel_id=e.intel_id and i.user_id=e.user_id
  where e.user_id=auth.uid()
    and e.entity_type in ('card','other')
    and coalesce(i.direction,'neutral')='bullish'
    and i.signal_stage in ('leading','confirming')
    and i.observed_at>=now()-interval '30 days'
  group by lower(e.entity_name),e.product_id
), signals as (
  select * from comp union all select * from edh union all select * from cedh union all select * from intel
), matched as (
  select l.*,s.family,s.label,s.strength,s.reason,
         row_number() over(partition by l.sku_id,s.family order by s.strength desc) family_rn
  from liquid l
  join signals s on (s.product_id is not null and s.product_id=l.product_id)
                  or (s.product_id is null and s.k=lower(l.card_name))
), agg as (
  select sku_id,
         count(*) filter(where family_rn=1)::int signal_families,
         count(*)::int signal_count,
         string_agg(label,' · ' order by strength desc) filter(where family_rn=1) signal_labels,
         (array_agg(label order by strength desc))[1] primary_signal,
         max(strength)::int signal_strength,
         (array_agg(reason order by strength desc))[1] primary_reason
  from matched
  group by sku_id
), final as (
  select l.*,a.signal_families,a.signal_count,a.signal_labels,a.primary_signal,a.signal_strength,a.primary_reason,
         least(100,round(
           l.adjusted_scout_score*0.55+
           a.signal_strength*0.25+
           least(10,a.signal_families*4)+
           least(10,greatest(0,l.margin_cushion_pct)/10)
         ))::int actionability,
         case
           when a.signal_families>=2 and l.quick_turn_class='priority_quick_turn' then 'action_now'
           when a.signal_strength>=90 and l.quick_turn_class='priority_quick_turn' then 'action_now'
           when l.quick_turn_class in ('priority_quick_turn','quick_turn') then 'emerging_quick_turn'
           else 'liquid_signal_watch'
         end action_class_calc
  from liquid l join agg a on a.sku_id=l.sku_id
)
select card_name,product_id,sku_id,set_name,printing,base_scout_score,adjusted_scout_score,
       liquidity_score,liquidity_label,target_roi_pct,direct_roi_pct,margin_cushion_pct,
       cheapest_buy,direct_net_est,direct_net_profit,direct_low,market_price,direct_available,
       signal_families,signal_count,signal_labels,primary_signal,signal_strength,actionability,
       action_class_calc,
       case action_class_calc
         when 'action_now' then primary_reason||' The selected printing is liquid and its estimated Direct ROI clears the velocity-adjusted target with room to spare.'
         when 'emerging_quick_turn' then primary_reason||' The trade currently clears its liquidity-adjusted margin hurdle.'
         else primary_reason||' Liquidity is favorable, but the execution setup is less compelling than the top quick-turn candidates.' end
from final
order by case action_class_calc when 'action_now' then 0 when 'emerging_quick_turn' then 1 else 2 end,
         actionability desc,signal_families desc,margin_cushion_pct desc
limit greatest(1,least(coalesce(p_limit,80),200));
$function$;

revoke all on function public.actionable_emerging_opportunities(integer) from public,anon;
grant execute on function public.actionable_emerging_opportunities(integer) to authenticated;
