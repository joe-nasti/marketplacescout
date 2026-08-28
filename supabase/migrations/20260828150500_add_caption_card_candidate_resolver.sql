create or replace function public.market_intel_caption_card_candidates(p_text text)
returns table(card_name text, scryfall_id uuid, release_date date, match_start integer, match_end integer)
language sql
security invoker
set search_path = public
as $$
  with candidates as (
    select distinct on (lower(c.name))
      c.name,
      c.scryfall_id,
      c.release_date,
      strpos(lower(coalesce(p_text,'')), lower(c.name)) as pos
    from public.mtgjson_cards c
    where p_text is not null
      and c.name is not null
      and length(c.name) >= 3
      and c.scryfall_id is not null
      and strpos(lower(p_text), lower(c.name)) > 0
    order by lower(c.name), c.release_date desc nulls last, c.scryfall_id
  )
  select name::text, scryfall_id, release_date, pos::integer,
         (pos + length(name) - 1)::integer
  from candidates
  order by pos, length(name) desc;
$$;

revoke all on function public.market_intel_caption_card_candidates(text) from public, anon, authenticated;
grant execute on function public.market_intel_caption_card_candidates(text) to service_role;
