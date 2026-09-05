-- Keep shared TCGplayer sales-history candidate selection inside the worker statement budget.
-- Candidate generation groups Scout rows by (user_id, product_id); the existing Scout
-- indexes were SKU/score/set oriented and forced unnecessary work on each collection run.

create index if not exists scout_opportunities_24h_user_product_idx
  on public.scout_opportunities_24h(user_id, product_id)
  where product_id is not null;

analyze public.scout_opportunities_24h;
