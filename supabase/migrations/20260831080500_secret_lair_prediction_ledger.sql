-- Secret Lair prediction ledger and launch-confirmation semantics.
-- Predictions are append-only pre-sale claims. Launch observations may confirm or contradict
-- them, but never rewrite the original claim or evaluation snapshot.

alter table public.secret_lair_observations
  drop constraint if exists secret_lair_observations_availability_state_check;

alter table public.secret_lair_observations
  add constraint secret_lair_observations_availability_state_check
  check (availability_state in ('available','low_stock','sold_out','pulled','unknown'));

alter table public.secret_lair_observations
  add column if not exists finish text check (finish in ('nonfoil','foil','other'));

create table if not exists public.secret_lair_predictions (
  prediction_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  drop_id uuid references public.secret_lair_drops(drop_id) on delete cascade,
  region text check (region in ('US','REU','UK')),
  finish text check (finish in ('nonfoil','foil','other')),
  source_type text not null default 'model'
    check (source_type in ('model','expert_review','community','manual','other')),
  source_name text,
  prediction_type text not null
    check (prediction_type in ('favorite','rating','sellout_speed','sellout_order','bundle_strategy','collector_demand','resale_opportunity','other')),
  prediction_label text not null,
  claim text not null,
  predicted_rank integer,
  predicted_rating numeric(5,2),
  predicted_rating_scale numeric(5,2),
  confidence numeric(4,3) not null default 0.500 check (confidence between 0 and 1),
  frozen_at timestamptz not null default now(),
  source_observed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.secret_lair_prediction_updates (
  prediction_update_id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.secret_lair_predictions(prediction_id) on delete cascade,
  user_id uuid not null default auth.uid(),
  observed_at timestamptz not null default now(),
  confirmation_state text not null default 'not_enough_evidence'
    check (confirmation_state in ('not_enough_evidence','early_support','strong_support','mixed','contradicted')),
  evidence_summary text not null,
  observation_ids uuid[] not null default '{}'::uuid[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists secret_lair_predictions_release_idx
  on public.secret_lair_predictions(release_id, frozen_at desc);
create index if not exists secret_lair_predictions_drop_idx
  on public.secret_lair_predictions(drop_id, frozen_at desc) where drop_id is not null;
create index if not exists secret_lair_prediction_updates_prediction_idx
  on public.secret_lair_prediction_updates(prediction_id, observed_at desc);
create index if not exists secret_lair_observations_release_region_time_idx
  on public.secret_lair_observations(release_id, region, observed_at desc);

alter table public.secret_lair_predictions enable row level security;
alter table public.secret_lair_prediction_updates enable row level security;

create policy secret_lair_predictions_own on public.secret_lair_predictions for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy secret_lair_prediction_updates_own on public.secret_lair_prediction_updates for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.secret_lair_predictions to authenticated;
grant select, insert, update, delete on public.secret_lair_prediction_updates to authenticated;
