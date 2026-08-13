# Collectish Android Agent

Native Android shell for the Collectish cloud app and authenticated TCGplayer session work.

Initial milestone:
- host the Collectish web app in a WebView
- host a separate TCGplayer Seller Portal WebView so its authenticated session remains on-device
- expose only session health and a stable collector ID to the Collectish web app through a narrow native bridge
- never upload cookies or TCGplayer credentials
- use the same `tcgplayer_authenticated_session` capability contract as the desktop connector

The Android agent is intentionally not a second analytics application. Collectish Cloud remains the UI, history, and analytics surface.
