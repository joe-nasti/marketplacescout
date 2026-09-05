-- MTGJSON identifies SLD Enduring Ideal #887 as TCGplayer product 601114 but
-- currently omits its SKU matrix. TCGplayer's official catalog endpoint
-- /catalog/products/601114/skus reports 8400139 as NM English Foil.
-- Keep the exact commerce identity available to the sealed resolvers while the
-- upstream MTGJSON TcgplayerSkus dataset catches up.
insert into public.mtgjson_tcgplayer_skus (
  sku_id,
  uuid,
  product_id,
  condition,
  finish,
  language,
  printing,
  source_updated_at
)
select
  '8400139',
  c.uuid,
  '601114',
  'NEAR MINT',
  null,
  'ENGLISH',
  'FOIL',
  now()
from public.mtgjson_cards c
where c.uuid = '75cd58ea-db54-5d0b-a26c-b08b3291322a'
  and c.tcgplayer_product_id = '601114'
on conflict (sku_id) do update
set
  uuid = excluded.uuid,
  product_id = excluded.product_id,
  condition = excluded.condition,
  finish = excluded.finish,
  language = excluded.language,
  printing = excluded.printing,
  source_updated_at = excluded.source_updated_at;
