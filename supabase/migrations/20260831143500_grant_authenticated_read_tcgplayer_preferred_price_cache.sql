-- Shared TCGplayer preferred-price cache is non-user-specific market data.
-- Secret Lair scoring runs with the caller's authenticated JWT and needs read access.

drop policy if exists tcgplayer_preferred_price_current_cache_authenticated_read
  on public.tcgplayer_preferred_price_current_cache;

create policy tcgplayer_preferred_price_current_cache_authenticated_read
  on public.tcgplayer_preferred_price_current_cache
  for select to authenticated
  using (true);

grant select on public.tcgplayer_preferred_price_current_cache to authenticated;
