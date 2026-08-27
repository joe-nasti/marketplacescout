-- Timestamped creator-video event hardening.
create unique index if not exists market_intel_video_events_dedupe_idx
  on public.market_intel_video_events(user_id, video_id, intel_id, event_type, start_ms);
