grant select on table public.tcgplayer_official_sync_state to anon, authenticated;

drop policy if exists "read scout official tcgplayer sync health" on public.tcgplayer_official_sync_state;
create policy "read scout official tcgplayer sync health"
on public.tcgplayer_official_sync_state
for select
to anon, authenticated
using (scope = 'scout');
