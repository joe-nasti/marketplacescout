create or replace function public.scout_canonical_edhrec_rank(p_card_name text)
returns table(edhrec_rank integer, observed_at timestamptz, product_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.edhrec_rank, m.edhrec_observed_at, m.product_name
  from public.marketplace_scan_rows m
  where auth.uid() is not null
    and m.user_id = auth.uid()
    and m.edhrec_rank is not null
    and (
      lower(m.product_name) = lower(trim(p_card_name))
      or lower(m.product_name) like lower(trim(p_card_name)) || ' (%'
    )
  order by m.edhrec_observed_at desc nulls last
  limit 1;
$$;

revoke all on function public.scout_canonical_edhrec_rank(text) from public;
revoke all on function public.scout_canonical_edhrec_rank(text) from anon;
grant execute on function public.scout_canonical_edhrec_rank(text) to authenticated;
