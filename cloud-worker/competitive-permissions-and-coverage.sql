-- MarketplaceScout competitive-result permissions and coverage semantics.
-- Production migration: competitive_permissions_and_coverage

grant select on table public.competitive_events, public.competitive_event_sources, public.competitive_decks, public.competitive_deck_cards to authenticated;
grant all on table public.competitive_events, public.competitive_event_sources, public.competitive_decks, public.competitive_deck_cards to service_role;

grant select, insert, update, delete on table public.market_intel_evaluations to authenticated;
grant select on table public.market_intel_entity_rollups, public.market_intel_source_performance, public.competitive_card_rollups to authenticated;
grant execute on function public.refresh_market_intel_evaluations() to authenticated;
grant execute on function public.refresh_market_intel_entity_links() to authenticated;
grant execute on function public.competitive_scout_opportunities(text) to authenticated;

alter table public.competitive_events add column if not exists coverage_type text not null default 'unknown';
alter table public.competitive_events add column if not exists published_deck_count integer;
alter table public.competitive_events add column if not exists coverage_note text;

alter table public.competitive_events drop constraint if exists competitive_events_coverage_type_check;
alter table public.competitive_events add constraint competitive_events_coverage_type_check
  check (coverage_type in ('complete_event','partial_event','curated_sample','unknown'));

update public.competitive_events
set coverage_type = case
  when lower(coalesce(event_type,''))='league' then 'curated_sample'
  when lower(coalesce(event_type,'')) in ('challenge','trial','qualifier','super qualifier','showcase') then 'partial_event'
  else coverage_type
end,
coverage_note = case
  when lower(coalesce(event_type,''))='league' then coalesce(coverage_note,'WotC-curated published League sample; not suitable for field-share estimates.')
  when lower(coalesce(event_type,'')) in ('challenge','trial','qualifier','super qualifier','showcase') then coalesce(coverage_note,'Published competitive event results; use published deck count as denominator only when coverage is known.')
  else coverage_note
end;
