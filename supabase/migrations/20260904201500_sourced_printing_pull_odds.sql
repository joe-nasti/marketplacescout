-- Sourced printing-level pull odds. Never infer odds from rarity or collector number.
create table if not exists public.printing_pull_odds_sources (
  set_code text not null,
  collector_number text not null,
  finish_scope text not null,
  language_scope text not null default 'ENGLISH',
  booster_code text not null,
  treatment_name text,
  probability_per_pack numeric,
  packs_per_hit numeric,
  odds_scope text not null,
  source_kind text not null,
  source_url text not null,
  source_title text,
  source_published_at date,
  evidence_note text not null,
  confidence text not null default 'HIGH',
  observed_at timestamptz not null default now(),
  primary key(set_code,collector_number,finish_scope,language_scope,booster_code)
);

alter table public.printing_pull_odds_sources enable row level security;
revoke all on table public.printing_pull_odds_sources from public,anon;
grant select on table public.printing_pull_odds_sources to authenticated,service_role;

-- Duskmourn: Wizards states that a non-Japanese Collector Booster's final premium slot
-- contains one of 10 English traditional-foil Japan Showcase cards 6% of the time,
-- and one of 10 English fracture-foil Japan Showcase cards 0.7% of the time.
-- Therefore a specific English card is approximately 0.6% and 0.07% respectively.
insert into public.printing_pull_odds_sources(
  set_code,collector_number,finish_scope,language_scope,booster_code,treatment_name,
  probability_per_pack,packs_per_hit,odds_scope,source_kind,source_url,source_title,source_published_at,evidence_note,confidence
) values
('DSK','386','FOIL','ENGLISH','collector','Japan Showcase traditional foil',
 0.006,166.666667,'SPECIFIC_ENGLISH_PRINTING_IN_NON_JAPANESE_COLLECTOR_BOOSTER','WOTC_OFFICIAL',
 'https://magic.wizards.com/en/news/feature/collecting-duskmourn','Collecting Duskmourn: The Four Most Important Things to Know','2024-08-31',
 'Official slot odds: English traditional-foil Japan Showcase appears 6% of non-Japanese Collector Boosters and the slot contains 1 of 10 cards; specific-card probability = 6% / 10.', 'HIGH'),
('DSK','396','FOIL','ENGLISH','collector','Japan Showcase fracture foil',
 0.0007,1428.571429,'SPECIFIC_ENGLISH_PRINTING_IN_NON_JAPANESE_COLLECTOR_BOOSTER','WOTC_OFFICIAL',
 'https://magic.wizards.com/en/news/feature/collecting-duskmourn','Collecting Duskmourn: The Four Most Important Things to Know','2024-08-31',
 'Official slot odds: English fracture-foil Japan Showcase appears 0.7% of non-Japanese Collector Boosters and the slot contains 1 of 10 cards; specific-card probability = 0.7% / 10.', 'HIGH')
on conflict(set_code,collector_number,finish_scope,language_scope,booster_code) do update set
  treatment_name=excluded.treatment_name,
  probability_per_pack=excluded.probability_per_pack,
  packs_per_hit=excluded.packs_per_hit,
  odds_scope=excluded.odds_scope,
  source_kind=excluded.source_kind,
  source_url=excluded.source_url,
  source_title=excluded.source_title,
  source_published_at=excluded.source_published_at,
  evidence_note=excluded.evidence_note,
  confidence=excluded.confidence,
  observed_at=now();

create or replace function public.ask_collectish_printing_pull_odds_v1(p_sku_ids text[])
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with requested as (
  select distinct x sku_id from unnest(coalesce(p_sku_ids,array[]::text[])) x where coalesce(x,'')<>''
), targets as (
  select distinct
    s.sku_id::text,
    s.product_id::text,
    upper(c.set_code) set_code,
    c.collector_number,
    case when upper(coalesce(s.printing,s.finish,'')) like '%FOIL%'
           and upper(coalesce(s.printing,s.finish,'')) not like '%NON%FOIL%'
      then 'FOIL' else 'NON FOIL' end finish_scope
  from requested r
  join public.mtgjson_tcgplayer_skus s on s.sku_id=r.sku_id
  join public.mtgjson_cards c on c.uuid=s.uuid
), variants as (
  select distinct product_id,set_code,collector_number,finish_scope from targets
), rows as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',v.product_id,
    'set_code',v.set_code,
    'collector_number',v.collector_number,
    'finish',v.finish_scope,
    'odds_available',(o.set_code is not null),
    'language_scope',o.language_scope,
    'booster_code',o.booster_code,
    'treatment_name',o.treatment_name,
    'probability_per_pack',o.probability_per_pack,
    'packs_per_hit',o.packs_per_hit,
    'odds_scope',o.odds_scope,
    'source_kind',o.source_kind,
    'source_url',o.source_url,
    'source_title',o.source_title,
    'source_published_at',o.source_published_at,
    'evidence_note',o.evidence_note,
    'confidence',o.confidence
  ) order by v.set_code,case when v.collector_number ~ '^[0-9]+$' then v.collector_number::int else 2147483647 end,v.finish_scope),'[]'::jsonb) data
  from variants v
  left join public.printing_pull_odds_sources o
    on o.set_code=v.set_code
   and o.collector_number=v.collector_number
   and o.finish_scope=v.finish_scope
   and o.language_scope='ENGLISH'
)
select case
  when auth.uid() is null and coalesce(auth.role(),'')<>'service_role' then jsonb_build_object('available',false,'error','authentication required')
  when coalesce(array_length(p_sku_ids,1),0)=0 then jsonb_build_object('available',false,'error','sku ids required')
  else jsonb_build_object(
    'available',exists(select 1 from variants),
    'rows',(select data from rows),
    'note','Only explicitly sourced printing odds are returned. Missing rows mean odds are unknown, not common. Collector number, printed rarity, market supply, or price are never converted into invented pack odds.'
  ) end
$$;
revoke all on function public.ask_collectish_printing_pull_odds_v1(text[]) from public,anon;
grant execute on function public.ask_collectish_printing_pull_odds_v1(text[]) to authenticated,service_role;
notify pgrst,'reload schema';
