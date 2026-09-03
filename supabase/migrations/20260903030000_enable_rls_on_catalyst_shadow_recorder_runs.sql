-- The recorder run ledger is an internal service-only table. Its original
-- migration revoked all privileges from anon and authenticated; RLS adds
-- defense in depth for the public schema without exposing any client policy.
alter table public.market_intel_catalyst_shadow_recorder_runs
  enable row level security;
