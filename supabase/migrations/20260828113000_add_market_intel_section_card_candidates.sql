create or replace function public.market_intel_section_card_candidates(p_text text)
returns table(card_name text, scryfall_id uuid, similarity_score real)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (lower(c.name))
    c.name::text,
    c.scryfall_id,
    similarity(lower(c.name), lower(coalesce(p_text,'')))::real
  from public.mtgjson_cards c
  where c.name is not null
    and length(c.name) >= 6
    and similarity(lower(c.name), lower(coalesce(p_text,''))) >= 0.34
  order by lower(c.name), similarity(lower(c.name), lower(coalesce(p_text,''))) desc;
$$;

revoke all on function public.market_intel_section_card_candidates(text) from public, anon, authenticated;
grant execute on function public.market_intel_section_card_candidates(text) to service_role;
