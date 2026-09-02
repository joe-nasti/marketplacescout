-- PostgREST embeds entities by both foreign-key columns for each signal row.
-- Keep that lateral lookup indexed in the same order as the generated query.
create index if not exists market_intel_entities_intel_user_idx
  on public.market_intel_entities (intel_id, user_id);

comment on index public.market_intel_entities_intel_user_idx is
  'Accelerates embedded entity hydration for the primary Signals feed.';
