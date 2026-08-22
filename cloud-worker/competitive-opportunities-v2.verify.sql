-- Verification for competitive-opportunities-v2.sql
-- Run in an authenticated request context or set request.jwt.claim.sub in a local/admin session.
select count(*) as rows,
       max(deck_count_30d) as max_decks,
       max(top8_decks_30d) as max_top8
from public.competitive_scout_opportunities(null);
