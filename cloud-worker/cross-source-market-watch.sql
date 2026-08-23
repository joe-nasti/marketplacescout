-- MarketplaceScout cross-source corroboration RPC.
-- Production is applied through Supabase migrations; this file is the checked-in canonical definition.
-- 60-card competitive explicitly excludes cEDH so cEDH is not double-counted.

create or replace function public.cross_source_market_watches(p_limit integer default 60)
returns table(
  card_name text, product_id text, sku_id text, set_name text, printing text,
  market_price numeric, direct_low numeric, direct_available integer, opportunity_score integer,
  evidence_sources integer, dynamic_sources integer,
  competitive_formats text, competitive_decks bigint, competitive_top8 bigint, competitive_stage text,
  edhrec_rank integer, edh_watch_class text, edh_rank_improvement_pct numeric,
  cedh_decks bigint, cedh_share_pct numeric, cedh_watch_class text,
  intel_items bigint, intel_sources bigint, intel_stage text,
  corroboration_score integer, watch_class text, watch_reason text
)
language sql
security invoker
set search_path=public
as $function$
with comp_raw as (
  select * from public.competitive_scout_opportunities(null)
  where lower(coalesce(format,'')) <> 'cedh'
), comp as (
  select lower(card_name) k, min(card_name) card_name,
         string_agg(distinct format, ', ' order by format) formats,
         sum(deck_count_30d)::bigint decks,
         sum(top8_decks_30d)::bigint top8s,
         max(case competitive_stage when 'early' then 3 when 'confirming' then 2 when 'late' then 1 else 0 end) stage_rank
  from comp_raw where deck_count_30d>0 group by lower(card_name)
), edh_raw as (
  select * from public.commander_edh_opportunities(200)
), edh as (
  select distinct on (lower(card_name)) lower(card_name) k, card_name, edhrec_rank, watch_class,
         rank_improvement_pct, commander_priority
  from edh_raw order by lower(card_name), commander_priority desc nulls last
), cedh_raw as (
  select * from public.cedh_card_opportunities(90)
), cedh as (
  select distinct on (lower(card_name)) lower(card_name) k, card_name, deck_count_30d, share_30d_pct,
         watch_class, cedh_card_priority
  from cedh_raw order by lower(card_name), cedh_card_priority desc nulls last
), intel as (
  select lower(e.entity_name) k, min(e.entity_name) card_name,
         count(distinct i.intel_id)::bigint intel_items,
         count(distinct coalesce(nullif(i.source_name,''),i.source_type))::bigint intel_sources,
         max(case i.signal_stage when 'leading' then 3 when 'confirming' then 2 when 'lagging' then 1 else 0 end) stage_rank
  from public.market_intel_entities e
  join public.market_intel_items i on i.intel_id=e.intel_id and i.user_id=e.user_id
  where e.user_id=auth.uid() and e.entity_type in ('card','other')
    and coalesce(i.direction,'neutral')='bullish' and i.observed_at>=now()-interval '90 days'
  group by lower(e.entity_name)
), keys as (
  select k from comp union select k from edh union select k from cedh union select k from intel
), evidence as (
  select k.k, coalesce(c.card_name,e.card_name,cd.card_name,i.card_name) card_name,
         c.formats,c.decks competitive_decks,c.top8s competitive_top8,c.stage_rank comp_stage_rank,
         e.edhrec_rank,e.watch_class edh_watch_class,e.rank_improvement_pct,
         cd.deck_count_30d cedh_decks,cd.share_30d_pct cedh_share_pct,cd.watch_class cedh_watch_class,
         i.intel_items,i.intel_sources,i.stage_rank intel_stage_rank,
         ((c.k is not null)::int + (e.k is not null)::int + (cd.k is not null)::int + (i.k is not null)::int)::int evidence_sources,
         ((coalesce(c.stage_rank,0)>=2)::int + (e.watch_class='edh_breakout')::int + (cd.watch_class in ('cedh_breakout','cedh_recent_card'))::int + (coalesce(i.stage_rank,0)>=2)::int)::int dynamic_sources
  from keys k left join comp c on c.k=k.k left join edh e on e.k=k.k left join cedh cd on cd.k=k.k left join intel i on i.k=k.k
), market as (
  select ev.*, s.product_id,s.sku_id,s.set_name,s.printing,s.sku_market_price,s.direct_low,s.direct_available,s.opportunity_score,
         row_number() over(partition by ev.k order by
           case when lower(coalesce(s.condition,''))='near mint' then 0 else 1 end,
           case when lower(coalesce(s.language,''))='english' then 0 else 1 end,
           case when lower(coalesce(s.printing,''))='normal' then 0 else 1 end,
           s.opportunity_score desc nulls last, s.direct_available asc nulls last) rn
  from evidence ev join public.scout_opportunities_v5_cache s on s.user_id=auth.uid() and lower(s.product_name)=ev.k
), chosen as (
  select * from market where rn=1
), scored as (
  select *, least(100,greatest(0,round(
      evidence_sources*18 + dynamic_sources*7 + coalesce(opportunity_score,0)*0.20
      + case when direct_available<=5 then 10 when direct_available<=20 then 6 when direct_available<=50 then 3 else 0 end
      + case when direct_low>0 and sku_market_price>0 and direct_low>=sku_market_price*1.20 then 5 else 0 end
      + least(5,coalesce(intel_sources,0))
    )))::integer corroboration_score
  from chosen where evidence_sources>=2
), final as (
  select *, case
      when evidence_sources>=3 and dynamic_sources>=2 then 'cross_source_breakout'
      when evidence_sources>=3 then 'high_conviction_watch'
      when dynamic_sources>=2 then 'corroborated_breakout'
      else 'corroborated_setup' end watch_class,
    concat_ws(' · ',
      case when competitive_decks is not null then '60-card competitive' end,
      case when edhrec_rank is not null then 'EDHREC' end,
      case when cedh_decks is not null then 'cEDH' end,
      case when intel_items is not null then 'articles/social' end
    ) || case when dynamic_sources>0 then ' · '||dynamic_sources||' dynamic signal'||case when dynamic_sources=1 then '' else 's' end else '' end watch_reason
  from scored
)
select card_name,product_id,sku_id,set_name,printing,sku_market_price,direct_low,direct_available,opportunity_score,
       evidence_sources,dynamic_sources,formats,competitive_decks,competitive_top8,
       case comp_stage_rank when 3 then 'early' when 2 then 'confirming' when 1 then 'late' else null end,
       edhrec_rank,edh_watch_class,rank_improvement_pct,cedh_decks,cedh_share_pct,cedh_watch_class,
       intel_items,intel_sources,
       case intel_stage_rank when 3 then 'leading' when 2 then 'confirming' when 1 then 'lagging' else null end,
       corroboration_score,watch_class,watch_reason
from final
order by corroboration_score desc,evidence_sources desc,dynamic_sources desc,opportunity_score desc
limit greatest(1,least(coalesce(p_limit,60),200));
$function$;

revoke all on function public.cross_source_market_watches(integer) from public, anon;
grant execute on function public.cross_source_market_watches(integer) to authenticated;
