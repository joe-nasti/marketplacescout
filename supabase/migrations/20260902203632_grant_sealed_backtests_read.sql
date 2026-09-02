-- The public family-economics views are queried by signed-in Collectish users.
-- sealed_ev_backtests already has an authenticated SELECT policy scoped to
-- auth.uid(); grant the table privilege required for that RLS policy to run.
grant select on table public.sealed_ev_backtests to authenticated;

notify pgrst, 'reload schema';
