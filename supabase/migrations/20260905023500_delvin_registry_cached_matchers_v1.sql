alter table public.delvin_query_registry add column if not exists matcher_patterns text[] not null default '{}'::text[];
alter table public.delvin_query_registry add column if not exists matcher_priority integer not null default 1000;

update public.delvin_query_registry set matcher_priority=10, matcher_patterns=array['mtg\s*stocks?.*(interests?|movers?|gainers?)','mtgstocks.*(interests?|movers?|gainers?)'] where query_key='mtgstocks_interests_both';
update public.delvin_query_registry set matcher_priority=20, matcher_patterns=array['tcgplayer.*(climbing|price trends?)','climbing in price'] where query_key='tcgplayer_climbing';
update public.delvin_query_registry set matcher_priority=30, matcher_patterns=array['(sales? acceleration|selling faster|started selling|sales? velocity).*(before.*price|price.*(hasn''t|has not|isn''t|not).*mov|price lag)','(before.*price|price.*(hasn''t|has not|isn''t|not).*mov|price lag).*(sales? acceleration|selling faster|started selling|sales? velocity)'] where query_key='sales_acceleration_price_lag';
update public.delvin_query_registry set matcher_priority=40, matcher_patterns=array['(sales? acceleration|selling faster|started selling|sales? velocity)'] where query_key='sales_acceleration';
update public.delvin_query_registry set matcher_priority=50, matcher_patterns=array['direct.*(tight|pressure|getting low|low inventory|inventory pressure).*(today|24h|24 hours?)','(today|24h|24 hours?).*direct.*(tight|pressure|getting low|low inventory|inventory pressure)'] where query_key='direct_pressure_24h';
update public.delvin_query_registry set matcher_priority=60, matcher_patterns=array['direct.*(tight|pressure|getting low|low inventory|inventory pressure)'] where query_key='direct_pressure_7d';
update public.delvin_query_registry set matcher_priority=70, matcher_patterns=array['(cross[- ]?market|mispriced.*markets?|arbitrage|market dislocations?)'] where query_key='cross_market_dislocations';
update public.delvin_query_registry set matcher_priority=80, matcher_patterns=array['syp.*(change|changes|pressure|meaningful|week|changed)','meaningful syp'] where query_key='syp_pressure_7d';
update public.delvin_query_registry set matcher_priority=90, matcher_patterns=array['(edh demand|commander demand|edh movers?|gaining edh demand)'] where query_key='edh_demand_7d';
update public.delvin_query_registry set matcher_priority=100, matcher_patterns=array['(creator[- ]driven|creator catalysts?|creator movers?|content creator cards?)'] where query_key='creator_catalysts_7d';
update public.delvin_query_registry set matcher_priority=110, matcher_patterns=array['top movers( today)?','biggest movers today','what moved today','what(''s| is) moving today','what should i look at( right now)?','market radar','best opportunities right now','what is moving right now'] where query_key='market_radar';

create or replace function public.resolve_delvin_cached_query_v1(p_question text)
returns jsonb
language sql
stable
security invoker
set search_path=public
as $$
with normalized as (
  select lower(replace(coalesce(p_question,''),'’','''')) as q
), matches as (
  select r.query_key, coalesce(r.route_key,r.query_key) as route_key, r.prompt, r.category, r.surface_type, r.async_enrichment, r.matcher_priority
  from public.delvin_query_registry r, normalized n
  where r.enabled
    and r.capability_kind='cached'
    and cardinality(r.matcher_patterns)>0
    and exists (select 1 from unnest(r.matcher_patterns) p where n.q ~* p)
  order by r.matcher_priority, r.sort_order, r.query_key
  limit 1
)
select coalesce((select jsonb_build_object('matched',true,'query_key',query_key,'route_key',route_key,'prompt',prompt,'category',category,'surface_type',surface_type,'async_enrichment',async_enrichment) from matches), jsonb_build_object('matched',false));
$$;

grant execute on function public.resolve_delvin_cached_query_v1(text) to authenticated, service_role;