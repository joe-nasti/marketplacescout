create index if not exists marketplace_scan_rows_set_collector_lookup_idx
  on public.marketplace_scan_rows (
    upper(coalesce(set_code,'')),
    lower(coalesce(collector_number,''))
  )
  include (product_name, product_id, sku_id, scryfall_id, printing, condition, language);

create index if not exists scout_card_catalog_set_collector_lookup_idx
  on public.scout_card_catalog (
    upper(coalesce(set_code,'')),
    lower(coalesce(collector_number,''))
  )
  include (card_name, product_id, sku_id, scryfall_id, printing, condition, language);
