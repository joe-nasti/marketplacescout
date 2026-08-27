-- Collectish / MarketplaceScout creator video intelligence
-- Additive schema for timestamped creator-video events.

alter table if exists public.market_intel_items
  add column if not exists source_profile text,
  add column if not exists source_subtype text,
  add column if not exists metadata_json jsonb not null default '{}'::jsonb;

create table if not exists public.market_intel_video_events (
  video_event_id uuid primary key default gen_random_uuid(),
  intel_id uuid not null,
  user_id uuid not null default auth.uid(),
  video_id text not null,
  channel_id text,
  channel_name text,
  creator_lane text not null default 'general' check (creator_lane in ('competitive','commander_gameplay','commander_product','general')),
  event_type text not null check (event_type in (
    'competitive_test','competitive_result','deck_innovation','commander_showcase',
    'commander_recommendation','precon_reveal','reprint_reveal','new_commander_synergy',
    'precon_upgrade','precon_cut','spoiler_reaction','creator_convergence','other'
  )),
  start_ms integer check (start_ms is null or start_ms >= 0),
  end_ms integer check (end_ms is null or end_ms >= 0),
  prominence numeric(4,3) not null default 0.500 check (prominence >= 0 and prominence <= 1),
  evidence text,
  transcript_provider text,
  transcript_mode text,
  created_at timestamptz not null default now(),
  constraint market_intel_video_events_intel_user_fkey foreign key (intel_id,user_id)
    references public.market_intel_items(intel_id,user_id) on delete cascade
);

create index if not exists market_intel_video_events_user_video_idx
  on public.market_intel_video_events(user_id, video_id, start_ms);
create index if not exists market_intel_video_events_user_type_idx
  on public.market_intel_video_events(user_id, event_type, created_at desc);

alter table public.market_intel_video_events enable row level security;
drop policy if exists market_intel_video_events_own on public.market_intel_video_events;
create policy market_intel_video_events_own on public.market_intel_video_events for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.market_intel_video_events to authenticated;

-- Creator subscriptions use source_captures so they inherit the existing Signals
-- scheduler/configuration model. Example payload_json:
-- {
--   "enabled": true,
--   "adapter": "youtube_rss_supadata",
--   "channel_id": "UC...",
--   "creator_lane": "competitive",
--   "source_profile": "creator_competitive",
--   "max_items": 12,
--   "backfill_days": 30
-- }
-- capture_type = 'video_subscription'
