# Competitive Opportunities

`competitive-opportunities-v2.sql` defines the fast current-market join used by Signals. It intentionally avoids historical marketplace-scan joins in the panel hot path. Historical market timing should be evaluated only for shortlisted competitive candidates so the Signals page remains responsive.
