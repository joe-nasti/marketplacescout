create index if not exists mtgjson_cards_oracle_release_idx
  on public.mtgjson_cards(scryfall_oracle_id, release_date)
  where scryfall_oracle_id is not null;

create or replace function public.competitive_financial_opportunities(p_format text default null)
returns table(
  card_name text, scryfall_id uuid, format text, event_count_30d bigint, deck_count_30d bigint,
  top8_decks_30d bigint, wins_30d bigint, decks_7d bigint, decks_prev_7d bigint,
  prior_event_count_30d bigint, competitive_history_days integer,
  product_id text, sku_id text, set_name text, set_code text, printing text,
  market_price numeric, direct_low numeric, direct_available integer, opportunity_score integer,
  selected_release_date date, card_first_release_date date, card_latest_release_date date,
  card_set_count integer, watch_class text, watch_reason text, financial_priority integer
)
language sql
security invoker
set search_path=public
as $function$
with roll as (
  select * from public.competitive_card_rollups where p_format is null or lower(format)=lower(p_format)
), fmt_history as (
  select format,count(*) filter (where event_date < current_date - 7) prior_event_count,
         greatest(0,(current_date-min(event_date)))::integer history_days
  from public.competitive_events
  where event_date >= current_date - 30 and coverage_type <> 'curated_sample'
    and lower(coalesce(format,'')) not in ('cedh','edh','commander')
  group by format
), sf_matches as (
  select r.*,c.product_id,c.sku_id,c.set_name,c.set_code,c.printing,c.condition,c.language,
         c.sku_market_price,c.direct_low,c.direct_available,c.opportunity_score,c.mtgjson_uuid,0 match_priority
  from roll r join public.scout_opportunities_v5_cache c
    on c.user_id=auth.uid() and r.scryfall_id is not null and c.scryfall_id=r.scryfall_id
), name_matches as (
  select r.*,c.product_id,c.sku_id,c.set_name,c.set_code,c.printing,c.condition,c.language,
         c.sku_market_price,c.direct_low,c.direct_available,c.opportunity_score,c.mtgjson_uuid,1 match_priority
  from roll r join public.scout_opportunities_v5_cache c
    on c.user_id=auth.uid() and lower(c.product_name)=lower(r.card_name)
), candidates as (
  select * from sf_matches union all select * from name_matches
), ranked as (
  select c.*,row_number() over(partition by c.card_name,c.format order by c.match_priority,
    case when lower(coalesce(c.condition,''))='near mint' then 0 else 1 end,
    case when lower(coalesce(c.language,''))='english' then 0 else 1 end,
    case when lower(coalesce(c.printing,''))='normal' then 0 else 1 end,
    c.opportunity_score desc nulls last) rn
  from candidates c
), chosen as (
  select * from ranked where rn=1
), print_meta as (
  select ch.*,mc.release_date selected_release_date,mc.scryfall_oracle_id,
         coalesce(fh.prior_event_count,0)::bigint prior_event_count_30d,
         coalesce(fh.history_days,0) competitive_history_days
  from chosen ch
  left join public.mtgjson_cards mc on mc.uuid=ch.mtgjson_uuid
  left join fmt_history fh on lower(fh.format)=lower(ch.format)
), oracle_meta as (
  select pm.*,
         coalesce(oid.first_release_date,oname.first_release_date) first_release_date,
         coalesce(oid.latest_release_date,oname.latest_release_date) latest_release_date,
         coalesce(oid.set_count,oname.set_count) set_count
  from print_meta pm
  left join lateral (
    select min(m.release_date) filter(where m.release_date is not null and m.release_date<=current_date) first_release_date,
           max(m.release_date) filter(where m.release_date is not null and m.release_date<=current_date) latest_release_date,
           count(distinct m.set_code)::integer set_count
    from public.mtgjson_cards m
    where pm.scryfall_oracle_id is not null and m.scryfall_oracle_id=pm.scryfall_oracle_id
  ) oid on pm.scryfall_oracle_id is not null
  left join lateral (
    select min(m.release_date) filter(where m.release_date is not null and m.release_date<=current_date) first_release_date,
           max(m.release_date) filter(where m.release_date is not null and m.release_date<=current_date) latest_release_date,
           count(distinct m.set_code)::integer set_count
    from public.mtgjson_cards m
    where pm.scryfall_oracle_id is null and lower(m.name)=lower(pm.card_name)
  ) oname on pm.scryfall_oracle_id is null
), classified as (
  select o.*,
    case
      when lower(coalesce(o.card_name,'')) in ('plains','island','swamp','mountain','forest','wastes','snow-covered plains','snow-covered island','snow-covered swamp','snow-covered mountain','snow-covered forest') then 'ignore'
      when o.prior_event_count_30d>0 and o.decks_prev_7d>0 and o.decks_7d>=greatest(2,o.decks_prev_7d*2) then 'adoption_breakout'
      when lower(coalesce(o.format,''))='standard' and coalesce(o.first_release_date,o.selected_release_date) >= current_date - 1095 then 'standard_watch'
      when coalesce(o.set_count,999)<=5 and coalesce(o.first_release_date,o.selected_release_date) >= current_date - 730 then 'recent_card'
      when coalesce(o.set_count,999)<=4 and coalesce(o.latest_release_date,o.selected_release_date) < current_date - 730 and coalesce(o.direct_available,999)<=10 and (coalesce(o.opportunity_score,0)>=40 or (o.sku_market_price>0 and o.direct_low>=o.sku_market_price*1.35)) then 'constrained_old_card'
      when coalesce(o.selected_release_date,current_date) < current_date - 730 and coalesce(o.direct_available,999)<=10 and coalesce(o.opportunity_score,0)>=50 and o.sku_market_price>0 and o.direct_low>=o.sku_market_price*1.25 then 'constrained_variant'
      else 'established_staple'
    end watch_class_calc
  from oracle_meta o
), scored as (
  select c.*,
    case watch_class_calc when 'adoption_breakout' then 35 when 'standard_watch' then 30 when 'recent_card' then 24 when 'constrained_old_card' then 26 when 'constrained_variant' then 24 else 0 end
    + least(25,round(25.0*c.deck_count_30d/nullif(greatest(c.deck_count_30d,32),0)))::integer
    + least(15,coalesce(round(15.0*c.top8_decks_30d/nullif(c.deck_count_30d,0)),0))::integer
    + least(15,coalesce(round(c.opportunity_score*0.15),0))::integer
    + case when coalesce(c.direct_available,999)<=2 then 15 when coalesce(c.direct_available,999)<=5 then 12 when coalesce(c.direct_available,999)<=10 then 9 when coalesce(c.direct_available,999)<=25 then 5 else 0 end priority_calc
  from classified c
)
select card_name,scryfall_id,format,event_count_30d,deck_count_30d,top8_decks_30d,wins_30d,decks_7d,decks_prev_7d,
       prior_event_count_30d,competitive_history_days,product_id,sku_id,set_name,set_code,printing,
       sku_market_price,direct_low,direct_available,opportunity_score,selected_release_date,
       first_release_date,latest_release_date,set_count,watch_class_calc,
       case watch_class_calc
         when 'adoption_breakout' then 'Competitive adoption is accelerating versus prior imported events.'
         when 'standard_watch' then 'Recent Standard card with meaningful competitive adoption; tournament demand can matter while supply is still developing.'
         when 'recent_card' then 'Relatively new, lightly reprinted card seeing meaningful competitive play before long-term supply is established.'
         when 'constrained_old_card' then 'Older card with few known set printings plus tight market supply; competitive demand may matter despite its age.'
         when 'constrained_variant' then 'A specific older printing has tight Direct supply and a meaningful premium; watch this printing rather than the generic card.'
         else 'Established/reprinted staple; competitive popularity alone is not a financial catalyst.' end,
       least(100,priority_calc)::integer
from scored
where decks_7d>0 and watch_class_calc not in ('ignore','established_staple')
order by priority_calc desc,top8_decks_30d desc,deck_count_30d desc
limit 100;
$function$;

revoke all on function public.competitive_financial_opportunities(text) from public,anon;
grant execute on function public.competitive_financial_opportunities(text) to authenticated;
