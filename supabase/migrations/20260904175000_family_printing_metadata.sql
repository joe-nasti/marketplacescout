-- Fact-checked printing metadata for Delvin/Scout supply opportunity analysis.
create or replace function public.ask_collectish_family_printing_metadata_v1(p_sku_ids text[])
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with requested as (
  select distinct x as sku_id
  from unnest(coalesce(p_sku_ids,array[]::text[])) x
  where coalesce(x,'')<>''
), targets as (
  select distinct
    s.sku_id::text,
    s.product_id::text,
    c.name as card_name,
    c.set_code,
    c.collector_number,
    lower(coalesce(c.rarity,'unknown')) as rarity,
    c.finishes,
    c.frame_effects,
    c.promo_types,
    case
      when upper(coalesce(s.printing,s.finish,'')) like '%FOIL%'
       and upper(coalesce(s.printing,s.finish,'')) not like '%NON%FOIL%'
      then 'FOIL' else 'NON FOIL'
    end as finish_scope
  from requested r
  join public.mtgjson_tcgplayer_skus s on s.sku_id=r.sku_id
  join public.mtgjson_cards c on c.uuid=s.uuid
), grouped as (
  select
    product_id,finish_scope,
    min(card_name) card_name,
    min(set_code) set_code,
    min(collector_number) collector_number,
    min(rarity) rarity,
    min(finishes::text)::jsonb finishes,
    min(frame_effects::text)::jsonb frame_effects,
    min(promo_types::text)::jsonb promo_types
  from targets
  group by product_id,finish_scope
), rows as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',g.product_id,
    'finish',g.finish_scope,
    'card_name',g.card_name,
    'set_code',g.set_code,
    'collector_number',g.collector_number,
    'rarity',g.rarity,
    'finishes',g.finishes,
    'frame_effects',g.frame_effects,
    'promo_types',g.promo_types,
    'booster_config_count',(select count(*) from public.mtgjson_set_booster_configs b where upper(b.set_code)=upper(g.set_code)),
    'pull_odds_status',case when exists(select 1 from public.mtgjson_set_booster_configs b where upper(b.set_code)=upper(g.set_code)) then 'BOOSTER_CONFIG_AVAILABLE_EXACT_VARIANT_ODDS_UNRESOLVED' else 'NO_SOURCED_VARIANT_PULL_ODDS' end
  ) order by g.set_code,case when g.collector_number ~ '^[0-9]+$' then g.collector_number::int else 2147483647 end,g.finish_scope),'[]'::jsonb) data
  from grouped g
)
select case
  when auth.uid() is null and coalesce(auth.role(),'')<>'service_role' then jsonb_build_object('available',false,'error','authentication required')
  when coalesce(array_length(p_sku_ids,1),0)=0 then jsonb_build_object('available',false,'error','sku ids required')
  else jsonb_build_object(
    'available',exists(select 1 from grouped),
    'rows',(select data from rows),
    'note','Rarity/treatment metadata is sourced from MTGJSON card/printing data. Booster-config presence does not by itself imply exact packs-per-hit is known.'
  )
end
$$;
revoke all on function public.ask_collectish_family_printing_metadata_v1(text[]) from public,anon;
grant execute on function public.ask_collectish_family_printing_metadata_v1(text[]) to authenticated,service_role;
notify pgrst,'reload schema';
