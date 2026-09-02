drop policy if exists secret_lair_randomized_product_offers_own on public.secret_lair_randomized_product_offers;
create policy secret_lair_randomized_product_offers_own
  on public.secret_lair_randomized_product_offers for all to authenticated
  using ((select auth.uid()) = user_id and (select (auth.jwt()->>'is_anonymous')::boolean) is false)
  with check ((select auth.uid()) = user_id and (select (auth.jwt()->>'is_anonymous')::boolean) is false);
