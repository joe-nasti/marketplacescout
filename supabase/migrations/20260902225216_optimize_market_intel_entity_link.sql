create or replace function public.resolve_market_intel_entity_link()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  c record;
  unique_product_ids text[];
  only_product_id text;
begin
  if new.entity_type <> 'card' or new.product_id is not null then
    return new;
  end if;

  if exists (
    select 1 from public.market_intel_items i
    where i.intel_id = new.intel_id
      and i.user_id = new.user_id
      and i.source_name = 'MTGStocks'
      and i.source_subtype = 'interests'
  ) then
    return new;
  end if;

  select null::text as product_id,
         null::text as set_code,
         null::uuid as scryfall_id
    into c;

  -- A Scryfall ID identifies an exact printing. Prefer the compact indexed
  -- MTGJSON map before searching the user's much larger scan history.
  if new.scryfall_id is not null then
    select m.tcgplayer_product_id::text as product_id,
           m.set_code as set_code,
           m.scryfall_id as scryfall_id
      into c
    from public.mtgjson_cards m
    where m.scryfall_id = new.scryfall_id
      and m.tcgplayer_product_id is not null
    order by case when lower(coalesce(m.language, '')) = 'english' then 0 else 1 end
    limit 1;
  end if;

  if c.product_id is null and new.scryfall_id is not null then
    select r.product_id::text as product_id,
           r.set_code as set_code,
           r.scryfall_id as scryfall_id
      into c
    from public.marketplace_scan_rows r
    join public.marketplace_scans s on s.scan_id = r.scan_id
    where r.user_id = new.user_id
      and r.scryfall_id = new.scryfall_id
    order by case when r.condition = 'Near Mint'
                        and r.language = 'English'
                        and r.printing = 'Normal' then 0 else 1 end,
             s.captured_at desc
    limit 1;
  end if;

  if c.product_id is null and new.set_code is not null then
    select r.product_id::text as product_id,
           r.set_code as set_code,
           r.scryfall_id as scryfall_id
      into c
    from public.marketplace_scan_rows r
    join public.marketplace_scans s on s.scan_id = r.scan_id
    where r.user_id = new.user_id
      and lower(r.product_name) = lower(new.entity_name)
      and lower(coalesce(r.set_code, '')) = lower(new.set_code)
    order by case when r.condition = 'Near Mint'
                        and r.language = 'English'
                        and r.printing = 'Normal' then 0 else 1 end,
             s.captured_at desc
    limit 1;
  end if;

  if c.product_id is null then
    select array_agg(x.product_id)
      into unique_product_ids
    from (
      select distinct r.product_id::text as product_id
      from public.marketplace_scan_rows r
      where r.user_id = new.user_id
        and lower(r.product_name) = lower(new.entity_name)
        and r.product_id is not null
      limit 2
    ) x;

    if coalesce(array_length(unique_product_ids, 1), 0) = 1 then
      only_product_id := unique_product_ids[1];
      select r.product_id::text as product_id,
             r.set_code as set_code,
             r.scryfall_id as scryfall_id
        into c
      from public.marketplace_scan_rows r
      join public.marketplace_scans s on s.scan_id = r.scan_id
      where r.user_id = new.user_id
        and r.product_id::text = only_product_id
      order by case when r.condition = 'Near Mint'
                          and r.language = 'English'
                          and r.printing = 'Normal' then 0 else 1 end,
               s.captured_at desc
      limit 1;
    end if;
  end if;

  if c.product_id is not null then
    new.product_id := c.product_id;
    new.set_code := coalesce(new.set_code, c.set_code);
    new.scryfall_id := coalesce(new.scryfall_id, c.scryfall_id);
    new.confidence := greatest(new.confidence, 0.99);
  end if;

  return new;
end
$function$;
