grant select on table public.secret_lair_randomized_products to authenticated;
grant select on table public.secret_lair_randomized_rarity_odds to authenticated;
grant select on table public.secret_lair_randomized_treatments to authenticated;
grant select on table public.secret_lair_randomized_cards to authenticated;
grant select on table public.secret_lair_randomized_pack_ev_snapshots to authenticated;
grant select on table public.secret_lair_randomized_variant_odds to authenticated;

grant select, insert, update, delete on table public.secret_lair_randomized_products to service_role;
grant select, insert, update, delete on table public.secret_lair_randomized_rarity_odds to service_role;
grant select, insert, update, delete on table public.secret_lair_randomized_treatments to service_role;
grant select, insert, update, delete on table public.secret_lair_randomized_cards to service_role;
grant select, insert, update, delete on table public.secret_lair_randomized_pack_ev_snapshots to service_role;
grant select on table public.secret_lair_randomized_variant_odds to service_role;
