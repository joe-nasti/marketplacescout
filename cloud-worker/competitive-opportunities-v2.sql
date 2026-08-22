-- Competitive opportunities hot-path optimization.
-- Keep current market joining fast; historical timing belongs on shortlisted rows, not this panel load.
create index if not exists scout_v5_cache_user_scryfall_idx
  on public.scout_opportunities_v5_cache(user_id,scryfall_id)
  where scryfall_id is not null;
create index if not exists scout_v5_cache_user_name_idx
  on public.scout_opportunities_v5_cache(user_id,lower(product_name));

create or replace view public.competitive_card_rollups
with (security_invoker=true)
as
with deck_event as (
  select d.deck_id,d.placement,e.event_id,e.event_name,e.format,e.event_date,e.canonical_event_key
  from public.competitive_decks d
  join public.competitive_events e on e.event_id=d.event_id
  where e.event_date >= current_date - 30
), base as (
  select c.card_name,c.scryfall_id,de.format,de.event_id,de.event_date,de.deck_id,de.placement,
         sum(c.quantity) as copies
  from public.competitive_deck_cards c
  join deck_event de on de.deck_id=c.deck_id
  where c.section='main'
  group by c.card_name,c.scryfall_id,de.format,de.event_id,de.event_date,de.deck_id,de.placement
)
select card_name,scryfall_id,format,
       count(distinct event_id) as event_count_30d,
       count(distinct deck_id) as deck_count_30d,
       count(distinct deck_id) filter (where placement <= 8) as top8_decks_30d,
       count(distinct deck_id) filter (where placement = 1) as wins_30d,
       coalesce(sum(copies),0)::integer as copies_30d,
       count(distinct deck_id) filter (where event_date >= current_date - 7) as decks_7d,
       count(distinct deck_id) filter (where event_date < current_date - 7 and event_date >= current_date - 14) as decks_prev_7d,
       max(event_date) as last_seen
from base
group by card_name,scryfall_id,format;

grant select on public.competitive_card_rollups to authenticated;

create or replace function public.competitive_scout_opportunities(p_format text default null)
returns table (
  card_name text,scryfall_id uuid,format text,event_count_30d bigint,deck_count_30d bigint,
  top8_decks_30d bigint,wins_30d bigint,decks_7d bigint,decks_prev_7d bigint,
  competitive_velocity numeric,product_id text,sku_id text,set_name text,printing text,
  market_price numeric,direct_low numeric,direct_available integer,opportunity_score integer,
  market_change_7d_pct numeric,direct_qty_change_7d_pct numeric,competitive_stage text
)
language sql
security invoker
set search_path=public
as $$
with roll as (
  select * from public.competitive_card_rollups
  where p_format is null or lower(format)=lower(p_format)
), sf_matches as (
  select r.*,c.product_id,c.sku_id,c.set_name,c.printing,c.condition,c.language,
         c.sku_market_price,c.direct_low,c.direct_available,c.opportunity_score,0 as match_priority
  from roll r
  join public.scout_opportunities_v5_cache c
    on c.user_id=auth.uid() and r.scryfall_id is not null and c.scryfall_id=r.scryfall_id
), name_matches as (
  select r.*,c.product_id,c.sku_id,c.set_name,c.printing,c.condition,c.language,
         c.sku_market_price,c.direct_low,c.direct_available,c.opportunity_score,1 as match_priority
  from roll r
  join public.scout_opportunities_v5_cache c
    on c.user_id=auth.uid() and lower(c.product_name)=lower(r.card_name)
), candidates as (
  select * from sf_matches
  union all
  select * from name_matches
), ranked as (
  select c.*,row_number() over (
    partition by c.card_name,c.format
    order by c.match_priority,
      case when lower(coalesce(c.condition,''))='near mint' then 0 else 1 end,
      case when lower(coalesce(c.language,''))='english' then 0 else 1 end,
      case when lower(coalesce(c.printing,''))='normal' then 0 else 1 end,
      c.opportunity_score desc nulls last
  ) rn
  from candidates c
), chosen as (
  select * from ranked where rn=1
)
select card_name,scryfall_id,format,event_count_30d,deck_count_30d,top8_decks_30d,wins_30d,decks_7d,decks_prev_7d,
       round(case when decks_prev_7d=0 then decks_7d::numeric else decks_7d::numeric/decks_prev_7d end,2),
       product_id,sku_id,set_name,printing,sku_market_price,direct_low,direct_available,opportunity_score,
       null::numeric,null::numeric,
       case when decks_7d>=2 and decks_7d>=greatest(2,decks_prev_7d*2) then 'early'
            when decks_7d>decks_prev_7d then 'confirming' else 'watch' end
from chosen
where decks_7d>0
order by wins_30d desc,top8_decks_30d desc,decks_7d desc
limit 100;
$$;

grant execute on function public.competitive_scout_opportunities(text) to authenticated;
