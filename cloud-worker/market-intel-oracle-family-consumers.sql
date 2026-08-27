-- Propagate Signals through Scryfall Oracle identity anywhere Signals are joined
-- back to Scout. These patches preserve each consumer's existing return contract.
-- Underlying-card signals remain context; exact SKU pricing, supply, velocity,
-- grade, and execution are never inherited from sibling printings.

create or replace view public.market_intel_oracle_rollups
with (security_invoker=true)
as
with ids as (
  select distinct l.user_id,l.intel_id,l.oracle_id,l.canonical_name
  from public.market_intel_scout_signal_links l
  where l.oracle_id is not null
), src as (
  select ids.user_id,ids.oracle_id,max(ids.canonical_name) canonical_name,
         count(*)::integer claim_count,
         count(distinct i.source_url)::integer independent_source_count,
         count(*) filter(where i.direction='bullish')::integer bullish_claims,
         count(*) filter(where i.direction='bearish')::integer bearish_claims,
         count(distinct i.source_url) filter(where i.signal_stage='leading')::integer leading_sources,
         count(distinct i.source_url) filter(where i.signal_stage='confirming')::integer confirming_sources,
         count(distinct i.source_url) filter(where i.signal_stage='lagging')::integer lagging_sources,
         round(avg((case i.direction when 'bullish' then 1 when 'bearish' then -1 else 0 end)::numeric * coalesce(i.confidence,0.5))*100,1) intel_direction_score,
         max(i.observed_at) latest_observed_at,max(coalesce(i.published_at,i.observed_at)) latest_source_at
  from ids
  join public.market_intel_items i on i.intel_id=ids.intel_id and i.user_id=ids.user_id
  group by ids.user_id,ids.oracle_id
)
select user_id,'oracle:'||oracle_id::text entity_key,canonical_name entity_name,oracle_id,
       claim_count,independent_source_count,bullish_claims,bearish_claims,
       leading_sources,confirming_sources,lagging_sources,intel_direction_score,
       latest_observed_at,latest_source_at
from src;

grant select on public.market_intel_oracle_rollups to authenticated;

-- Actionable Emerging: replace literal article/social entities with canonical
-- Oracle names, then allow those signals to match any Scout product in family.
do $do$
declare ddl text; old text; new text;
begin
  ddl := pg_get_functiondef('public.actionable_emerging_opportunities(integer)'::regprocedure);
  if position('market_intel_scout_signal_links' in ddl)=0 then
    old := $old$), intel as (
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
), signals as ($old$;
    new := $new$), intel as (
  select lower(l.canonical_name) k,null::text product_id,null::text sku_id,
         'articles/social'::text family,
         case max(case i.signal_stage when 'leading' then 3 when 'confirming' then 2 else 0 end)
           when 3 then 'Leading article/social signal' else 'Confirming article/social signal' end label,
         least(100,greatest(0,round(55+max(coalesce(i.confidence,0.5))*35+
           case max(case i.signal_stage when 'leading' then 3 when 'confirming' then 2 else 0 end) when 3 then 10 else 0 end)))::int strength,
         'Recent bullish article/social intelligence is attached to the underlying Oracle card.'::text reason
  from public.market_intel_scout_signal_links l
  join public.market_intel_items i on i.intel_id=l.intel_id and i.user_id=l.user_id
  where l.user_id=auth.uid()
    and coalesce(i.direction,'neutral')='bullish'
    and i.signal_stage in ('leading','confirming')
    and i.observed_at>=now()-interval '30 days'
  group by lower(l.canonical_name)
), signals as ($new$;
    if position(old in ddl)=0 then raise exception 'actionable intel block not found'; end if;
    ddl := replace(ddl,old,new);
    old := $old$  join signals s on (s.product_id is not null and s.product_id=l.product_id)
                  or (s.product_id is null and s.k=lower(l.card_name))$old$;
    new := $new$  join signals s on (s.product_id is not null and s.product_id=l.product_id)
                  or (s.product_id is null and s.k=lower(l.card_name))
                  or (s.family='articles/social' and exists (
                        select 1 from public.market_intel_scout_signal_links z
                        where z.user_id=auth.uid() and z.product_id=l.product_id and lower(z.canonical_name)=s.k
                      ))$new$;
    if position(old in ddl)=0 then raise exception 'actionable match block not found'; end if;
    execute replace(ddl,old,new);
  end if;
end
$do$;

-- Cross Source: aggregate article/social evidence by canonical Oracle name and
-- let a reskinned Scout product satisfy that canonical evidence key.
do $do$
declare ddl text; old text; new text;
begin
  ddl := pg_get_functiondef('public.cross_source_market_watches(integer)'::regprocedure);
  if position('market_intel_scout_signal_links' in ddl)=0 then
    old := $old$), intel as (
  select lower(e.entity_name) k, min(e.entity_name) card_name,
         count(distinct i.intel_id)::bigint intel_items,
         count(distinct coalesce(nullif(i.source_name,''),i.source_type))::bigint intel_sources,
         max(case i.signal_stage when 'leading' then 3 when 'confirming' then 2 when 'lagging' then 1 else 0 end) stage_rank
  from public.market_intel_entities e
  join public.market_intel_items i on i.intel_id=e.intel_id and i.user_id=e.user_id
  where e.user_id=auth.uid() and e.entity_type in ('card','other')
    and coalesce(i.direction,'neutral')='bullish' and i.observed_at>=now()-interval '90 days'
  group by lower(e.entity_name)
), keys as ($old$;
    new := $new$), intel as (
  select lower(l.canonical_name) k, min(l.canonical_name) card_name,
         count(distinct i.intel_id)::bigint intel_items,
         count(distinct coalesce(nullif(i.source_name,''),i.source_type))::bigint intel_sources,
         max(case i.signal_stage when 'leading' then 3 when 'confirming' then 2 when 'lagging' then 1 else 0 end) stage_rank
  from public.market_intel_scout_signal_links l
  join public.market_intel_items i on i.intel_id=l.intel_id and i.user_id=l.user_id
  where l.user_id=auth.uid()
    and coalesce(i.direction,'neutral')='bullish' and i.observed_at>=now()-interval '90 days'
  group by lower(l.canonical_name)
), keys as ($new$;
    if position(old in ddl)=0 then raise exception 'cross-source intel block not found'; end if;
    ddl := replace(ddl,old,new);
    old := $old$  from evidence ev join public.scout_opportunities_v5_cache s on s.user_id=auth.uid() and lower(s.product_name)=ev.k$old$;
    new := $new$  from evidence ev join public.scout_opportunities_v5_cache s on s.user_id=auth.uid() and (
    lower(s.product_name)=ev.k or exists (
      select 1 from public.market_intel_scout_signal_links z
      where z.user_id=auth.uid() and z.product_id=s.product_id and lower(z.canonical_name)=ev.k
    )
  )$new$;
    if position(old in ddl)=0 then raise exception 'cross-source market join not found'; end if;
    execute replace(ddl,old,new);
  end if;
end
$do$;

-- Ask timeline: Signal events follow Oracle-family product links.
do $do$
declare ddl text; old text; new text;
begin
  ddl := pg_get_functiondef('public.ask_collectish_market_timeline_v1(text,text,integer)'::regprocedure);
  if position('market_intel_scout_signal_links l on l.intel_id=i.intel_id' in ddl)=0 then
    old := $old$    from public.market_intel_items i
    join public.market_intel_entities e on e.intel_id=i.intel_id and e.user_id=i.user_id
    where i.user_id=auth.uid()
      and (e.product_id=s.product_id or (s.scryfall_id is not null and e.scryfall_id=s.scryfall_id))
      and coalesce(i.published_at,i.observed_at,i.created_at)>=now()-make_interval(days=>p_days)$old$;
    new := $new$    from public.market_intel_items i
    join public.market_intel_scout_signal_links l on l.intel_id=i.intel_id and l.user_id=i.user_id and l.product_id=s.product_id
    where i.user_id=auth.uid()
      and coalesce(i.published_at,i.observed_at,i.created_at)>=now()-make_interval(days=>p_days)$new$;
    if position(old in ddl)=0 then raise exception 'timeline signal join not found'; end if;
    execute replace(ddl,old,new);
  end if;
end
$do$;

-- Ask investigation: claim retrieval follows the target product's Oracle family.
do $do$
declare ddl text; old text; new text;
begin
  ddl := pg_get_functiondef('public.ask_collectish_market_investigation_v3(text,text)'::regprocedure);
  if position('select distinct l.intel_id' in ddl)=0 then
    old := $old$    with ids as (
      select distinct e.intel_id
      from public.market_intel_entities e
      where e.user_id=auth.uid() and (e.product_id=s.product_id or (scry is not null and e.scryfall_id::text=scry))
    ), c as ($old$;
    new := $new$    with ids as (
      select distinct l.intel_id
      from public.market_intel_scout_signal_links l
      where l.user_id=auth.uid() and l.product_id=s.product_id
    ), c as ($new$;
    if position(old in ddl)=0 then raise exception 'investigation claims block not found'; end if;
    execute replace(ddl,old,new);
  end if;
end
$do$;
