# Creator video Signals

Creator-video ingestion is intentionally bounded for the Supadata free tier.

- YouTube RSS discovers videos without transcript credits.
- Supadata is called with `mode=native` only.
- Scheduled sync attempts at most one transcript per run.
- Transcript payloads are cached in `source_captures`.
- Significant timestamped passages are extracted into `market_intel_video_events` only when prominence is at least 0.55.
- Signals renders exact YouTube timestamp links.
- Scout card detail renders creator catalysts as contextual evidence; creator events do not alter the Scout grade yet.
