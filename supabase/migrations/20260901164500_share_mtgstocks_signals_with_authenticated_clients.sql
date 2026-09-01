drop policy if exists market_intel_items_shared_mtgstocks_read on public.market_intel_items;
create policy market_intel_items_shared_mtgstocks_read
on public.market_intel_items
for select
to authenticated
using (source_name='MTGStocks');
