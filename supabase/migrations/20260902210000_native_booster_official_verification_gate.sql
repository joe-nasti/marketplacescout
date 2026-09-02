-- Native MTGJSON collation is only recommendation-grade after its exact
-- configuration has been checked against a primary slot/probability source.
alter table public.mtgjson_set_booster_configs
  add column if not exists config_fingerprint text
  generated always as (md5(booster_config::text)) stored;

create table if not exists public.sealed_native_booster_verifications (
  set_code text not null,
  booster_code text not null,
  config_fingerprint text not null,
  verification_status text not null check (verification_status in ('verified','partial','rejected')),
  official_source_url text not null,
  verified_at timestamptz not null,
  verification_notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (set_code,booster_code)
);

alter table public.sealed_native_booster_verifications enable row level security;
grant select on public.sealed_native_booster_verifications to authenticated,service_role;
grant insert,update,delete on public.sealed_native_booster_verifications to service_role;

insert into public.sealed_native_booster_verifications
  (set_code,booster_code,config_fingerprint,verification_status,official_source_url,verified_at,verification_notes)
values
  ('CMM','draft','94acc3ac2c291d31490b1a243efb7910','verified','https://magic.wizards.com/en/news/feature/collecting-commander-masters','2026-09-02T20:45:00Z',
   '{"official_slots_checked":true,"checks":["11 commons with Prismatic Piper replacement","3 nonlegendary uncommons","2 legendary uncommons","1 legendary rare/mythic","1 nonlegendary rare/mythic","2/3 uncommon vs 1/3 rare/mythic variable slot","foil slot"]}'),
  ('CMM','set','1b93ec3a8d7dd29a7bf6d7b50c64211b','verified','https://magic.wizards.com/en/news/feature/collecting-commander-masters','2026-09-02T20:45:00Z',
   '{"official_slots_checked":true,"checks":["20% foil retro basic","borderless common/uncommon","4 commons","2 nonlegendary uncommons","50/50 legendary uncommon vs nonlegendary rare/mythic","2 wildcards","legendary rare/mythic","nonlegendary rare/mythic","traditional foil","25% The List"]}'),
  ('CMM','collector','5f38be499701476c73cc0338b3bfd067','verified','https://magic.wizards.com/en/news/feature/collecting-commander-masters','2026-09-02T20:45:00Z',
   '{"official_slots_checked":true,"checks":["4 foil commons","2 foil uncommons","foil retro basic","2 nonfoil borderless commons/uncommons","foil borderless common/uncommon","foil rare/mythic","foil-etched rare/mythic","80/20 nonfoil vs foil extended Commander","nonfoil borderless rare/mythic","4% textured replacement"]}')
on conflict (set_code,booster_code) do update set
  config_fingerprint=excluded.config_fingerprint,
  verification_status=excluded.verification_status,
  official_source_url=excluded.official_source_url,
  verified_at=excluded.verified_at,
  verification_notes=excluded.verification_notes,
  updated_at=now();

