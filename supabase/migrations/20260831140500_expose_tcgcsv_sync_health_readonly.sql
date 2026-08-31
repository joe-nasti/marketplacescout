grant select on table public.tcgcsv_sync_state to anon, authenticated;

create policy tcgcsv_sync_state_read_health
on public.tcgcsv_sync_state
for select
to anon, authenticated
using (feed = 'tcgplayer_prices');
