-- MarketplaceScout cEDH intelligence v2
-- Production migration: cedh_known_commander_and_recent_card_signals
-- Keeps hidden/no-decklist entries out of commander-share denominators and
-- distinguishes recent cEDH cards from established PLAYED + SCOUT cards.

-- Source parity marker only. See Supabase migration history for the live function bodies:
--   public.cedh_commander_rollups(integer, integer)
--   public.cedh_card_opportunities(integer)
