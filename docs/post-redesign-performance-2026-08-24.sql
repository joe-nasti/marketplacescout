-- Applied to production during the post-redesign performance pass.
-- Keeps RLS semantics unchanged while allowing auth.uid() to be evaluated once per statement,
-- and adds covering indexes for measured hot user-facing queries.

create index if not exists collector_job_events_user_at_idx
  on public.collector_job_events (user_id, at desc);

create index if not exists seller_payment_orders_user_order_date_idx
  on public.seller_payment_orders (user_id, order_date desc);

create index if not exists ri_discrepancies_user_replacement_nonzero_idx
  on public.ri_discrepancies (user_id, replacement_fee desc)
  where discrepancy <> 0;

alter policy collectors_own on public.collectors
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy collector_jobs_own on public.collector_jobs
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy collector_job_events_own on public.collector_job_events
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy entity_links_own on public.entity_links
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy ask_collectish_preferences_own on public.ask_collectish_preferences
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy collectish_inventory_positions_own on public.collectish_inventory_positions
  using ((select auth.uid()) = user_id);
alter policy collectish_alerts_select_own on public.collectish_alerts
  using ((select auth.uid()) = user_id);
alter policy collectish_alert_state_select_own on public.collectish_alert_state
  using ((select auth.uid()) = user_id);
alter policy precon_card_ev_select on public.precon_card_ev_current
  using ((select auth.uid()) = user_id);
alter policy precon_ev_select on public.precon_ev_current
  using ((select auth.uid()) = user_id);
alter policy sealed_component_tcg_select_own on public.sealed_component_tcg_current
  using ((select auth.uid()) = user_id);

alter policy market_intel_evaluations_select_own on public.market_intel_evaluations
  using ((select auth.uid()) = user_id);
alter policy market_intel_evaluations_insert_own on public.market_intel_evaluations
  with check ((select auth.uid()) = user_id);
alter policy market_intel_evaluations_update_own on public.market_intel_evaluations
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy market_intel_evaluations_delete_own on public.market_intel_evaluations
  using ((select auth.uid()) = user_id);

alter policy store_inventory_products_select_own on public.store_inventory_products
  using ((select auth.uid()) = user_id);
alter policy store_inventory_products_insert_own on public.store_inventory_products
  with check ((select auth.uid()) = user_id);
alter policy store_inventory_products_update_own on public.store_inventory_products
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy store_inventory_products_delete_own on public.store_inventory_products
  using ((select auth.uid()) = user_id);

alter policy store_inventory_conditions_select_own on public.store_inventory_conditions
  using ((select auth.uid()) = user_id);
alter policy store_inventory_conditions_insert_own on public.store_inventory_conditions
  with check ((select auth.uid()) = user_id);
alter policy store_inventory_conditions_update_own on public.store_inventory_conditions
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy store_inventory_conditions_delete_own on public.store_inventory_conditions
  using ((select auth.uid()) = user_id);

alter policy store_inventory_sync_state_select_own on public.store_inventory_sync_state
  using ((select auth.uid()) = user_id);
alter policy store_inventory_sync_state_insert_own on public.store_inventory_sync_state
  with check ((select auth.uid()) = user_id);
alter policy store_inventory_sync_state_update_own on public.store_inventory_sync_state
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy store_inventory_reconcile_state_select_own on public.store_inventory_reconcile_state
  using ((select auth.uid()) = user_id);
alter policy store_inventory_reconcile_state_insert_own on public.store_inventory_reconcile_state
  with check ((select auth.uid()) = user_id);
alter policy store_inventory_reconcile_state_update_own on public.store_inventory_reconcile_state
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy store_inventory_reconcile_state_delete_own on public.store_inventory_reconcile_state
  using ((select auth.uid()) = user_id);

alter policy store_inventory_change_events_select_own on public.store_inventory_change_events
  using ((select auth.uid()) = user_id);
alter policy store_inventory_change_events_insert_own on public.store_inventory_change_events
  with check ((select auth.uid()) = user_id);
alter policy store_inventory_change_events_update_own on public.store_inventory_change_events
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy store_inventory_change_events_delete_own on public.store_inventory_change_events
  using ((select auth.uid()) = user_id);
