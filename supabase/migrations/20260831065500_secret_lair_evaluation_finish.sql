-- Secret Lair foil/nonfoil economics can diverge materially.
alter table public.secret_lair_evaluations
  add column if not exists finish text check (finish in ('nonfoil','foil','other'));

alter table public.secret_lair_card_valuations
  add column if not exists finish text check (finish in ('nonfoil','foil','other'));

create index if not exists secret_lair_evaluations_drop_region_finish_idx
  on public.secret_lair_evaluations(drop_id, region, finish, evaluation_phase, evaluated_at desc);