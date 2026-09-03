-- Security-invoker sealed EV views read these owner-scoped base tables.
-- RLS remains the data boundary: both tables already restrict SELECT to
-- user_id = auth.uid() for the authenticated role.
grant select on table public.sealed_ev_backtest_pool_items to authenticated;
grant select on table public.sealed_ev_backtest_slots to authenticated;
