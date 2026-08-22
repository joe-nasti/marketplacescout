-- Commander Intelligence RPCs deployed in Supabase.
-- Broad EDH demand is based on MarketplaceScout's observed EDHREC history.
-- cEDH commander meta is based on canonical competitive_events/decks imported from EDHTop16.

create or replace function public.commander_edh_opportunities(p_limit integer default 100)
returns table(
  card_name text, product_id text, sku_id text, set_name text, printing text,
  market_price numeric, direct_low numeric, direct_available integer, opportunity_score integer,
  edhrec_rank integer, edhrec_signal text, edhrec_signal_score numeric, edhrec_adjustment numeric,
  edhrec_current_at timestamptz, edhrec_baseline_rank integer, edhrec_baseline_at timestamptz,
  history_days numeric, rank_improvement_pct numeric, direct_spread_pct numeric,
  watch_class text, commander_priority integer, watch_reason text
)
language sql
security invoker
set search_path=public
as $$
with cache as (
  select c.*,
         row_number() over (
           partition by lower(c.product_name)
           order by
             case when lower(coalesce(c.condition,''))='near mint' then 0 else 1 end,
             case when lower(coalesce(c.language,''))='english' then 0 else 1 end,
             case when lower(coalesce(c.printing,''))='normal' then 0 else 1 end,
             c.opportunity_score desc nulls last,
             c.direct_available asc nulls last
         ) rn
  from public.scout_opportunities_v5_cache c
  where c.user_id=auth.uid()
    and c.edhrec_rank is not null
    and c.edhrec_rank<=15000
), chosen as (
  select * from cache where rn=1
), hist as (
  select lower(r.product_name) as name_key,
         (array_agg(r.edhrec_rank order by r.edhrec_observed_at desc,r.id desc) filter(where r.edhrec_rank is not null))[1] as current_rank,
         (array_agg(r.edhrec_rank order by r.edhrec_observed_at asc,r.id asc) filter(where r.edhrec_rank is not null))[1] as baseline_rank,
         (array_agg(r.edhrec_observed_at order by r.edhrec_observed_at desc,r.id desc))[1] as current_at,
         (array_agg(r.edhrec_observed_at order by r.edhrec_observed_at asc,r.id asc))[1] as baseline_at,
         (array_agg(r.edhrec_signal order by r.edhrec_observed_at desc,r.id desc))[1] as current_signal,
         (array_agg(r.edhrec_signal_score order by r.edhrec_observed_at desc,r.id desc))[1] as current_signal_score,
         (array_agg(r.edhrec_adjustment order by r.edhrec_observed_at desc,r.id desc))[1] as current_adjustment
  from public.marketplace_scan_rows r
  where r.user_id=auth.uid()
    and r.edhrec_observed_at>=now()-interval '8 days'
    and r.edhrec_observed_at is not null
  group by lower(r.product_name)
), calc as (
  select c.*,h.current_signal as edhrec_signal,h.current_signal_score as edhrec_signal_score,h.current_adjustment as edhrec_adjustment,
         h.current_at as edhrec_current_at,h.baseline_rank as edhrec_baseline_rank,h.baseline_at as edhrec_baseline_at,
         case when h.current_at is not null and h.baseline_at is not null then round((extract(epoch from (h.current_at-h.baseline_at))/86400.0)::numeric,1) end as hist_days,
         case when h.baseline_rank>0 and c.edhrec_rank is not null then round(((h.baseline_rank-c.edhrec_rank)::numeric/h.baseline_rank*100)::numeric,1) end as rank_move,
         case when c.sku_market_price>0 and c.direct_low>0 then round(((c.direct_low-c.sku_market_price)/c.sku_market_price*100)::numeric,1) end as spread_pct
  from chosen c
  left join hist h on h.name_key=lower(c.product_name)
), scored as (
  select c.*,
         case
           when coalesce(c.hist_days,0)>=3 and coalesce(c.rank_move,0)>=20 and c.edhrec_rank<=10000 then 'edh_breakout'
           when c.edhrec_rank<=2500 then 'edh_popular'
           when coalesce(c.edhrec_signal,'')='Commander demand' or c.edhrec_rank<=10000 then 'edh_demand'
           else 'edh_watch'
         end as wc,
         least(100,greatest(0,round(
           (case when c.edhrec_rank<=500 then 30 when c.edhrec_rank<=2500 then 24 when c.edhrec_rank<=10000 then 16 else 8 end)
           + least(25,greatest(0,coalesce(c.rank_move,0)*0.6))
           + coalesce(c.opportunity_score,0)*0.25
           + (case when c.direct_available<=5 then 15 when c.direct_available<=20 then 10 when c.direct_available<=50 then 5 else 0 end)
           + least(10,greatest(-10,coalesce(c.edhrec_adjustment,0)))
         )))::integer as prio
  from calc c
)
select product_name,product_id,sku_id,set_name,printing,sku_market_price,direct_low,direct_available,opportunity_score,
       edhrec_rank,edhrec_signal,edhrec_signal_score,edhrec_adjustment,edhrec_current_at,edhrec_baseline_rank,edhrec_baseline_at,
       hist_days,rank_move,spread_pct,wc,prio,
       case wc
         when 'edh_breakout' then 'EDHREC rank improved materially across the available history while this Scout printing remains actionable.'
         when 'edh_popular' then 'Established high Commander demand paired with a currently attractive Scout printing.'
         when 'edh_demand' then 'Meaningful Commander demand with a Scout setup worth monitoring.'
         else 'Commander usage exists, but MarketplaceScout does not yet see a stronger demand or trend signal.'
       end
from scored
where wc<>'edh_watch'
order by prio desc,edhrec_rank asc nulls last
limit greatest(1,least(coalesce(p_limit,100),250));
$$;

grant execute on function public.commander_edh_opportunities(integer) to authenticated;

create or replace function public.cedh_commander_rollups(p_days integer default 90, p_min_event_size integer default 16)
returns table(
  commander text,event_count bigint,entries bigint,top16_entries bigint,wins bigint,
  entries_30d bigint,entries_prev_30d bigint,total_field_30d bigint,total_field_prev_30d bigint,
  share_30d_pct numeric,share_prev_30d_pct numeric,share_change_pp numeric,latest_seen date,
  product_id text,sku_id text,set_name text,printing text,market_price numeric,direct_low numeric,
  direct_available integer,opportunity_score integer,watch_class text,cedh_priority integer
)
language sql
security invoker
set search_path=public
as $$
with ev as (
  select e.event_id,e.event_date,e.published_deck_count,e.player_count,e.coverage_type
  from public.competitive_events e
  where lower(e.format)='cedh'
    and e.event_date>=current_date-greatest(30,least(coalesce(p_days,90),365))
    and coalesce(e.player_count,e.published_deck_count,0)>=greatest(1,coalesce(p_min_event_size,16))
    and e.coverage_type in ('complete_event','partial_event')
), totals as (
  select
    coalesce(sum(coalesce(published_deck_count,player_count,0)) filter(where event_date>=current_date-30),0)::bigint field30,
    coalesce(sum(coalesce(published_deck_count,player_count,0)) filter(where event_date<current_date-30 and event_date>=current_date-60),0)::bigint fieldprev
  from ev
), agg as (
  select d.archetype commander,
         count(distinct d.event_id)::bigint event_count,
         count(*)::bigint entries,
         count(*) filter(where d.placement<=16)::bigint top16_entries,
         count(*) filter(where d.placement=1)::bigint wins,
         count(*) filter(where e.event_date>=current_date-30)::bigint entries30,
         count(*) filter(where e.event_date<current_date-30 and e.event_date>=current_date-60)::bigint entriesprev,
         max(e.event_date) latest_seen
  from public.competitive_decks d
  join ev e on e.event_id=d.event_id
  where nullif(trim(d.archetype),'') is not null
  group by d.archetype
), withshare as (
  select a.*,t.field30,t.fieldprev,
         case when t.field30>0 then round((a.entries30::numeric/t.field30*100)::numeric,2) end share30,
         case when t.fieldprev>0 then round((a.entriesprev::numeric/t.fieldprev*100)::numeric,2) end shareprev
  from agg a cross join totals t
), market as (
  select w.*,c.product_id,c.sku_id,c.set_name,c.printing,c.sku_market_price,c.direct_low,c.direct_available,c.opportunity_score,
         row_number() over(partition by lower(w.commander) order by
           case when lower(coalesce(c.condition,''))='near mint' then 0 else 1 end,
           case when lower(coalesce(c.language,''))='english' then 0 else 1 end,
           case when lower(coalesce(c.printing,''))='normal' then 0 else 1 end,
           c.opportunity_score desc nulls last) rn
  from withshare w
  left join public.scout_opportunities_v5_cache c
    on c.user_id=auth.uid() and lower(c.product_name)=lower(w.commander)
), chosen as (
  select * from market where rn=1
), final as (
  select commander,event_count,entries,top16_entries,wins,entries30,entriesprev,field30,fieldprev,
         share30,shareprev,
         case when share30 is not null and shareprev is not null then round((share30-shareprev)::numeric,2) end as share_delta,
         latest_seen,product_id,sku_id,set_name,printing,sku_market_price,direct_low,direct_available,opportunity_score,
         case
           when fieldprev>0 and entries30>=3 and coalesce(share30,0)>=coalesce(shareprev,0)+2 then 'cedh_breakout'
           when coalesce(share30,0)>=5 then 'cedh_established'
           when entries30>=2 then 'cedh_watch'
           else 'cedh_baseline'
         end as wc,
         least(100,greatest(0,round(
           least(35,coalesce(share30,0)*3)
           + least(20,greatest(0,coalesce(share30,0)-coalesce(shareprev,0))*5)
           + least(15,top16_entries*2)
           + coalesce(opportunity_score,0)*0.2
           + case when direct_available<=5 then 10 when direct_available<=20 then 6 else 0 end
         )))::integer as prio
  from chosen
  where entries30>0
)
select commander,event_count,entries,top16_entries,wins,entries30,entriesprev,field30,fieldprev,
       share30,shareprev,share_delta,latest_seen,product_id,sku_id,set_name,printing,sku_market_price,direct_low,direct_available,opportunity_score,wc,prio
from final
order by prio desc,entries30 desc,top16_entries desc
limit 100;
$$;

grant execute on function public.cedh_commander_rollups(integer,integer) to authenticated;
