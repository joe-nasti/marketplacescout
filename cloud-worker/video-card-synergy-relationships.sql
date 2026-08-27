-- Explicit relationship graph for creator content.
-- The source card is the new/reviewed card creating demand; the target is the
-- existing card that becomes actionable because of that relationship.
create table if not exists public.market_intel_card_relationships (
  relationship_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_intel_id uuid,
  source_video_id text,
  source_name text,
  source_url text,
  source_card_name text not null,
  source_scryfall_id uuid,
  source_release_date date,
  target_card_name text not null,
  target_scryfall_id uuid,
  target_release_date date,
  relationship_type text not null check (relationship_type in ('new_card_synergy','upgrade_for','combo_with','enabler_for','payoff_for','anti_synergy','other')),
  direction text not null default 'bullish' check (direction in ('bullish','bearish','neutral')),
  conviction numeric not null default 0.5 check (conviction >= 0 and conviction <= 1),
  start_ms integer,
  evidence text,
  summary text,
  source_is_unreleased boolean not null default false,
  target_is_actionable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists market_intel_card_relationships_dedupe
on public.market_intel_card_relationships(user_id,coalesce(source_video_id,''),lower(source_card_name),lower(target_card_name),relationship_type,coalesce(start_ms,-1));
create index if not exists market_intel_card_relationships_target_idx
on public.market_intel_card_relationships(user_id,target_scryfall_id,created_at desc);

alter table public.market_intel_card_relationships enable row level security;
drop policy if exists market_intel_card_relationships_owner_select on public.market_intel_card_relationships;
create policy market_intel_card_relationships_owner_select on public.market_intel_card_relationships
for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.market_intel_card_relationships from public,anon;
grant select on public.market_intel_card_relationships to authenticated;
grant all on public.market_intel_card_relationships to service_role;

create or replace view public.market_intel_actionable_synergy_relationships
with (security_invoker=true) as
select r.*,
  case when r.target_release_date is null or r.target_release_date <= current_date then true else false end as target_released,
  case when r.source_release_date is not null and r.source_release_date > current_date then 'future_source_to_current_target'
       when r.source_release_date is not null and r.source_release_date <= current_date then 'released_source_to_current_target'
       else 'unknown_source_lifecycle' end as lifecycle_context
from public.market_intel_card_relationships r
where r.direction='bullish' and r.target_is_actionable=true;

revoke all on public.market_intel_actionable_synergy_relationships from public,anon;
grant select on public.market_intel_actionable_synergy_relationships to authenticated,service_role;
