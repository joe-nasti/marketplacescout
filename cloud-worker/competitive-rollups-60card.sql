-- Competitive Watch is 60-card constructed only. Commander/cEDH is modeled separately.
create or replace view public.competitive_card_rollups
with (security_invoker = true) as
with deck_event as (
  select d.deck_id,d.placement,e.event_id,e.event_name,e.format,e.event_date,e.canonical_event_key
  from public.competitive_decks d
  join public.competitive_events e on e.event_id=d.event_id
  where e.event_date>=current_date-30
    and lower(coalesce(e.format,'')) not in ('cedh','edh','commander')
), base as (
  select c.card_name,c.scryfall_id,de.format,de.event_id,de.event_date,de.deck_id,de.placement,sum(c.quantity) copies
  from public.competitive_deck_cards c
  join deck_event de on de.deck_id=c.deck_id
  where c.section='main'
  group by c.card_name,c.scryfall_id,de.format,de.event_id,de.event_date,de.deck_id,de.placement
)
select card_name,scryfall_id,format,
       count(distinct event_id) event_count_30d,
       count(distinct deck_id) deck_count_30d,
       count(distinct deck_id) filter(where placement<=8) top8_decks_30d,
       count(distinct deck_id) filter(where placement=1) wins_30d,
       coalesce(sum(copies),0)::integer copies_30d,
       count(distinct deck_id) filter(where event_date>=current_date-7) decks_7d,
       count(distinct deck_id) filter(where event_date<current_date-7 and event_date>=current_date-14) decks_prev_7d,
       max(event_date) last_seen
from base
group by card_name,scryfall_id,format;

grant select on public.competitive_card_rollups to authenticated;
